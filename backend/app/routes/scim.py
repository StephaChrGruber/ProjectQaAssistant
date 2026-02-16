from fastapi import APIRouter, Depends, HTTPException, Query, Request
from datetime import datetime
from typing import Any
from scim2_filter_parser import Parser

from ..deps import scim_auth
from ..models.base_mongo_models import User, Group, GroupMembership

router = APIRouter(prefix="/scim/v2", dependencies=[Depends(scim_auth)])

SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group"
LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"

def scim_user(u: User) -> dict:
    return {
        "schemas": [SCIM_USER_SCHEMA],
        "id": str(u.id),
        "userName": u.email,
        "active": u.isActive,
        "name": {"formatted": u.displayName or u.email},
        "meta": {"resourceType": "User", "created": u.createdAt.isoformat() + "Z"},
    }

def scim_group(g: Group, members: list[dict] | None = None) -> dict:
    return {
        "schemas": [SCIM_GROUP_SCHEMA],
        "id": str(g.id),
        "displayName": g.displayName,
        "members": members or [],
        "meta": {"resourceType": "Group", "created": g.createdAt.isoformat() + "Z"},
    }

@router.get("/ServiceProviderConfig")
async def sp_config():
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "patch": {"supported": True},
        "bulk": {"supported": False},
        "filter": {"supported": True, "maxResults": 200},
        "changePassword": {"supported": False},
        "sort": {"supported": False},
        "etag": {"supported": False},
        "authenticationSchemes": [{"type": "oauthbearertoken", "name": "Bearer Token"}],
    }

@router.get("/Schemas")
async def schemas():
    return {
        "schemas": [LIST_RESPONSE_SCHEMA],
        "totalResults": 2,
        "Resources": [
            {"id": SCIM_USER_SCHEMA, "name": "User"},
            {"id": SCIM_GROUP_SCHEMA, "name": "Group"},
        ],
        "startIndex": 1,
        "itemsPerPage": 2,
    }

@router.get("/Users")
async def list_users(
        filter: str | None = Query(default=None),
        startIndex: int = Query(default=1),
        count: int = Query(default=50),
):
    q = {}
    if filter:
        # Minimal filter support using scim2-filter-parser:
        # handle patterns like: userName eq "email"
        ast = Parser(filter).parse()
        # We implement only the most common case for Entra provisioning: userName eq "..."
        # Anything else -> 400
        try:
            # ast is an object tree; easiest: string-check for MVP
            # Example filter: userName eq "a@b.com"
            s = filter.strip()
            if s.startswith("userName") and " eq " in s:
                email = s.split(" eq ", 1)[1].strip().strip('"')
                q = {"email": email}
            else:
                raise ValueError("Unsupported filter (MVP supports only userName eq \"...\")")
        except Exception as e:
            raise HTTPException(400, str(e))

    users = await User.find(q).skip(max(0, startIndex - 1)).limit(count).to_list()
    return {
        "schemas": [LIST_RESPONSE_SCHEMA],
        "totalResults": len(users),
        "startIndex": startIndex,
        "itemsPerPage": count,
        "Resources": [scim_user(u) for u in users],
    }

@router.post("/Users")
async def create_user(payload: dict[str, Any]):
    userName = payload.get("userName")
    active = payload.get("active", True)
    name = payload.get("name", {})
    display = name.get("formatted")

    if not userName:
        raise HTTPException(400, "userName required")

    existing = await User.find_one(User.email == userName)
    if existing:
        # SCIM: return existing (common provisioning behavior)
        existing.isActive = bool(active)
        if display:
            existing.displayName = display
        existing.createdAt = existing.createdAt or datetime.utcnow()
        await existing.save()
        return scim_user(existing)

    u = User(email=userName, displayName=display, isActive=bool(active))
    await u.insert()
    return scim_user(u)

@router.get("/Users/{id}")
async def get_user(id: str):
    u = await User.get(id)
    if not u:
        raise HTTPException(404, "Not found")
    return scim_user(u)

@router.patch("/Users/{id}")
async def patch_user(id: str, payload: dict[str, Any]):
    u = await User.get(id)
    if not u:
        raise HTTPException(404, "Not found")

    # SCIM PATCH (very common operations):
    # - active
    # - name.formatted
    ops = payload.get("Operations", [])
    for op in ops:
        path = (op.get("path") or "").lower()
        value = op.get("value")
        if path == "active":
            u.isActive = bool(value)
        elif path in ("name.formatted", "name"):
            if isinstance(value, dict):
                u.displayName = value.get("formatted") or u.displayName
            elif isinstance(value, str):
                u.displayName = value
        elif path == "":
            # sometimes provisioning sends value object without path
            if isinstance(value, dict) and "active" in value:
                u.isActive = bool(value["active"])
        else:
            # ignore unsupported fields in MVP
            pass

    await u.save()
    return scim_user(u)

@router.delete("/Users/{id}")
async def delete_user(id: str):
    u = await User.get(id)
    if not u:
        raise HTTPException(404, "Not found")
    u.isActive = False
    await u.save()
    return {"status": "ok"}

# ---- Groups (optional but recommended for role mapping later) ----

@router.get("/Groups")
async def list_groups():
    groups = await Group.find_all().to_list()
    resources = []
    for g in groups:
        mships = await GroupMembership.find(GroupMembership.groupId == str(g.id)).to_list()
        members = [{"value": ms.userId, "type": "User"} for ms in mships]
        resources.append(scim_group(g, members))
    return {
        "schemas": [LIST_RESPONSE_SCHEMA],
        "totalResults": len(resources),
        "startIndex": 1,
        "itemsPerPage": len(resources),
        "Resources": resources,
    }

@router.post("/Groups")
async def create_group(payload: dict[str, Any]):
    displayName = payload.get("displayName")
    if not displayName:
        raise HTTPException(400, "displayName required")

    g = Group(displayName=displayName)
    await g.insert()

    # add members if provided
    for mem in payload.get("members", []) or []:
        uid = mem.get("value")
        if uid:
            await GroupMembership(groupId=str(g.id), userId=uid).insert()

    mships = await GroupMembership.find(GroupMembership.groupId == str(g.id)).to_list()
    members = [{"value": ms.userId, "type": "User"} for ms in mships]
    return scim_group(g, members)

@router.patch("/Groups/{id}")
async def patch_group(id: str, payload: dict[str, Any]):
    g = await Group.get(id)
    if not g:
        raise HTTPException(404, "Not found")

    ops = payload.get("Operations", [])
    for op in ops:
        op_type = (op.get("op") or "").lower()
        value = op.get("value")
        if op_type in ("add", "replace") and isinstance(value, dict) and "members" in value:
            for mem in value["members"]:
                uid = mem.get("value")
                if uid:
                    exists = await GroupMembership.find_one(
                        GroupMembership.groupId == str(g.id),
                        GroupMembership.userId == uid
                    )
                    if not exists:
                        await GroupMembership(groupId=str(g.id), userId=uid).insert()
        if op_type == "remove":
            # MVP: remove all or ignore specifics
            pass

    mships = await GroupMembership.find(GroupMembership.groupId == str(g.id)).to_list()
    members = [{"value": ms.userId, "type": "User"} for ms in mships]
    return scim_group(g, members)
