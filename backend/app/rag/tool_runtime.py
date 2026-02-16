from __future__ import annotations

from typing import Any, Callable, Dict, Tuple
from pydantic import BaseModel, ValidationError

from ..models.tools import (
    RepoGrepRequest, RepoGrepResponse,
    OpenFileRequest, OpenFileResponse,
    KeywordSearchRequest, KeywordSearchResponse,
    ProjectMetadataResponse,
)

# Your real implementations go here
# (stub signatures shown; replace with your actual logic)

async def get_project_metadata(project_id: str) -> ProjectMetadataResponse:
    # load from Mongo "projects" collection, etc.
    # must return repo_path + default_branch at least
    raise NotImplementedError

async def repo_grep(req: RepoGrepRequest) -> RepoGrepResponse:
    raise NotImplementedError

async def open_file(req: OpenFileRequest) -> OpenFileResponse:
    raise NotImplementedError

async def keyword_search(req: KeywordSearchRequest) -> KeywordSearchResponse:
    raise NotImplementedError


ToolHandler = Callable[[BaseModel], Any]

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, Tuple[type[BaseModel], Callable[[Any], Any]]] = {}

    def register(self, name: str, model: type[BaseModel], fn: Callable[[Any], Any]):
        self._tools[name] = (model, fn)

    async def call(self, name: str, args: dict) -> dict:
        if name not in self._tools:
            return {"error": f"Unknown tool: {name}"}

        model, fn = self._tools[name]
        try:
            parsed = model(**args)
        except ValidationError as e:
            return {"error": "ValidationError", "details": e.errors()}

        out = fn(parsed)
        if hasattr(out, "__await__"):
            out = await out

        # return as plain dict for the LLM
        return out.model_dump() if hasattr(out, "model_dump") else out


def build_registry() -> ToolRegistry:
    reg = ToolRegistry()

    # wrapper model for get_project_metadata
    class _MetaReq(BaseModel):
        project_id: str

    async def _meta(req: _MetaReq):
        return await get_project_metadata(req.project_id)

    reg.register("get_project_metadata", _MetaReq, _meta)
    reg.register("repo_grep", RepoGrepRequest, repo_grep)
    reg.register("open_file", OpenFileRequest, open_file)
    reg.register("keyword_search", KeywordSearchRequest, keyword_search)
    return reg
