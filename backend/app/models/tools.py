from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any


class RepoGrepRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None  # optional filter; grep operates on repo_path
    pattern: str
    glob: Optional[str] = None          # e.g. "*.ts" or "src/**/*.py"
    case_sensitive: bool = False
    regex: bool = True                  # if False, treat as fixed string
    max_results: int = 50
    context_lines: int = 2


class GrepMatch(BaseModel):
    path: str
    line: int
    column: int
    snippet: str
    before: List[str] = []
    after: List[str] = []


class RepoGrepResponse(BaseModel):
    matches: List[GrepMatch]


class OpenFileRequest(BaseModel):
    project_id: str
    path: str
    ref: Optional[str] = None           # branch name or commit hash; if set uses `git show`
    start_line: Optional[int] = None    # 1-based inclusive
    end_line: Optional[int] = None      # 1-based inclusive
    max_chars: int = 200_000


class OpenFileResponse(BaseModel):
    path: str
    ref: Optional[str]
    start_line: int
    end_line: int
    content: str


class KeywordSearchRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    query: str
    top_k: int = 10
    source: Optional[Literal["confluence", "github", "any"]] = "any"


class KeywordHit(BaseModel):
    id: str = Field(..., description="Mongo _id as string")
    score: Optional[float] = None
    path: Optional[str] = None
    title: Optional[str] = None
    source: Optional[str] = None
    branch: Optional[str] = None
    preview: str


class KeywordSearchResponse(BaseModel):
    hits: List[KeywordHit]


class ProjectMetadataResponse(BaseModel):
    id: str
    key: Optional[str] = None
    name: Optional[str] = None
    repo_path: str
    default_branch: str = "main"
    extra: Dict[str, Any] = {}

class ChromaCountRequest(BaseModel):
    projectId: str

class ChromaCountResponse(BaseModel):
    count: int

class ChromaSearchChunksRequest(BaseModel):
    projectId: str
    query: str
    top_k: int = 6
    max_sipped_chars: int = 500

class ChromaSearchChunkResponse(BaseModel):
    query: str
    items: List[Dict[str, Any]]
    count: int

class ChromaOpenChunksRequest(BaseModel):
    projectId: str
    ids: List[str]
    max_chars_per_chunk: int = 2000

class ChromaOpenChunksResponse(BaseModel):
    result: List[Dict[str, Any]]
