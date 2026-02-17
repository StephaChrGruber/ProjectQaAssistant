from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class GetProjectMetadataRequest(BaseModel):
    project_id: str


class GenerateProjectDocsRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None


class RepoGrepRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    pattern: str
    glob: Optional[str] = None
    case_sensitive: bool = False
    regex: bool = True
    max_results: int = 50
    context_lines: int = 2


class GrepMatch(BaseModel):
    path: str
    line: int
    column: int
    snippet: str
    before: List[str] = Field(default_factory=list)
    after: List[str] = Field(default_factory=list)


class RepoGrepResponse(BaseModel):
    matches: List[GrepMatch]


class OpenFileRequest(BaseModel):
    project_id: str
    path: str
    branch: Optional[str] = None
    ref: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None
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
    source: Optional[Literal["confluence", "github", "jira", "any"]] = "any"


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
    extra: Dict[str, Any] = Field(default_factory=dict)


class ChromaCountRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    project_id: str = Field(alias="projectId")


class ChromaCountResponse(BaseModel):
    count: int


class ChromaSearchChunksRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    project_id: str = Field(alias="projectId")
    query: str
    top_k: int = 6
    max_snippet_chars: int = 500


class ChromaSearchChunkResponse(BaseModel):
    query: str
    items: List[Dict[str, Any]]
    count: int


class ChromaOpenChunksRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    project_id: str = Field(alias="projectId")
    ids: List[str]
    max_chars_per_chunk: int = 2000


class ChromaOpenChunksResponse(BaseModel):
    result: List[Dict[str, Any]] = Field(default_factory=list)


class RepoTreeRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    path: str = ""
    max_depth: int = 4
    include_files: bool = True
    include_dirs: bool = True
    max_entries: int = 800
    glob: Optional[str] = None


class RepoTreeNode(BaseModel):
    path: str
    type: Literal["file", "dir"]
    depth: int
    size: Optional[int] = None


class RepoTreeResponse(BaseModel):
    root: str
    branch: str
    entries: List[RepoTreeNode]


class GitStatusRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None


class GitStatusResponse(BaseModel):
    branch: str
    upstream: Optional[str] = None
    ahead: int = 0
    behind: int = 0
    staged: List[str] = Field(default_factory=list)
    modified: List[str] = Field(default_factory=list)
    untracked: List[str] = Field(default_factory=list)
    clean: bool = True


class GitDiffRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    ref_base: Optional[str] = None
    ref_head: Optional[str] = None
    path_glob: Optional[str] = None
    max_chars: int = 15_000


class GitDiffResponse(BaseModel):
    ref_base: Optional[str] = None
    ref_head: Optional[str] = None
    diff: str
    truncated: bool = False


class GitLogRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    ref: Optional[str] = None
    max_count: int = 20
    path: Optional[str] = None


class GitLogItem(BaseModel):
    commit: str
    author: str
    date: str
    subject: str


class GitLogResponse(BaseModel):
    ref: str
    commits: List[GitLogItem]


class GitShowFileAtRefRequest(BaseModel):
    project_id: str
    path: str
    ref: str
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    max_chars: int = 200_000


class SymbolSearchRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    query: str
    kinds: List[str] = Field(default_factory=list)
    max_results: int = 40


class SymbolSearchHit(BaseModel):
    path: str
    line: int
    kind: str
    symbol: str
    snippet: str


class SymbolSearchResponse(BaseModel):
    items: List[SymbolSearchHit]


class RunTestsRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    command: Optional[str] = None
    timeout_sec: int = 300
    max_output_chars: int = 20_000


class RunTestsResponse(BaseModel):
    command: str
    exit_code: int
    success: bool
    output: str
    truncated: bool = False


class ReadDocsFolderRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    path: str = "documentation"
    max_files: int = 80
    max_chars_per_file: int = 4_000


class ReadDocsFile(BaseModel):
    path: str
    content: str


class ReadDocsFolderResponse(BaseModel):
    branch: str
    files: List[ReadDocsFile]


class ReadChatMessagesRequest(BaseModel):
    project_id: str
    chat_id: str
    branch: Optional[str] = None
    user: Optional[str] = None
    limit: int = 40
    include_roles: List[str] = Field(default_factory=list)
    max_chars_per_message: int = 6000


class ChatMessageItem(BaseModel):
    role: str
    content: str
    ts: Optional[str] = None


class ReadChatMessagesResponse(BaseModel):
    chat_id: str
    found: bool
    total_messages: int = 0
    returned_messages: int = 0
    messages: List[ChatMessageItem] = Field(default_factory=list)


class ToolError(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: Dict[str, Any] = Field(default_factory=dict)


class ToolEnvelope(BaseModel):
    tool: str
    ok: bool
    duration_ms: int
    attempts: int = 1
    cached: bool = False
    input_bytes: int = 0
    result_bytes: int = 0
    result: Optional[Any] = None
    error: Optional[ToolError] = None


class ToolEventRecord(BaseModel):
    project_id: str
    chat_id: str
    branch: str
    user: str
    tool: str
    ok: bool
    duration_ms: int
    attempts: int = 1
    cached: bool = False
    input_bytes: int = 0
    result_bytes: int = 0
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str


class ToolEventSummaryItem(BaseModel):
    tool: str
    calls: int
    ok: int
    errors: int
    cached_hits: int
    avg_duration_ms: int
