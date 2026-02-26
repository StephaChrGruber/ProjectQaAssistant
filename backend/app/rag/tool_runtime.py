from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Deque, Dict, Optional

from pydantic import BaseModel, ValidationError

from ..db import get_db
from ..models.tools import (
    CompareBranchesRequest,
    ChromaCountRequest,
    ChromaOpenChunksRequest,
    ChromaSearchChunksRequest,
    CreateAutomationRequest,
    CreateChatTaskRequest,
    CreateJiraIssueRequest,
    DeleteAutomationRequest,
    GenerateProjectDocsRequest,
    GetToolDetailsRequest,
    GetToolDetailsResponse,
    GetProjectMetadataRequest,
    GitCheckoutBranchRequest,
    GitCommitRequest,
    GitCreateBranchRequest,
    GitDiffRequest,
    GitFetchRequest,
    GitListBranchesRequest,
    GitLogRequest,
    GitPullRequest,
    GitPushRequest,
    GitShowFileAtRefRequest,
    GitStageFilesRequest,
    GitStatusRequest,
    GitUnstageFilesRequest,
    ListAutomationTemplatesRequest,
    ListAutomationsRequest,
    ListChatTasksRequest,
    KeywordSearchRequest,
    ListToolsRequest,
    ListToolsResponse,
    OpenFileRequest,
    RequestUserInputRequest,
    ReadChatMessagesRequest,
    ReadDocsFolderRequest,
    RepoGrepRequest,
    RepoTreeRequest,
    RunTestsRequest,
    SearchToolsRequest,
    SearchToolsResponse,
    SymbolSearchRequest,
    ToolEnvelope,
    ToolError,
    RunAutomationRequest,
    UpdateAutomationRequest,
    UpdateChatTaskRequest,
    WriteDocumentationFileRequest,
    WorkspaceGetContextRequest,
)
from .tool_exec import (
    compare_branches,
    chroma_count,
    chroma_open_chunks,
    chroma_search_chunks,
    create_automation,
    create_chat_task,
    create_jira_issue,
    delete_automation,
    generate_project_docs,
    git_checkout_branch,
    git_commit,
    git_create_branch,
    get_project_metadata,
    git_diff,
    git_fetch,
    git_list_branches,
    git_log,
    git_pull,
    git_push,
    git_show_file_at_ref,
    git_stage_files,
    git_status,
    git_unstage_files,
    list_automation_templates,
    list_automations,
    list_chat_tasks,
    keyword_search,
    open_file,
    request_user_input,
    read_chat_messages,
    workspace_get_context,
    read_docs_folder,
    repo_grep,
    repo_tree,
    run_tests,
    symbol_search,
    run_automation,
    update_automation,
    update_chat_task,
    write_documentation_file,
)

logger = logging.getLogger(__name__)

BROWSER_LOCAL_REPO_PREFIX = "browser-local://"


@dataclass
class ToolContext:
    project_id: str
    branch: str
    user_id: str
    chat_id: str | None = None
    policy: dict[str, Any] | None = None


@dataclass
class ToolSpec:
    name: str
    description: str
    model: type[BaseModel]
    handler: Callable[..., Awaitable[Any]]
    timeout_sec: int = 45
    rate_limit_per_min: int = 40
    read_only: bool = True
    max_retries: int = 0
    cache_ttl_sec: int = 0
    require_approval: bool = False
    origin: str = "builtin"
    runtime: str = "backend"
    version: str = ""
    allow_extra_args: bool = False


