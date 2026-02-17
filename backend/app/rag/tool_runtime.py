from __future__ import annotations

import asyncio
import inspect
import json
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Deque, Dict, Optional

from pydantic import BaseModel, ValidationError

from ..models.tools import (
    ChromaCountRequest,
    ChromaOpenChunksRequest,
    ChromaSearchChunksRequest,
    GenerateProjectDocsRequest,
    GetProjectMetadataRequest,
    GitDiffRequest,
    GitLogRequest,
    GitShowFileAtRefRequest,
    GitStatusRequest,
    KeywordSearchRequest,
    OpenFileRequest,
    ReadDocsFolderRequest,
    RepoGrepRequest,
    RepoTreeRequest,
    RunTestsRequest,
    SymbolSearchRequest,
    ToolEnvelope,
    ToolError,
)
from .tool_exec import (
    chroma_count,
    chroma_open_chunks,
    chroma_search_chunks,
    generate_project_docs,
    get_project_metadata,
    git_diff,
    git_log,
    git_show_file_at_ref,
    git_status,
    keyword_search,
    open_file,
    read_docs_folder,
    repo_grep,
    repo_tree,
    run_tests,
    symbol_search,
)

logger = logging.getLogger(__name__)


@dataclass
class ToolContext:
    project_id: str
    branch: str
    user_id: str


@dataclass
class ToolSpec:
    name: str
    description: str
    model: type[BaseModel]
    handler: Callable[[BaseModel], Awaitable[Any]]
    timeout_sec: int = 45
    rate_limit_per_min: int = 40
    read_only: bool = True


class ToolRuntime:
    def __init__(self):
        self._tools: Dict[str, ToolSpec] = {}
        self._windows: Dict[str, Deque[float]] = defaultdict(deque)

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def tool_names(self) -> list[str]:
        return sorted(self._tools.keys())

    def has_tool(self, name: str) -> bool:
        return name in self._tools

    def _field_names(self, model_cls: type[BaseModel]) -> set[str]:
        if hasattr(model_cls, "model_fields"):
            return set(getattr(model_cls, "model_fields").keys())
        if hasattr(model_cls, "__fields__"):
            return set(getattr(model_cls, "__fields__").keys())
        return set()

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

        if "project_id" in names and "project_id" not in out:
            out["project_id"] = ctx.project_id
        if "projectId" in names and "projectId" not in out:
            out["projectId"] = ctx.project_id

        if "branch" in names and "branch" not in out:
            out["branch"] = ctx.branch

        if "user_id" in names and "user_id" not in out:
            out["user_id"] = ctx.user_id
        if "user" in names and "user" not in out:
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
            return self._unknown_tool_error(name)

        now = time.time()
        window = self._windows[name]
        while window and now - window[0] > 60.0:
            window.popleft()
        if len(window) >= max(1, spec.rate_limit_per_min):
            logger.warning("tool.rate_limited tool=%s in_window=%s limit=%s", name, len(window), spec.rate_limit_per_min)
            return self._rate_limit_error(name, spec.rate_limit_per_min)
        window.append(now)

        merged = self._merge_context_defaults(spec.model, args or {}, ctx)
        input_raw = json.dumps(merged, ensure_ascii=False, default=str)
        started = time.perf_counter()

        unknown_keys = sorted(set(merged.keys()) - self._allowed_arg_names(spec.model))
        if unknown_keys:
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

        try:
            result_obj = await asyncio.wait_for(spec.handler(payload), timeout=max(1, spec.timeout_sec))
        except asyncio.TimeoutError:
            duration_ms = int((time.perf_counter() - started) * 1000)
            logger.warning("tool.timeout tool=%s timeout_sec=%s", name, spec.timeout_sec)
            return ToolEnvelope(
                tool=name,
                ok=False,
                duration_ms=duration_ms,
                input_bytes=len(input_raw.encode("utf-8")),
                error=ToolError(
                    code="timeout",
                    message=f"Tool '{name}' timed out",
                    retryable=True,
                    details={"timeout_sec": spec.timeout_sec},
                ),
            )
        except Exception as err:
            duration_ms = int((time.perf_counter() - started) * 1000)
            logger.exception("tool.execution_failed tool=%s", name)
            return ToolEnvelope(
                tool=name,
                ok=False,
                duration_ms=duration_ms,
                input_bytes=len(input_raw.encode("utf-8")),
                error=ToolError(
                    code="execution_error",
                    message=str(err),
                    retryable=False,
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
        return ToolEnvelope(
            tool=name,
            ok=True,
            duration_ms=duration_ms,
            input_bytes=len(input_raw.encode("utf-8")),
            result_bytes=len(result_raw.encode("utf-8")),
            result=result,
        )

    def schema_text(self) -> str:
        lines: list[str] = []
        for name in self.tool_names():
            spec = self._tools[name]
            lines.append(name)
            lines.append(f"  Description: {spec.description}")
            lines.append(f"  Timeout: {spec.timeout_sec}s")
            lines.append(f"  Rate limit: {spec.rate_limit_per_min}/min")
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


def _meta_handler(req: GetProjectMetadataRequest):
    return get_project_metadata(req.project_id)


def _docs_handler(req: GenerateProjectDocsRequest):
    return generate_project_docs(req.project_id, req.branch)


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


def build_default_tool_runtime() -> ToolRuntime:
    rt = ToolRuntime()

    rt.register(
        ToolSpec(
            name="get_project_metadata",
            description="Looks up project metadata in Mongo.",
            model=GetProjectMetadataRequest,
            handler=_meta_handler,
            timeout_sec=20,
            rate_limit_per_min=120,
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
            name="chroma_count",
            description="Returns chunk count in Chroma collection.",
            model=ChromaCountRequest,
            handler=chroma_count,
            timeout_sec=25,
            rate_limit_per_min=120,
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
        )
    )

    return rt
