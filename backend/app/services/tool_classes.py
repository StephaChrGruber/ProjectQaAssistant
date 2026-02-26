from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..db_indexes import ensure_index
from ..db import get_db

VIRTUAL_CUSTOM_UNCATEGORIZED_KEY = "custom.uncategorized"


@dataclass(frozen=True)
class BuiltinToolClass:
    key: str
    display_name: str
    description: str
    parent_key: str | None = None


_BUILTIN_CLASSES: tuple[BuiltinToolClass, ...] = (
    BuiltinToolClass("system", "System", "Core runtime and orchestration helpers."),
    BuiltinToolClass("system.discovery", "Discovery", "Tool discovery and metadata.", "system"),
    BuiltinToolClass("system.context", "Context", "Context and chat state helpers.", "system"),
    BuiltinToolClass("util", "Utilities", "Fallback utilities for uncategorized built-in tools."),
    BuiltinToolClass("repository", "Repository", "Repository read/search operations."),
    BuiltinToolClass("repository.read", "Repository Read", "Repository traversal and code reading.", "repository"),
    BuiltinToolClass("git", "Git", "Git operations."),
    BuiltinToolClass("git.branches", "Branches", "Branch management operations.", "git"),
    BuiltinToolClass("git.sync", "Sync", "Remote sync operations (fetch/pull/push).", "git"),
    BuiltinToolClass("git.changes", "Changes", "Working tree inspection and comparison.", "git"),
    BuiltinToolClass("git.commit", "Commit", "Staging and commit operations.", "git"),
    BuiltinToolClass("documentation", "Documentation", "Documentation read/write operations."),
    BuiltinToolClass("documentation.read", "Docs Read", "Read documentation content.", "documentation"),
    BuiltinToolClass("documentation.write", "Docs Write", "Generate and write documentation.", "documentation"),
    BuiltinToolClass("quality", "Quality", "Quality and validation tooling."),
    BuiltinToolClass("quality.testing", "Testing", "Test execution and checks.", "quality"),
    BuiltinToolClass("issues", "Issues", "Issue tracker integrations."),
    BuiltinToolClass("issues.jira", "Jira", "Jira issue creation.", "issues"),
    BuiltinToolClass("tasks", "Tasks", "Task and planning workflows."),
    BuiltinToolClass("tasks.chat", "Chat Tasks", "Chat task CRUD operations.", "tasks"),
    BuiltinToolClass("automation", "Automation", "Automation workflows and templates."),
    BuiltinToolClass("knowledge", "Knowledge", "Indexed knowledge and vector search."),
    BuiltinToolClass("knowledge.vector", "Vector Index", "Vector index access and search.", "knowledge"),
    BuiltinToolClass("custom", "Custom", "User-defined tool classes and custom tools."),
)


def class_key_to_path(key: str) -> str:
    return str(key or "").strip().replace(".", "/")


