export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool"
  content: string
  ts?: string
  meta?: {
    tool_summary?: {
      calls?: number
      errors?: number
      cached_hits?: number
    }
    sources?: ChatAnswerSource[]
    grounded?: boolean
  }
}

export type ProjectDoc = {
  _id: string
  key?: string
  name?: string
  repo_path?: string
  default_branch?: string
  llm_provider?: string
  llm_model?: string
  llm_profile_id?: string
}

export type MeResponse = {
  user?: {
    id?: string
    email?: string
    displayName?: string
    isGlobalAdmin?: boolean
  }
}

export type BranchesResponse = {
  branches?: string[]
}

export type ChatResponse = {
  chat_id: string
  messages: ChatMessage[]
  memory_summary?: ChatMemorySummary
  pending_user_question?: PendingUserQuestion | null
}

export type AskAgentResponse = {
  answer?: string
  tool_events?: Array<{
    tool: string
    ok: boolean
    duration_ms: number
    attempts?: number
    cached?: boolean
    input_bytes?: number
    result_bytes?: number
    error?: {
      code?: string
      message?: string
      retryable?: boolean
    } | null
  }>
  sources?: ChatAnswerSource[]
  grounded?: boolean
  memory_summary?: ChatMemorySummary
  task_state?: ChatTaskState
  pending_user_question?: PendingUserQuestion | null
}

export type LocalToolClaimResponse = {
  job: import("@/lib/local-custom-tool-runner").LocalToolJobPayload | null
}

export type LlmProfileDoc = {
  id: string
  name: string
  provider: string
  model: string
}

export type ChatLlmProfileResponse = {
  chat_id: string
  llm_profile_id?: string | null
}

export type ChatAnswerSource = {
  label: string
  kind?: "url" | "documentation" | "file" | string
  source?: string
  url?: string
  path?: string
  line?: number
  snippet?: string
  confidence?: number
}

export type ChatMemorySummary = {
  decisions?: string[]
  open_questions?: string[]
  next_steps?: string[]
  goals?: string[]
  constraints?: string[]
  blockers?: string[]
  assumptions?: string[]
  knowledge?: string[]
  updated_at?: string
}

export type ChatTaskState = {
  goals?: string[]
  constraints?: string[]
  decisions?: string[]
  open_questions?: string[]
  next_steps?: string[]
  blockers?: string[]
  assumptions?: string[]
  knowledge?: string[]
  updated_at?: string
}

export type ChatMemoryStateResponse = {
  chat_id: string
  memory_summary?: ChatMemorySummary
  task_state?: ChatTaskState
  hierarchical_memory?: Record<string, unknown>
}

export type PendingUserQuestion = {
  id: string
  question: string
  answer_mode: "open_text" | "single_choice"
  options?: string[]
  created_at?: string
}

export type ChatTaskItem = {
  id: string
  title: string
  details?: string
  status: "open" | "in_progress" | "blocked" | "done" | "cancelled" | string
  assignee?: string | null
  due_date?: string | null
  created_at?: string
  updated_at?: string
}

export type ChatTasksResponse = {
  chat_id: string
  items?: ChatTaskItem[]
}

export type ToolCatalogItem = {
  name: string
  description?: string
  timeout_sec?: number
  rate_limit_per_min?: number
  max_retries?: number
  cache_ttl_sec?: number
  read_only?: boolean
  require_approval?: boolean
  origin?: string
  runtime?: string
  version?: string
}

export type ToolCatalogResponse = {
  tools: ToolCatalogItem[]
}

export type ChatToolPolicy = {
  allowed_tools?: string[]
  blocked_tools?: string[]
  read_only_only?: boolean
  dry_run?: boolean
  require_approval_for_write_tools?: boolean
}

export type ChatToolPolicyResponse = {
  chat_id: string
  tool_policy?: ChatToolPolicy
}

export type ChatToolApproval = {
  toolName: string
  expiresAt?: string
}

export type ChatToolApprovalsResponse = {
  chat_id: string
  items?: ChatToolApproval[]
}

export type GenerateDocsResponse = {
  branch?: string
  current_branch?: string
  mode?: string
  summary?: string
  llm_error?: string | null
  files_written?: string[]
  files?: Array<{ path: string; content: string }>
}

export type DocumentationFileEntry = {
  path: string
  size?: number | null
  updated_at?: string | null
}

export type DocumentationListResponse = {
  branch?: string
  current_branch?: string
  files?: DocumentationFileEntry[]
}

export type DocumentationFileResponse = {
  branch?: string
  path: string
  content: string
}

export type DocTreeNode = {
  kind: "folder" | "file"
  name: string
  path: string
  file?: DocumentationFileEntry
  children?: DocTreeNode[]
}

export type ChatChartSeries = {
  key: string
  label?: string
  color?: string
}

export type ChatChartSpec = {
  type: "line" | "bar"
  title?: string
  data: Array<Record<string, string | number>>
  xKey: string
  series: ChatChartSeries[]
  height?: number
}

export type TokenKind = "plain" | "keyword" | "string" | "number" | "comment" | "operator" | "type" | "builtin"

export type Token = {
  kind: TokenKind
  text: string
}

export type LangRule = {
  kind: Exclude<TokenKind, "plain">
  re: RegExp
}
