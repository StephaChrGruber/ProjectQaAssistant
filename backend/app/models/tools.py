from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class GetProjectMetadataRequest(BaseModel):
    project_id: str


class GenerateProjectDocsRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None


class RepoGrepRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    project_id: str
    branch: Optional[str] = None
    pattern: str = Field(alias="query")
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
    source: Optional[Literal["confluence", "github", "bitbucket", "azure_devops", "jira", "local", "any"]] = "any"


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


class GitBranchItem(BaseModel):
    name: str
    is_default: bool = False
    commit: Optional[str] = None


class GitListBranchesRequest(BaseModel):
    project_id: str
    max_branches: int = 200


class GitListBranchesResponse(BaseModel):
    active_branch: str
    default_branch: str
    remote_mode: bool = False
    branches: List[GitBranchItem] = Field(default_factory=list)


class GitCheckoutBranchRequest(BaseModel):
    project_id: str
    branch: str
    create_if_missing: bool = False
    start_point: Optional[str] = None
    set_default_branch: bool = True


class GitCheckoutBranchResponse(BaseModel):
    branch: str
    previous_branch: Optional[str] = None
    created: bool = False
    remote_mode: bool = False
    message: str = ""


class GitCreateBranchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    project_id: str
    branch: str
    source_ref: Optional[str] = Field(default=None, alias="from_ref")
    checkout: bool = True
    set_default_branch: bool = True


class GitCreateBranchResponse(BaseModel):
    branch: str
    source_ref: str
    created: bool = True
    checked_out: bool = True
    remote_mode: bool = False
    message: str = ""


class GitStageFilesRequest(BaseModel):
    project_id: str
    paths: List[str] = Field(default_factory=list)
    all: bool = False


class GitStageFilesResponse(BaseModel):
    staged_paths: List[str] = Field(default_factory=list)
    status: str = ""


class GitUnstageFilesRequest(BaseModel):
    project_id: str
    paths: List[str] = Field(default_factory=list)
    all: bool = False


class GitUnstageFilesResponse(BaseModel):
    unstaged_paths: List[str] = Field(default_factory=list)
    status: str = ""


class GitCommitRequest(BaseModel):
    project_id: str
    message: str
    all: bool = False
    amend: bool = False


class GitCommitResponse(BaseModel):
    branch: str
    commit: str
    summary: str


class GitFetchRequest(BaseModel):
    project_id: str
    remote: str = "origin"
    prune: bool = False


class GitFetchResponse(BaseModel):
    remote: str
    output: str


class GitPullRequest(BaseModel):
    project_id: str
    remote: str = "origin"
    branch: Optional[str] = None
    rebase: bool = False


class GitPullResponse(BaseModel):
    remote: str
    branch: str
    output: str


class GitPushRequest(BaseModel):
    project_id: str
    remote: str = "origin"
    branch: Optional[str] = None
    set_upstream: bool = False
    force_with_lease: bool = False


class GitPushResponse(BaseModel):
    remote: str
    branch: str
    output: str


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


class CompareBranchesRequest(BaseModel):
    project_id: str
    base_branch: str
    target_branch: str
    max_files: int = 200


class BranchDiffFile(BaseModel):
    path: str
    status: str


class CompareBranchesResponse(BaseModel):
    base_branch: str
    target_branch: str
    changed_files: List[BranchDiffFile] = Field(default_factory=list)
    summary: str = ""


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


class ListToolsRequest(BaseModel):
    include_unavailable: bool = False
    include_parameters: bool = False
    limit: int = 200


class ListToolsResponse(BaseModel):
    count: int
    tools: List[Dict[str, Any]] = Field(default_factory=list)


class SearchToolsRequest(BaseModel):
    query: str
    include_unavailable: bool = False
    include_parameters: bool = False
    limit: int = 20


class SearchToolsResponse(BaseModel):
    query: str
    count: int
    tools: List[Dict[str, Any]] = Field(default_factory=list)


class GetToolDetailsRequest(BaseModel):
    tool_name: str
    include_unavailable: bool = True


class GetToolDetailsResponse(BaseModel):
    found: bool
    tool: Optional[Dict[str, Any]] = None


class RequestUserInputRequest(BaseModel):
    project_id: str
    chat_id: str
    question: str
    answer_mode: Literal["open_text", "single_choice"] = "open_text"
    options: List[str] = Field(default_factory=list)


class RequestUserInputResponse(BaseModel):
    id: str
    chat_id: str
    question: str
    answer_mode: Literal["open_text", "single_choice"] = "open_text"
    options: List[str] = Field(default_factory=list)
    awaiting: bool = True


class CreateJiraIssueRequest(BaseModel):
    project_id: str
    summary: str
    description: str
    issue_type: str = "Task"
    project_key: Optional[str] = None


class CreateJiraIssueResponse(BaseModel):
    key: str
    url: str
    summary: str


class WriteDocumentationFileRequest(BaseModel):
    project_id: str
    branch: Optional[str] = None
    path: str
    content: str
    overwrite: bool = True


class WriteDocumentationFileResponse(BaseModel):
    path: str
    bytes_written: int
    branch: str
    overwritten: bool


class CreateChatTaskRequest(BaseModel):
    project_id: str
    chat_id: Optional[str] = None
    title: str
    details: str = ""
    assignee: Optional[str] = None
    due_date: Optional[str] = None


class CreateChatTaskResponse(BaseModel):
    id: str
    title: str
    status: str
    created_at: str


class ChatTaskItem(BaseModel):
    id: str
    project_id: str
    chat_id: Optional[str] = None
    title: str
    details: str = ""
    status: str = "open"
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    created_at: str
    updated_at: str


class ListChatTasksRequest(BaseModel):
    project_id: str
    chat_id: Optional[str] = None
    status: Optional[str] = None
    assignee: Optional[str] = None
    limit: int = 50


class ListChatTasksResponse(BaseModel):
    total: int
    items: List[ChatTaskItem] = Field(default_factory=list)


class UpdateChatTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    project_id: str
    task_id: str = Field(alias="id")
    title: Optional[str] = None
    details: Optional[str] = None
    append_details: bool = False
    status: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None


class UpdateChatTaskResponse(BaseModel):
    item: ChatTaskItem


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