class ToolRuntime:
    def __init__(self):
        self._tools: Dict[str, ToolSpec] = {}
        self._windows: Dict[str, Deque[float]] = defaultdict(deque)
        self._cache: Dict[str, tuple[float, ToolEnvelope]] = {}
        self._capability_cache: Dict[str, tuple[float, dict[str, Any]]] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def tool_names(self) -> list[str]:
        return sorted(self._tools.keys())

    def has_tool(self, name: str) -> bool:
        return name in self._tools

    def _policy_dict(self, ctx: ToolContext) -> dict[str, Any]:
        p = ctx.policy or {}
        if isinstance(p, dict):
            return p
        return {}

    def _field_names(self, model_cls: type[BaseModel]) -> set[str]:
        if hasattr(model_cls, "model_fields"):
            return set(getattr(model_cls, "model_fields").keys())
        if hasattr(model_cls, "__fields__"):
            return set(getattr(model_cls, "__fields__").keys())
        return set()

    def _as_tool_name_set(self, raw: Any) -> set[str]:
        out: set[str] = set()
        if not isinstance(raw, list):
            return out
        for item in raw:
            s = str(item or "").strip()
            if s:
                out.add(s)
        return out

    def _coerce_int(self, raw: Any, default: int, min_value: int, max_value: int) -> int:
        if raw is None:
            return default
        try:
            v = int(raw)
        except Exception:
            return default
        return max(min_value, min(max_value, v))

    def _tool_override_int(
        self,
        policy: dict[str, Any],
        *,
        name: str,
        key: str,
        fallback: int,
        min_value: int,
        max_value: int,
    ) -> int:
        raw = policy.get(key)
        if isinstance(raw, dict):
            return self._coerce_int(raw.get(name), fallback, min_value, max_value)
        return fallback

    def _capability_cache_key(self, ctx: ToolContext) -> str:
        return "|".join(
            [
                str(ctx.project_id or "").strip(),
                str(ctx.branch or "").strip(),
                str(ctx.user_id or "").strip(),
                str(ctx.chat_id or "").strip(),
            ]
        )

    def _is_browser_local_repo(self, repo_path: str) -> bool:
        return str(repo_path or "").strip().lower().startswith(BROWSER_LOCAL_REPO_PREFIX)

    def _has_any_nonempty(self, values: list[Any]) -> bool:
        for item in values:
            if isinstance(item, str):
                if item.strip():
                    return True
                continue
            if item is not None and str(item).strip():
                return True
        return False

    def _connector_is_configured(self, connector_type: str, config: dict[str, Any]) -> bool:
        ctype = str(connector_type or "").strip()
        cfg = config or {}

        if ctype in {"github", "git"}:
            owner = str(cfg.get("owner") or "").strip()
            repo = str(cfg.get("repo") or "").strip()
            token = str(cfg.get("token") or "").strip()
            return bool(owner and repo and token)

        if ctype == "bitbucket":
            workspace = str(cfg.get("workspace") or "").strip()
            repo = str(cfg.get("repo_slug") or cfg.get("repo") or "").strip()
            token = str(cfg.get("token") or "").strip()
            username = str(cfg.get("username") or "").strip()
            app_password = str(cfg.get("app_password") or cfg.get("appPassword") or "").strip()
            has_auth = bool(token) or bool(username and app_password)
            return bool(workspace and repo and has_auth)

        if ctype == "azure_devops":
            organization = str(cfg.get("organization") or cfg.get("org") or "").strip()
            project = str(cfg.get("project") or "").strip()
            repository = str(cfg.get("repository") or cfg.get("repo") or "").strip()
            pat = str(cfg.get("pat") or cfg.get("token") or "").strip()
            return bool(organization and project and repository and pat)

        if ctype == "jira":
            base_url = str(cfg.get("baseUrl") or "").strip()
            email = str(cfg.get("email") or "").strip()
            api_token = str(cfg.get("apiToken") or "").strip()
            return bool(base_url and email and api_token)

        if ctype == "local":
            paths = cfg.get("paths")
            has_paths = isinstance(paths, list) and self._has_any_nonempty(list(paths))
            repo_path = str(cfg.get("repo_path") or "").strip()
            return has_paths or bool(repo_path)

        return False

    async def _context_capabilities(self, ctx: ToolContext) -> dict[str, Any]:
        key = self._capability_cache_key(ctx)
        now = time.time()
        cached = self._capability_cache.get(key)
        if cached and now < cached[0]:
            return dict(cached[1])

        project_id = str(ctx.project_id or "").strip()
        db = get_db()
        project_doc: dict[str, Any] | None = None
        if project_id:
            project_doc = await db["projects"].find_one({"_id": project_id})
            if not project_doc:
                try:
                    from bson import ObjectId  # lazy import to keep dependency local

                    if ObjectId.is_valid(project_id):
                        project_doc = await db["projects"].find_one({"_id": ObjectId(project_id)})
                except Exception:
                    project_doc = None
            if not project_doc:
                project_doc = await db["projects"].find_one({"key": project_id})

        repo_path = str((project_doc or {}).get("repo_path") or "").strip()
        browser_local = self._is_browser_local_repo(repo_path)
        local_repo_exists = bool(repo_path and not browser_local and Path(repo_path).exists())
        has_user = bool(str(ctx.user_id or "").strip())
        has_chat = bool(str(ctx.chat_id or "").strip())

        connector_project_id = str((project_doc or {}).get("_id") or project_id).strip() or project_id
        rows = await db["connectors"].find({"projectId": connector_project_id, "isEnabled": True}).to_list(length=200)
        by_type: dict[str, dict[str, Any]] = {}
        for row in rows:
            t = str(row.get("type") or "").strip()
            if t and t not in by_type:
                by_type[t] = row

        remote_git_configured = False
        for t in ("github", "git", "bitbucket", "azure_devops"):
            row = by_type.get(t)
            if not row:
                continue
            if self._connector_is_configured(t, row.get("config") or {}):
                remote_git_configured = True
                break

        local_connector_configured = False
        local_row = by_type.get("local")
        if local_row and self._connector_is_configured("local", local_row.get("config") or {}):
            local_connector_configured = True

        jira_configured = False
        jira_row = by_type.get("jira")
        if jira_row and self._connector_is_configured("jira", jira_row.get("config") or {}):
            jira_configured = True

        capabilities = {
            "project_found": bool(project_doc),
            "repo_path": repo_path,
            "browser_local_repo": browser_local,
            "local_repo_exists": local_repo_exists,
            "local_connector_configured": local_connector_configured,
            "remote_git_configured": remote_git_configured,
            "jira_configured": jira_configured,
            "has_user": has_user,
            "has_chat": has_chat,
        }
        self._capability_cache[key] = (now + 8.0, capabilities)
        return dict(capabilities)

    async def _tool_capability_allowed(self, name: str, spec: ToolSpec, ctx: ToolContext) -> tuple[bool, str]:
        if name in {"list_tools", "search_tools", "get_tool_details", "get_project_metadata"}:
            return True, ""

        caps = await self._context_capabilities(ctx)
        has_project = bool(caps.get("project_found"))
        has_repo_read = bool(
            caps.get("local_repo_exists")
            or caps.get("remote_git_configured")
            or (caps.get("browser_local_repo") and caps.get("has_user"))
            or (caps.get("local_connector_configured") and caps.get("has_user"))
        )
        has_git_branch = bool(
            caps.get("local_repo_exists")
            or caps.get("remote_git_configured")
            or (caps.get("browser_local_repo") and caps.get("has_user"))
            or (caps.get("local_connector_configured") and caps.get("has_user"))
        )
        has_local_repo = bool(caps.get("local_repo_exists") and not caps.get("browser_local_repo"))
        has_docs_read = bool(
            caps.get("local_repo_exists")
            or caps.get("remote_git_configured")
            or (caps.get("browser_local_repo") and caps.get("has_user"))
            or (caps.get("local_connector_configured") and caps.get("has_user"))
        )
        has_docs_generate = bool(
            has_local_repo
            or (caps.get("browser_local_repo") and caps.get("has_user"))
            or (caps.get("local_connector_configured") and caps.get("has_user"))
        )
        has_git_fetch = bool(caps.get("local_repo_exists") or (caps.get("browser_local_repo") and caps.get("has_user")))

        if name in {"repo_tree", "repo_grep", "open_file", "symbol_search", "git_show_file_at_ref"}:
            return (has_repo_read, "repo_source_unavailable" if not has_repo_read else "")

        if name in {
            "create_automation",
            "list_automations",
            "update_automation",
            "delete_automation",
            "run_automation",
            "list_automation_templates",
        }:
            return (has_project, "project_not_found" if not has_project else "")

        if name == "read_docs_folder":
            return (has_docs_read, "documentation_source_unavailable" if not has_docs_read else "")

        if name in {"git_list_branches", "git_checkout_branch", "git_create_branch"}:
            return (has_git_branch, "git_source_unavailable" if not has_git_branch else "")

        if name == "git_fetch":
            return (has_git_fetch, "git_source_unavailable" if not has_git_fetch else "")

        if name in {
            "git_pull",
            "git_push",
            "git_status",
            "git_diff",
            "git_log",
            "git_stage_files",
            "git_unstage_files",
            "git_commit",
            "compare_branches",
            "run_tests",
        }:
            return (has_local_repo, "local_repository_unavailable" if not has_local_repo else "")

        if name == "write_documentation_file":
            return (has_docs_generate, "local_repository_unavailable" if not has_docs_generate else "")

        if name == "generate_project_docs":
            return (has_docs_generate, "local_repository_unavailable" if not has_docs_generate else "")

        if name == "create_jira_issue":
            return (bool(caps.get("jira_configured")), "jira_connector_not_configured" if not caps.get("jira_configured") else "")

        if name in {"request_user_input", "read_chat_messages"}:
            return (bool(caps.get("has_chat")), "chat_context_missing" if not caps.get("has_chat") else "")
        if name == "workspace_get_context":
            return (bool(caps.get("has_chat")), "chat_context_missing" if not caps.get("has_chat") else "")

        if spec.origin == "custom" and str(spec.runtime or "").strip() == "local_typescript":
            return (bool(caps.get("has_user")), "user_context_missing_for_local_tool" if not caps.get("has_user") else "")

        return True, ""

    def _is_tool_allowed(self, name: str, spec: ToolSpec, policy: dict[str, Any]) -> tuple[bool, str]:
        always_allowed = {"list_tools", "search_tools", "get_tool_details", "request_user_input"}
        if name in always_allowed:
            return True, ""

        allowed = self._as_tool_name_set(policy.get("allowed_tools") or policy.get("allow_tools"))
        blocked = self._as_tool_name_set(policy.get("blocked_tools") or policy.get("deny_tools"))
        approved = self._as_tool_name_set(policy.get("approved_tools"))

        if name in blocked:
            return False, "blocked_by_policy"
        if allowed and name not in allowed:
            return False, "not_in_allowed_tools"

        read_only_only = bool(policy.get("read_only_only"))
        if read_only_only and not spec.read_only:
            return False, "read_only_only_mode"
        if bool(policy.get("require_approval_for_write_tools")) and not spec.read_only and name not in approved:
            return False, "write_approval_required"
        if spec.require_approval and name not in approved:
            return False, "approval_required"

        return True, ""

    async def _invoke_handler(self, spec: ToolSpec, payload: BaseModel, ctx: ToolContext) -> Any:
        try:
            sig = inspect.signature(spec.handler)
            param_count = len(sig.parameters)
        except Exception:
            param_count = 1
        if param_count >= 2:
            return await spec.handler(payload, ctx)
        return await spec.handler(payload)

    def _forbidden_error(self, name: str, reason: str) -> ToolEnvelope:
        return ToolEnvelope(
            tool=name,
            ok=False,
            duration_ms=0,
            attempts=1,
            error=ToolError(
                code="forbidden",
                message=f"Tool '{name}' is disabled by policy ({reason})",
                retryable=False,
                details={"reason": reason},
            ),
        )

    def _cache_key(self, name: str, merged: dict[str, Any]) -> str:
        raw = json.dumps({"tool": name, "args": merged}, ensure_ascii=False, sort_keys=True, default=str)
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        return f"{name}:{digest}"

    def _transient_execution_error(self, err: Exception) -> bool:
        msg = str(err).lower()
        if not msg:
            return False
        markers = (
            "timeout",
            "timed out",
            "temporarily unavailable",
            "connection reset",
            "connection refused",
            "connection aborted",
            "too many requests",
            "rate limit",
            "429",
            "502",
            "503",
            "504",
        )
        return any(m in msg for m in markers)

    def _allowed_arg_names(self, model_cls: type[BaseModel]) -> set[str]:
        allowed: set[str] = set()
        fields = getattr(model_cls, "model_fields", None)
        if fields is None:
            fields = getattr(model_cls, "__fields__", {})

        for fname, f in fields.items():
            allowed.add(fname)
            alias = getattr(f, "alias", None)
            if alias:
                allowed.add(str(alias))
        return allowed

    def _merge_context_defaults(self, model_cls: type[BaseModel], args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
        out = dict(args or {})
        names = self._field_names(model_cls)

        # Always pin tool calls to the active project/user/chat context.
        # This prevents model hallucinations from routing tools to wrong chats/projects.
        if "project_id" in names:
            out["project_id"] = ctx.project_id
        if "projectId" in names:
            out["projectId"] = ctx.project_id

        if "branch" in names and "branch" not in out:
            out["branch"] = ctx.branch

        if "chat_id" in names and ctx.chat_id:
            out["chat_id"] = ctx.chat_id

        if "user_id" in names:
            out["user_id"] = ctx.user_id
        if "user" in names:
            out["user"] = ctx.user_id

        return out

    def _rate_limit_error(self, name: str, limit: int) -> ToolEnvelope:
        return ToolEnvelope(
            tool=name,
            ok=False,
            duration_ms=0,
            error=ToolError(
                code="rate_limited",
                message=f"Tool '{name}' rate limited ({limit}/min)",
                retryable=True,
            ),
        )

    def _unknown_tool_error(self, name: str) -> ToolEnvelope:
        return ToolEnvelope(
            tool=name,
            ok=False,
            duration_ms=0,
            error=ToolError(code="unknown_tool", message=f"Unknown tool: {name}", retryable=False),
        )

    async def execute(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolEnvelope:
        spec = self._tools.get(name)
        if not spec:
            logger.warning("tool.unknown tool=%s", name)
            return self._unknown_tool_error(name)

        policy = self._policy_dict(ctx)
        logger.info(
            "tool.execute.start tool=%s project=%s chat=%s branch=%s read_only_only=%s allowed=%s blocked=%s arg_keys=%s",
            name,
            ctx.project_id,
            ctx.chat_id or "",
            ctx.branch,
            bool(policy.get("read_only_only")),
            len(self._as_tool_name_set(policy.get("allowed_tools") or policy.get("allow_tools"))),
            len(self._as_tool_name_set(policy.get("blocked_tools") or policy.get("deny_tools"))),
            sorted(list((args or {}).keys())),
        )
        allowed, reason = self._is_tool_allowed(name, spec, policy)
        if not allowed:
            logger.warning("tool.forbidden tool=%s reason=%s", name, reason)
            return self._forbidden_error(name, reason)
        capability_allowed, capability_reason = await self._tool_capability_allowed(name, spec, ctx)
        if not capability_allowed:
            logger.warning("tool.unavailable tool=%s reason=%s", name, capability_reason)
            return self._forbidden_error(name, capability_reason)

        effective_timeout = self._tool_override_int(
            policy,
            name=name,
            key="timeout_overrides",
            fallback=spec.timeout_sec,
            min_value=1,
            max_value=3600,
        )
        effective_rate = self._tool_override_int(
            policy,
            name=name,
            key="rate_limit_overrides",
            fallback=spec.rate_limit_per_min,
            min_value=1,
            max_value=6000,
        )
        effective_retries = self._tool_override_int(
            policy,
            name=name,
            key="retry_overrides",
            fallback=spec.max_retries,
            min_value=0,
            max_value=5,
        )
        effective_cache_ttl = self._tool_override_int(
            policy,
            name=name,
            key="cache_ttl_overrides",
            fallback=spec.cache_ttl_sec,
            min_value=0,
            max_value=3600,
        )

        now = time.time()
        window = self._windows[name]
        while window and now - window[0] > 60.0:
            window.popleft()
        if len(window) >= max(1, effective_rate):
            logger.warning("tool.rate_limited tool=%s in_window=%s limit=%s", name, len(window), effective_rate)
            return self._rate_limit_error(name, effective_rate)
        window.append(now)

        merged = self._merge_context_defaults(spec.model, args or {}, ctx)
        input_raw = json.dumps(merged, ensure_ascii=False, default=str)
        started = time.perf_counter()

        unknown_keys = sorted(set(merged.keys()) - self._allowed_arg_names(spec.model))
        if unknown_keys and not spec.allow_extra_args:
            duration_ms = int((time.perf_counter() - started) * 1000)
            details = {"unknown_args": unknown_keys}
            logger.warning("tool.validation_failed tool=%s unknown_args=%s", name, unknown_keys)
            return ToolEnvelope(
                tool=name,
                ok=False,
                duration_ms=duration_ms,
                input_bytes=len(input_raw.encode("utf-8")),
                error=ToolError(
                    code="validation_error",
                    message="Tool argument validation failed",
                    retryable=False,
                    details=details,
                ),
            )

        cache_key = self._cache_key(name, merged)
        if spec.read_only and effective_cache_ttl > 0:
            cached_item = self._cache.get(cache_key)
            if cached_item:
                expires_at, cached_envelope = cached_item
                if now < expires_at:
                    data = cached_envelope.model_dump()
                    data["cached"] = True
                    data["duration_ms"] = 0
                    data["attempts"] = 1
                    logger.info("tool.cache_hit tool=%s ttl_remaining=%.2fs", name, max(0.0, expires_at - now))
                    if hasattr(ToolEnvelope, "model_validate"):
                        return ToolEnvelope.model_validate(data)
                    return ToolEnvelope.parse_obj(data)
                self._cache.pop(cache_key, None)

        try:
            if hasattr(spec.model, "model_validate"):
                payload = spec.model.model_validate(merged)
            else:
                payload = spec.model.parse_obj(merged)
        except ValidationError as err:
            duration_ms = int((time.perf_counter() - started) * 1000)
            details = {"errors": err.errors()}
            logger.warning("tool.validation_failed tool=%s errors=%s", name, details)
            return ToolEnvelope(
                tool=name,
                ok=False,
                duration_ms=duration_ms,
                input_bytes=len(input_raw.encode("utf-8")),
                error=ToolError(
                    code="validation_error",
                    message="Tool argument validation failed",
                    retryable=False,
                    details=details,
                ),
            )

        if bool(policy.get("dry_run")) and not spec.read_only:
            duration_ms = int((time.perf_counter() - started) * 1000)
            dry_result = {
                "dry_run": True,
                "skipped": True,
                "message": "Dry-run enabled. Tool execution was skipped.",
                "tool": name,
                "args": merged,
            }
            result_raw = json.dumps(dry_result, ensure_ascii=False, default=str)
            logger.info(
                "tool.dry_run_skip tool=%s duration_ms=%s input_bytes=%s result_bytes=%s",
                name,
                duration_ms,
                len(input_raw.encode("utf-8")),
                len(result_raw.encode("utf-8")),
            )
            return ToolEnvelope(
                tool=name,
                ok=True,
                duration_ms=duration_ms,
                attempts=1,
                input_bytes=len(input_raw.encode("utf-8")),
                result_bytes=len(result_raw.encode("utf-8")),
                result=dry_result,
            )

        attempts = 0
        result_obj: Any = None
        while True:
            attempts += 1
            try:
                result_obj = await asyncio.wait_for(self._invoke_handler(spec, payload, ctx), timeout=max(1, effective_timeout))
                break
            except asyncio.TimeoutError:
                duration_ms = int((time.perf_counter() - started) * 1000)
                if attempts <= effective_retries:
                    logger.warning(
                        "tool.timeout_retry tool=%s attempt=%s/%s timeout_sec=%s",
                        name,
                        attempts,
                        effective_retries + 1,
                        effective_timeout,
                    )
                    await asyncio.sleep(min(1.0, 0.2 * attempts))
                    continue
                logger.warning("tool.timeout tool=%s timeout_sec=%s attempts=%s", name, effective_timeout, attempts)
                return ToolEnvelope(
                    tool=name,
                    ok=False,
                    duration_ms=duration_ms,
                    attempts=attempts,
                    input_bytes=len(input_raw.encode("utf-8")),
                    error=ToolError(
                        code="timeout",
                        message=f"Tool '{name}' timed out",
                        retryable=False,
                        details={"timeout_sec": effective_timeout},
                    ),
                )
            except Exception as err:
                retryable = self._transient_execution_error(err)
                if retryable and attempts <= effective_retries:
                    logger.warning(
                        "tool.execution_retry tool=%s attempt=%s/%s err=%s",
                        name,
                        attempts,
                        effective_retries + 1,
                        err,
                    )
                    await asyncio.sleep(min(1.0, 0.2 * attempts))
                    continue

                duration_ms = int((time.perf_counter() - started) * 1000)
                logger.exception("tool.execution_failed tool=%s attempts=%s", name, attempts)
                return ToolEnvelope(
                    tool=name,
                    ok=False,
                    duration_ms=duration_ms,
                    attempts=attempts,
                    input_bytes=len(input_raw.encode("utf-8")),
                    error=ToolError(
                        code="execution_error",
                        message=str(err),
                        retryable=retryable,
                    ),
                )

        if hasattr(result_obj, "model_dump"):
            result = result_obj.model_dump()
        elif hasattr(result_obj, "dict"):
            result = result_obj.dict()
        else:
            result = result_obj

        result_raw = json.dumps(result, ensure_ascii=False, default=str)
        duration_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "tool.success tool=%s duration_ms=%s input_bytes=%s result_bytes=%s",
            name,
            duration_ms,
            len(input_raw.encode("utf-8")),
            len(result_raw.encode("utf-8")),
        )
        envelope = ToolEnvelope(
            tool=name,
            ok=True,
            duration_ms=duration_ms,
            attempts=attempts,
            input_bytes=len(input_raw.encode("utf-8")),
            result_bytes=len(result_raw.encode("utf-8")),
            result=result,
        )
        if spec.read_only and effective_cache_ttl > 0:
            self._cache[cache_key] = (time.time() + effective_cache_ttl, envelope)
        return envelope

    def schema_text(self) -> str:
        lines: list[str] = []
        for name in self.tool_names():
            spec = self._tools[name]
            lines.append(name)
            lines.append(f"  Description: {spec.description}")
            lines.append(f"  Timeout: {spec.timeout_sec}s")
            lines.append(f"  Rate limit: {spec.rate_limit_per_min}/min")
            lines.append(f"  Retries: {spec.max_retries}")
            lines.append(f"  Read only: {str(bool(spec.read_only)).lower()}")
            if spec.require_approval:
                lines.append("  Requires approval: true")
            if spec.origin != "builtin":
                lines.append(f"  Origin: {spec.origin}")
            if spec.runtime:
                lines.append(f"  Runtime: {spec.runtime}")
            if spec.version:
                lines.append(f"  Version: {spec.version}")
            if spec.cache_ttl_sec > 0:
                lines.append(f"  Cache TTL: {spec.cache_ttl_sec}s")
            lines.append("  Parameters:")

            model = spec.model
            fields = getattr(model, "model_fields", None)
            if fields is None:
                fields = getattr(model, "__fields__", {})

            if not fields:
                lines.append("  - none")
            else:
                for fname, f in fields.items():
                    ann = getattr(f, "annotation", None) or getattr(f, "outer_type_", Any)
                    type_name = getattr(ann, "__name__", str(ann))
                    required = False
                    if hasattr(f, "is_required"):
                        required = bool(f.is_required())
                    elif hasattr(f, "required"):
                        required = bool(getattr(f, "required"))
                    req = "REQUIRED" if required else "OPTIONAL"
                    lines.append(f"  - {fname}: {type_name} ({req})")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    def catalog(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for name in self.tool_names():
            spec = self._tools[name]
            fields_meta: list[dict[str, Any]] = []
            fields = getattr(spec.model, "model_fields", None)
            if fields is None:
                fields = getattr(spec.model, "__fields__", {})

            for fname, f in fields.items():
                ann = getattr(f, "annotation", None) or getattr(f, "outer_type_", Any)
                type_name = getattr(ann, "__name__", str(ann))
                required = False
                if hasattr(f, "is_required"):
                    required = bool(f.is_required())
                elif hasattr(f, "required"):
                    required = bool(getattr(f, "required"))
                fields_meta.append(
                    {
                        "name": fname,
                        "type": type_name,
                        "required": required,
                    }
                )

            out.append(
                {
                    "name": name,
                    "description": spec.description,
                    "timeout_sec": spec.timeout_sec,
                    "rate_limit_per_min": spec.rate_limit_per_min,
                    "max_retries": spec.max_retries,
                    "cache_ttl_sec": spec.cache_ttl_sec,
                    "read_only": spec.read_only,
                    "require_approval": spec.require_approval,
                    "origin": spec.origin,
                    "runtime": spec.runtime,
                    "version": spec.version,
                    "parameters": fields_meta,
                }
            )
        return out

    async def available_tool_names(self, ctx: ToolContext) -> set[str]:
        rows = await _catalog_with_policy(
            self,
            ctx,
            include_unavailable=False,
            include_parameters=False,
            limit=5000,
        )
        return {str(row.get("name") or "").strip() for row in rows if str(row.get("name") or "").strip()}

    async def schema_text_for_context(self, ctx: ToolContext, *, include_unavailable: bool = False) -> str:
        rows = await _catalog_with_policy(
            self,
            ctx,
            include_unavailable=bool(include_unavailable),
            include_parameters=True,
            limit=5000,
        )
        lines: list[str] = []
        for row in rows:
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            lines.append(name)
            lines.append(f"  Description: {str(row.get('description') or '')}")
            lines.append(f"  Timeout: {int(row.get('timeout_sec') or 0)}s")
            lines.append(f"  Rate limit: {int(row.get('rate_limit_per_min') or 0)}/min")
            lines.append(f"  Retries: {int(row.get('max_retries') or 0)}")
            lines.append(f"  Read only: {str(bool(row.get('read_only'))).lower()}")
            if bool(row.get("require_approval")):
                lines.append("  Requires approval: true")
            origin = str(row.get("origin") or "").strip()
            if origin and origin != "builtin":
                lines.append(f"  Origin: {origin}")
            runtime = str(row.get("runtime") or "").strip()
            if runtime:
                lines.append(f"  Runtime: {runtime}")
            version = str(row.get("version") or "").strip()
            if version:
                lines.append(f"  Version: {version}")
            ttl = int(row.get("cache_ttl_sec") or 0)
            if ttl > 0:
                lines.append(f"  Cache TTL: {ttl}s")
            lines.append("  Parameters:")
            params = row.get("parameters")
            if not isinstance(params, list) or not params:
                lines.append("  - none")
            else:
                for p in params:
                    if not isinstance(p, dict):
                        continue
                    p_name = str(p.get("name") or "").strip()
                    p_type = str(p.get("type") or "Any").strip() or "Any"
                    req = "REQUIRED" if bool(p.get("required")) else "OPTIONAL"
                    if p_name:
                        lines.append(f"  - {p_name}: {p_type} ({req})")
            lines.append("")
        return ("\n".join(lines).rstrip() + "\n") if lines else ""


def _meta_handler(req: GetProjectMetadataRequest):
    return get_project_metadata(req.project_id)


async def _docs_handler(req: GenerateProjectDocsRequest, ctx: Any | None = None):
    return await generate_project_docs(req.project_id, req.branch, ctx=ctx)


def _show_file_handler(req: GitShowFileAtRefRequest):
    open_req = OpenFileRequest(
        project_id=req.project_id,
        path=req.path,
        ref=req.ref,
        start_line=req.start_line,
        end_line=req.end_line,
        max_chars=req.max_chars,
    )
    return open_file(open_req)


async def _catalog_with_policy(
    runtime: ToolRuntime,
    ctx: ToolContext,
    *,
    include_unavailable: bool,
    include_parameters: bool,
    query: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query_lc = str(query or "").strip().lower()
    policy = runtime._policy_dict(ctx)
    rows = runtime.catalog()
    out: list[dict[str, Any]] = []

    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        spec = runtime._tools.get(name)
        if not spec:
            continue

        allowed, reason = runtime._is_tool_allowed(name, spec, policy)
        if allowed:
            capability_allowed, capability_reason = await runtime._tool_capability_allowed(name, spec, ctx)
            if not capability_allowed:
                allowed = False
                reason = capability_reason
        if not include_unavailable and not allowed:
            continue

        if query_lc:
            hay_parts: list[str] = [
                name,
                str(row.get("description") or ""),
                str(row.get("origin") or ""),
                str(row.get("runtime") or ""),
                str(row.get("version") or ""),
            ]
            params = row.get("parameters")
            if isinstance(params, list):
                for p in params:
                    if not isinstance(p, dict):
                        continue
                    hay_parts.append(str(p.get("name") or ""))
                    hay_parts.append(str(p.get("type") or ""))
            hay = " ".join(hay_parts).lower()
            if query_lc not in hay:
                continue

        item = dict(row)
        item["available"] = bool(allowed)
        if not allowed:
            item["blocked_reason"] = reason
        if not include_parameters:
            item.pop("parameters", None)
        out.append(item)

    out.sort(key=lambda x: str(x.get("name") or ""))
    return out[: max(1, min(int(limit or 200), 1000))]


def build_default_tool_runtime(
    *,
    enabled_names: set[str] | None = None,
    spec_overrides: dict[str, dict[str, Any]] | None = None,
) -> ToolRuntime:
    rt = ToolRuntime()

    async def _list_tools_handler(req: ListToolsRequest, ctx: ToolContext) -> ListToolsResponse:
        rows = await _catalog_with_policy(
            rt,
            ctx,
            include_unavailable=False,
            include_parameters=bool(req.include_parameters),
            limit=max(1, min(int(req.limit or 200), 500)),
        )
        return ListToolsResponse(count=len(rows), tools=rows)

    async def _search_tools_handler(req: SearchToolsRequest, ctx: ToolContext) -> SearchToolsResponse:
        rows = await _catalog_with_policy(
            rt,
            ctx,
            include_unavailable=False,
            include_parameters=bool(req.include_parameters),
            query=str(req.query or ""),
            limit=max(1, min(int(req.limit or 20), 200)),
        )
        return SearchToolsResponse(query=str(req.query or ""), count=len(rows), tools=rows)

    async def _get_tool_details_handler(req: GetToolDetailsRequest, ctx: ToolContext) -> GetToolDetailsResponse:
        rows = await _catalog_with_policy(
            rt,
            ctx,
            include_unavailable=False,
            include_parameters=True,
            limit=1000,
        )
        needle = str(req.tool_name or "").strip().lower()
        item = next((row for row in rows if str(row.get("name") or "").strip().lower() == needle), None)
        return GetToolDetailsResponse(found=bool(item), tool=item)

    rt.register(
        ToolSpec(
            name="get_project_metadata",
            description="Looks up project metadata in Mongo.",
            model=GetProjectMetadataRequest,
            handler=_meta_handler,
            timeout_sec=20,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=30,
        )
    )
    rt.register(
        ToolSpec(
            name="list_tools",
            description="Lists available tools for the current chat context.",
            model=ListToolsRequest,
            handler=_list_tools_handler,
            timeout_sec=10,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="search_tools",
            description="Searches available tools by name/description/parameter names.",
            model=SearchToolsRequest,
            handler=_search_tools_handler,
            timeout_sec=10,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="get_tool_details",
            description="Returns full details for a specific tool, including accepted parameters.",
            model=GetToolDetailsRequest,
            handler=_get_tool_details_handler,
            timeout_sec=10,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="repo_tree",
            description="Lists repository files/folders with depth/path filters.",
            model=RepoTreeRequest,
            handler=repo_tree,
            timeout_sec=35,
            rate_limit_per_min=60,
            max_retries=1,
            cache_ttl_sec=20,
        )
    )
    rt.register(
        ToolSpec(
            name="repo_grep",
            description="Searches text patterns in repository files.",
            model=RepoGrepRequest,
            handler=repo_grep,
            timeout_sec=40,
            rate_limit_per_min=80,
            max_retries=1,
            cache_ttl_sec=12,
        )
    )
    rt.register(
        ToolSpec(
            name="keyword_search",
            description="Text keyword search over ingested project chunks.",
            model=KeywordSearchRequest,
            handler=keyword_search,
            timeout_sec=35,
            rate_limit_per_min=100,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="symbol_search",
            description="Finds likely code symbols (functions/classes/interfaces/etc.).",
            model=SymbolSearchRequest,
            handler=symbol_search,
            timeout_sec=40,
            rate_limit_per_min=80,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="open_file",
            description="Reads file contents (optionally at specific ref/line range).",
            model=OpenFileRequest,
            handler=open_file,
            timeout_sec=35,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=20,
        )
    )
    rt.register(
        ToolSpec(
            name="read_chat_messages",
            description="Reads recent messages from the current chat (for conversational context).",
            model=ReadChatMessagesRequest,
            handler=read_chat_messages,
            timeout_sec=20,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="workspace_get_context",
            description="Returns active workspace context (open tabs, dirty drafts, recent patch runs).",
            model=WorkspaceGetContextRequest,
            handler=workspace_get_context,
            timeout_sec=20,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="request_user_input",
            description="Creates a follow-up question that requires direct user input (open text or option selection).",
            model=RequestUserInputRequest,
            handler=request_user_input,
            timeout_sec=20,
            rate_limit_per_min=80,
            max_retries=1,
            cache_ttl_sec=0,
            read_only=True,
        )
    )
    rt.register(
        ToolSpec(
            name="git_list_branches",
            description="Lists branches from local repo or configured remote git connector.",
            model=GitListBranchesRequest,
            handler=git_list_branches,
            timeout_sec=35,
            rate_limit_per_min=90,
            max_retries=1,
            cache_ttl_sec=8,
        )
    )
    rt.register(
        ToolSpec(
            name="git_checkout_branch",
            description="Checks out/switches branch (local) or switches active connector branch (remote).",
            model=GitCheckoutBranchRequest,
            handler=git_checkout_branch,
            timeout_sec=45,
            rate_limit_per_min=40,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_create_branch",
            description="Creates a new branch from a source ref (local or remote connector).",
            model=GitCreateBranchRequest,
            handler=git_create_branch,
            timeout_sec=55,
            rate_limit_per_min=30,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_stage_files",
            description="Stages selected files (or all) in local repository.",
            model=GitStageFilesRequest,
            handler=git_stage_files,
            timeout_sec=35,
            rate_limit_per_min=60,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_unstage_files",
            description="Unstages selected files (or all) in local repository.",
            model=GitUnstageFilesRequest,
            handler=git_unstage_files,
            timeout_sec=35,
            rate_limit_per_min=60,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_commit",
            description="Creates a git commit in local repository.",
            model=GitCommitRequest,
            handler=git_commit,
            timeout_sec=50,
            rate_limit_per_min=25,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_fetch",
            description="Fetches refs from remote in local repository.",
            model=GitFetchRequest,
            handler=git_fetch,
            timeout_sec=70,
            rate_limit_per_min=25,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_pull",
            description="Pulls updates from remote branch in local repository.",
            model=GitPullRequest,
            handler=git_pull,
            timeout_sec=90,
            rate_limit_per_min=20,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_push",
            description="Pushes local branch to remote repository.",
            model=GitPushRequest,
            handler=git_push,
            timeout_sec=90,
            rate_limit_per_min=15,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="git_status",
            description="Shows git working tree status for the project repository.",
            model=GitStatusRequest,
            handler=git_status,
            timeout_sec=25,
            rate_limit_per_min=90,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="git_diff",
            description="Returns git diff for working tree or between refs.",
            model=GitDiffRequest,
            handler=git_diff,
            timeout_sec=30,
            rate_limit_per_min=90,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="git_log",
            description="Returns recent commit history.",
            model=GitLogRequest,
            handler=git_log,
            timeout_sec=25,
            rate_limit_per_min=90,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="git_show_file_at_ref",
            description="Reads a file at a specific git ref.",
            model=GitShowFileAtRefRequest,
            handler=_show_file_handler,
            timeout_sec=35,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=20,
        )
    )
    rt.register(
        ToolSpec(
            name="compare_branches",
            description="Compares two branches and returns changed files summary.",
            model=CompareBranchesRequest,
            handler=compare_branches,
            timeout_sec=45,
            rate_limit_per_min=60,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="read_docs_folder",
            description="Reads markdown files from documentation folder for a branch.",
            model=ReadDocsFolderRequest,
            handler=read_docs_folder,
            timeout_sec=40,
            rate_limit_per_min=80,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="generate_project_docs",
            description="Generates or refreshes repository documentation files.",
            model=GenerateProjectDocsRequest,
            handler=_docs_handler,
            timeout_sec=900,
            rate_limit_per_min=8,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="run_tests",
            description="Runs repository tests with a configured/safe command.",
            model=RunTestsRequest,
            handler=run_tests,
            timeout_sec=900,
            rate_limit_per_min=15,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="write_documentation_file",
            description="Writes/updates a markdown file under documentation/ in the local repository.",
            model=WriteDocumentationFileRequest,
            handler=write_documentation_file,
            timeout_sec=45,
            rate_limit_per_min=30,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="create_jira_issue",
            description="Creates a Jira issue using configured Jira connector.",
            model=CreateJiraIssueRequest,
            handler=create_jira_issue,
            timeout_sec=45,
            rate_limit_per_min=20,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="create_chat_task",
            description="Creates an actionable task item linked to the current chat.",
            model=CreateChatTaskRequest,
            handler=create_chat_task,
            timeout_sec=20,
            rate_limit_per_min=40,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="list_chat_tasks",
            description="Lists task items for the current project/chat.",
            model=ListChatTasksRequest,
            handler=list_chat_tasks,
            timeout_sec=20,
            rate_limit_per_min=80,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="update_chat_task",
            description="Updates an existing chat task (status/title/details/assignee/due date).",
            model=UpdateChatTaskRequest,
            handler=update_chat_task,
            timeout_sec=20,
            rate_limit_per_min=40,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="create_automation",
            description="Creates a project automation with trigger, optional conditions, and action.",
            model=CreateAutomationRequest,
            handler=create_automation,
            timeout_sec=25,
            rate_limit_per_min=30,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="list_automations",
            description="Lists configured automations for the current project.",
            model=ListAutomationsRequest,
            handler=list_automations,
            timeout_sec=20,
            rate_limit_per_min=90,
            max_retries=1,
            cache_ttl_sec=5,
        )
    )
    rt.register(
        ToolSpec(
            name="update_automation",
            description="Updates an existing automation (name/enabled/trigger/conditions/action/cooldown/tags).",
            model=UpdateAutomationRequest,
            handler=update_automation,
            timeout_sec=25,
            rate_limit_per_min=30,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="delete_automation",
            description="Deletes an automation and its run history.",
            model=DeleteAutomationRequest,
            handler=delete_automation,
            timeout_sec=20,
            rate_limit_per_min=30,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="run_automation",
            description="Runs an automation immediately in manual mode.",
            model=RunAutomationRequest,
            handler=run_automation,
            timeout_sec=1200,
            rate_limit_per_min=20,
            read_only=False,
        )
    )
    rt.register(
        ToolSpec(
            name="list_automation_templates",
            description="Lists built-in automation templates that can be applied quickly.",
            model=ListAutomationTemplatesRequest,
            handler=list_automation_templates,
            timeout_sec=15,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=30,
        )
    )

    rt.register(
        ToolSpec(
            name="chroma_count",
            description="Returns chunk count in Chroma collection.",
            model=ChromaCountRequest,
            handler=chroma_count,
            timeout_sec=25,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="chroma_search_chunks",
            description="Semantic search over indexed chunks.",
            model=ChromaSearchChunksRequest,
            handler=chroma_search_chunks,
            timeout_sec=30,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )
    rt.register(
        ToolSpec(
            name="chroma_open_chunks",
            description="Opens chunk IDs from Chroma.",
            model=ChromaOpenChunksRequest,
            handler=chroma_open_chunks,
            timeout_sec=30,
            rate_limit_per_min=120,
            max_retries=1,
            cache_ttl_sec=10,
        )
    )

    if enabled_names is not None:
        allowed = set(str(x).strip() for x in enabled_names if str(x).strip())
        rt._tools = {name: spec for name, spec in rt._tools.items() if name in allowed}

    if isinstance(spec_overrides, dict) and spec_overrides:
        for name, ov in spec_overrides.items():
            spec = rt._tools.get(name)
            if not spec or not isinstance(ov, dict):
                continue
            if "description" in ov and ov.get("description") is not None:
                spec.description = str(ov.get("description") or spec.description)
            if "timeout_sec" in ov and ov.get("timeout_sec") is not None:
                spec.timeout_sec = max(1, min(int(ov.get("timeout_sec")), 3600))
            if "rate_limit_per_min" in ov and ov.get("rate_limit_per_min") is not None:
                spec.rate_limit_per_min = max(1, min(int(ov.get("rate_limit_per_min")), 6000))
            if "max_retries" in ov and ov.get("max_retries") is not None:
                spec.max_retries = max(0, min(int(ov.get("max_retries")), 5))
            if "cache_ttl_sec" in ov and ov.get("cache_ttl_sec") is not None:
                spec.cache_ttl_sec = max(0, min(int(ov.get("cache_ttl_sec")), 3600))
            if "read_only" in ov and ov.get("read_only") is not None:
                spec.read_only = bool(ov.get("read_only"))
            if "require_approval" in ov and ov.get("require_approval") is not None:
                spec.require_approval = bool(ov.get("require_approval"))

    return rt
