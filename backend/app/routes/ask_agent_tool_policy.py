from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from ..db import get_db
from .ask_agent_clarification import as_text

logger = logging.getLogger(__name__)


def as_tool_name_list(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s:
            out.append(s)
    return out


def extract_tool_policy(project: dict) -> dict:
    extra = project.get("extra") if isinstance(project, dict) else {}
    if not isinstance(extra, dict):
        extra = {}
    tooling = extra.get("tooling")
    if not isinstance(tooling, dict):
        tooling = {}

    raw = tooling.get("tool_policy")
    if not isinstance(raw, dict):
        raw = tooling

    policy: dict[str, object] = {}
    allowed = as_tool_name_list(raw.get("allowed_tools") or raw.get("allow_tools"))
    blocked = as_tool_name_list(raw.get("blocked_tools") or raw.get("deny_tools"))
    if allowed:
        policy["allowed_tools"] = allowed
    if blocked:
        policy["blocked_tools"] = blocked
    if bool(raw.get("read_only_only")):
        policy["read_only_only"] = True
    if bool(raw.get("dry_run")):
        policy["dry_run"] = True
    if bool(raw.get("require_approval_for_write_tools")):
        policy["require_approval_for_write_tools"] = True

    for key in ("timeout_overrides", "rate_limit_overrides", "retry_overrides", "cache_ttl_overrides"):
        value = raw.get(key)
        if isinstance(value, dict):
            cleaned: dict[str, int] = {}
            for k, v in value.items():
                try:
                    cleaned[str(k)] = int(v)
                except Exception:
                    continue
            if cleaned:
                policy[key] = cleaned

    return policy


def extract_max_tool_calls(project: dict) -> int:
    extra = project.get("extra") if isinstance(project, dict) else {}
    if not isinstance(extra, dict):
        extra = {}
    tooling = extra.get("tooling")
    if not isinstance(tooling, dict):
        tooling = {}
    raw = tooling.get("max_tool_calls")
    try:
        value = int(raw)
    except Exception:
        return 12
    return max(1, min(value, 80))


async def resolve_user_role(project_id: str, user_hint: str) -> str:
    email = as_text(user_hint).lower()
    if not email:
        logger.info("ask_agent.role_resolve project=%s user=<empty> role=member reason=missing_user_hint", project_id)
        return "member"

    db = get_db()
    user = await db["users"].find_one({"email": email}, {"_id": 1, "isGlobalAdmin": 1})
    if not user:
        logger.info(
            "ask_agent.role_resolve project=%s user=%s role=member reason=user_not_found",
            project_id,
            email,
        )
        return "member"
    if bool(user.get("isGlobalAdmin")):
        logger.info(
            "ask_agent.role_resolve project=%s user=%s role=admin reason=global_admin",
            project_id,
            email,
        )
        return "admin"

    membership = await db["memberships"].find_one(
        {"userId": str(user.get("_id")), "projectId": project_id},
        {"role": 1},
    )
    role = as_text((membership or {}).get("role")).lower()
    if role in {"admin", "member", "viewer"}:
        logger.info(
            "ask_agent.role_resolve project=%s user=%s role=%s reason=membership",
            project_id,
            email,
            role,
        )
        return role
    logger.info(
        "ask_agent.role_resolve project=%s user=%s role=member reason=no_membership_role",
        project_id,
        email,
    )
    return "member"


def apply_role_tool_policy(
    tool_policy: dict[str, Any],
    *,
    role: str,
    security_policy: dict[str, Any],
) -> dict[str, Any]:
    policy = dict(tool_policy or {})
    role_norm = as_text(role).lower() or "viewer"
    git_write_tools = {
        "git_checkout_branch",
        "git_create_branch",
        "git_stage_files",
        "git_unstage_files",
        "git_commit",
        "git_push",
        "git_pull",
        "git_fetch",
    }

    blocked = set(as_tool_name_list(policy.get("blocked_tools") or []))

    read_only = False
    if role_norm == "viewer":
        read_only = True
    elif role_norm == "member":
        if bool(security_policy.get("read_only_for_non_admin")) and not bool(
            security_policy.get("allow_write_tools_for_members")
        ):
            read_only = True

        if bool(security_policy.get("read_only_for_non_admin")) and not bool(
            security_policy.get("allow_git_write_tools_for_non_admin")
        ):
            blocked.update(git_write_tools)

    if read_only:
        policy["read_only_only"] = True

    if blocked:
        policy["blocked_tools"] = sorted(blocked)

    logger.info(
        "ask_agent.role_policy role=%s read_only_only=%s blocked_tools=%s",
        role_norm,
        str(bool(policy.get("read_only_only"))).lower(),
        len(policy.get("blocked_tools") or []),
    )

    return policy


def merge_tool_policies(base_policy: dict, chat_policy: dict) -> dict:
    base = dict(base_policy or {})
    chat = dict(chat_policy or {})

    strict_allowlist = bool(base.get("strict_allowlist") or chat.get("strict_allowlist"))
    base_allowed = as_tool_name_list(base.get("allowed_tools") or [])
    chat_allowed = as_tool_name_list(chat.get("allowed_tools") or [])
    if strict_allowlist:
        allowed = sorted(set(base_allowed) | set(chat_allowed))
    else:
        allowed = sorted(set(base_allowed))

    blocked = sorted(
        set(as_tool_name_list(base.get("blocked_tools") or []))
        | set(as_tool_name_list(chat.get("blocked_tools") or []))
    )

    out: dict[str, Any] = {}
    if allowed:
        out["allowed_tools"] = allowed
    if blocked:
        out["blocked_tools"] = blocked

    out["strict_allowlist"] = strict_allowlist
    out["read_only_only"] = bool(base.get("read_only_only") or chat.get("read_only_only"))
    out["dry_run"] = bool(base.get("dry_run") or chat.get("dry_run"))
    out["require_approval_for_write_tools"] = bool(
        base.get("require_approval_for_write_tools") or chat.get("require_approval_for_write_tools")
    )

    for key in ("timeout_overrides", "rate_limit_overrides", "retry_overrides", "cache_ttl_overrides"):
        merged: dict[str, int] = {}
        for src in (base.get(key), chat.get(key)):
            if not isinstance(src, dict):
                continue
            for k, v in src.items():
                try:
                    merged[str(k)] = int(v)
                except Exception:
                    continue
        if merged:
            out[key] = merged

    logger.info(
        "ask_agent.policy_merge strict_allowlist=%s base_allowed=%s chat_allowed=%s merged_allowed=%s blocked=%s read_only_only=%s",
        strict_allowlist,
        len(base_allowed),
        len(chat_allowed),
        len(allowed),
        len(blocked),
        bool(out.get("read_only_only")),
    )

    return out


def active_approved_tools(rows: list[dict[str, Any]], *, user: str) -> list[str]:
    user_norm = as_text(user).lower()
    out: list[str] = []
    now = datetime.utcnow()

    for row in rows:
        if not isinstance(row, dict):
            continue
        row_user = as_text(row.get("userId")).lower()
        if row_user and user_norm and row_user != user_norm:
            continue
        if not bool(row.get("approved")):
            continue
        exp = row.get("expiresAt")
        if exp is not None:
            try:
                if exp <= now:
                    continue
            except Exception:
                pass
        name = as_text(row.get("toolName"))
        if name:
            out.append(name)

    return sorted(set(out))