def normalize_class_key(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    key = raw.replace("/", ".")
    while ".." in key:
        key = key.replace("..", ".")
    key = key.strip(".")
    return key or None


def _class_row(
    *,
    key: str,
    display_name: str,
    description: str | None,
    parent_key: str | None,
    origin: str,
    is_enabled: bool = True,
    scope: str = "global",
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
    created_by: str | None = None,
) -> dict[str, Any]:
    k = normalize_class_key(key) or ""
    p = normalize_class_key(parent_key) if parent_key else None
    return {
        "key": k,
        "display_name": str(display_name or k or "Class"),
        "description": str(description or "").strip() or None,
        "parent_key": p,
        "path": class_key_to_path(k),
        "scope": str(scope or "global"),
        "origin": str(origin or "custom"),
        "is_enabled": bool(is_enabled),
        "created_at": created_at,
        "updated_at": updated_at,
        "created_by": created_by,
    }


def builtin_tool_classes() -> list[dict[str, Any]]:
    return [
        _class_row(
            key=row.key,
            display_name=row.display_name,
            description=row.description,
            parent_key=row.parent_key,
            origin="builtin",
            is_enabled=True,
        )
        for row in _BUILTIN_CLASSES
    ]


async def ensure_tool_class_indexes() -> None:
    db = get_db()
    await ensure_index(db["tool_classes"], [("key", 1)], name="tool_classes_key_unique")
    await ensure_index(db["tool_classes"], [("parentKey", 1)], name="tool_classes_parent")
    await ensure_index(
        db["tool_classes"],
        [("scope", 1), ("origin", 1), ("isEnabled", 1)],
        name="tool_classes_scope",
    )


def _validate_tree(rows: list[dict[str, Any]]) -> None:
    by_key = {str(r.get("key") or ""): r for r in rows if str(r.get("key") or "")}
    for key, row in by_key.items():
        parent = str(row.get("parent_key") or "").strip()
        if parent and parent not in by_key:
            raise ValueError(f"Unknown parent class '{parent}' for '{key}'")

    visiting: set[str] = set()
    visited: set[str] = set()

    def dfs(node: str) -> None:
        if node in visited:
            return
        if node in visiting:
            raise ValueError(f"Cycle detected in tool classes at '{node}'")
        visiting.add(node)
        parent = str(by_key[node].get("parent_key") or "").strip()
        if parent:
            dfs(parent)
        visiting.remove(node)
        visited.add(node)

    for key in by_key:
        dfs(key)


async def list_tool_classes(
    *,
    include_builtin: bool = True,
    include_custom: bool = True,
    include_disabled: bool = False,
    include_virtual_uncategorized: bool = True,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if include_builtin:
        rows.extend(builtin_tool_classes())

    if include_custom:
        db = get_db()
        q: dict[str, Any] = {"$or": [{"scope": "global"}, {"scope": {"$exists": False}}, {"scope": None}]}
        if not include_disabled:
            q["isEnabled"] = {"$ne": False}
        custom_rows = await db["tool_classes"].find(q).to_list(length=2000)
        for row in custom_rows:
            key = normalize_class_key(row.get("key"))
            if not key:
                continue
            rows.append(
                _class_row(
                    key=key,
                    display_name=str(row.get("displayName") or key),
                    description=str(row.get("description") or "").strip() or None,
                    parent_key=normalize_class_key(row.get("parentKey")),
                    origin="custom",
                    is_enabled=bool(row.get("isEnabled", True)),
                    scope=str(row.get("scope") or "global"),
                    created_at=row.get("createdAt"),
                    updated_at=row.get("updatedAt"),
                    created_by=str(row.get("createdBy") or "").strip() or None,
                )
            )

    by_key: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("key") or "").strip()
        if not key:
            continue
        if key in by_key:
            continue
        by_key[key] = row

    if include_virtual_uncategorized and VIRTUAL_CUSTOM_UNCATEGORIZED_KEY not in by_key:
        by_key[VIRTUAL_CUSTOM_UNCATEGORIZED_KEY] = _class_row(
            key=VIRTUAL_CUSTOM_UNCATEGORIZED_KEY,
            display_name="Uncategorized",
            description="Custom tools without an assigned class.",
            parent_key="custom",
            origin="builtin",
            is_enabled=True,
        )

    out = list(by_key.values())
    _validate_tree(out)
    out.sort(key=lambda r: str(r.get("key") or ""))
    return out


def class_map(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row.get("key") or ""): row for row in rows if str(row.get("key") or "").strip()}


def class_descendants(rows: list[dict[str, Any]], class_key: str) -> set[str]:
    needle = normalize_class_key(class_key)
    if not needle:
        return set()
    by_parent: dict[str, set[str]] = {}
    for row in rows:
        parent = str(row.get("parent_key") or "").strip()
        key = str(row.get("key") or "").strip()
        if not key:
            continue
        if parent:
            by_parent.setdefault(parent, set()).add(key)

    out: set[str] = set()
    stack: list[str] = [needle]
    while stack:
        current = stack.pop()
        if current in out:
            continue
        out.add(current)
        for child in by_parent.get(current, set()):
            stack.append(child)
    return out


def class_path_chain(rows: list[dict[str, Any]], key: str | None) -> list[str]:
    k = normalize_class_key(key)
    if not k:
        return []
    by_key = class_map(rows)
    out: list[str] = []
    seen: set[str] = set()
    cur = k
    while cur and cur not in seen:
        seen.add(cur)
        out.append(cur)
        parent = str((by_key.get(cur) or {}).get("parent_key") or "").strip()
        cur = parent or ""
    out.reverse()
    return out
