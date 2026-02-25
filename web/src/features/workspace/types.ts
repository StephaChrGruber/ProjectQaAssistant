export type WorkspaceMode = "local" | "browser_local" | `remote:${string}` | "none"

export type WorkspaceCursor = {
  line: number
  column: number
}

export type WorkspaceSelection = {
  selected_text: string | null
  cursor: WorkspaceCursor | null
  scope: "selection" | "file" | "open_tabs"
}

export type WorkspaceCapabilitiesResponse = {
  project_id: string
  branch: string
  mode: WorkspaceMode
  repo_path?: string
  has_local_repo?: boolean
  has_browser_local_repo?: boolean
  has_remote_repo?: boolean
  remote_type?: string | null
  workspace_v1?: boolean
}

export type WorkspaceTreeEntry = {
  path: string
  type: "file" | "dir"
  depth: number
  size?: number | null
}

export type WorkspaceTreeResponse = {
  project_id: string
  branch: string
  root: string
  mode: WorkspaceMode
  entries: WorkspaceTreeEntry[]
}

export type WorkspaceFileResponse = {
  project_id: string
  branch: string
  path: string
  mode: WorkspaceMode
  content: string
  content_hash?: string
  truncated?: boolean
  read_only?: boolean
  read_only_reason?: "large_file" | "binary_file" | string | null
  size_bytes?: number | null
  web_url?: string
}

export type WorkspaceDraftSaveResponse = {
  project_id: string
  branch: string
  chat_id: string
  path: string
  version: number
  updated_at?: string
  content_hash?: string
}

export type WorkspaceDraftResponse = {
  found: boolean
  project_id: string
  branch: string
  chat_id: string
  path: string
  content?: string
  content_hash?: string
  version?: number
  updated_at?: string
}

export type WorkspaceHunk = {
  id: number
  op_index: number
  tag: "replace" | "insert" | "delete" | string
  old_start: number
  old_count: number
  new_start: number
  new_count: number
  summary: string
  preview_old?: string
  preview_new?: string
}

export type WorkspacePatchFile = {
  path: string
  base_hash?: string
  target_hash?: string
  unified_diff?: string
  hunks: WorkspaceHunk[]
  opcodes?: Array<[string, number, number, number, number]>
  target_content?: string
}

export type WorkspacePatch = {
  files: WorkspacePatchFile[]
  changed_files: number
  changed_hunks: number
  generated_at?: string
}

export type WorkspaceSuggestResponse = {
  project_id: string
  branch: string
  summary: string
  suggestion: {
    files: Array<{ path: string; content: string }>
    raw?: Record<string, unknown>
  }
  patch: WorkspacePatch
}

export type WorkspaceInlineSuggestionResponse = {
  project_id: string
  branch: string
  path: string
  cursor: WorkspaceCursor | null
  suggestion: string
}

export type WorkspacePatchApplyResponse = {
  applied: Array<{ path: string; content_hash?: string; bytes_written?: number; mode?: string }>
  conflicts: Array<{ path: string; reason: string; detail?: string; current_hash?: string; expected_hash?: string }>
  applied_count: number
  conflict_count: number
  ok: boolean
}

export type WorkspaceDiagnostic = {
  path: string
  line: number
  column?: number
  severity?: "error" | "warning" | "info" | string
  message: string
}

export type WorkspaceDiagnosticsRunResponse = {
  project_id: string
  branch: string
  chat_id?: string | null
  target: string
  paths: string[]
  command: string
  success: boolean
  exit_code: number
  output: string
  truncated: boolean
  markers: WorkspaceDiagnostic[]
  markers_count: number
  created_at: string
}

export type WorkspaceDiagnosticsLatestResponse =
  | ({ found: false; project_id: string; branch: string; chat_id?: string | null })
  | ({ found: true } & WorkspaceDiagnosticsRunResponse)

export type WorkspaceGitStatusResponse = {
  branch: string
  upstream?: string | null
  ahead: number
  behind: number
  staged: string[]
  modified: string[]
  untracked: string[]
  clean: boolean
}

export type WorkspaceGitStageResponse = {
  staged_paths: string[]
  status: string
}

export type WorkspaceGitUnstageResponse = {
  unstaged_paths: string[]
  status: string
}

export type WorkspaceGitCommitResponse = {
  branch: string
  commit: string
  summary: string
}

export type WorkspaceGitFetchResponse = {
  remote: string
  output: string
}

export type WorkspaceGitPullResponse = {
  remote: string
  branch: string
  output: string
}

export type WorkspaceGitPushResponse = {
  remote: string
  branch: string
  output: string
}

export type WorkspaceSessionLayout = {
  workspace_open: boolean
  dock_width: number
  left_tree_width?: number
  right_ai_width?: number
  diagnostics_open?: boolean
}

export type WorkspaceOpenTab = {
  path: string
  savedContent: string
  draftContent: string
  savedHash?: string
  dirty: boolean
  draftDirty: boolean
  loading?: boolean
  mode?: WorkspaceMode
  language?: string
  readOnly?: boolean
  readOnlyReason?: string | null
  sizeBytes?: number | null
  webUrl?: string
  allowLarge?: boolean
}
