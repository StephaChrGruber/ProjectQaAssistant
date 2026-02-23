import type { DrawerChat } from "@/components/ProjectDrawerLayout"

export type ProjectDoc = {
  _id: string
  key?: string
  name?: string
  description?: string
  repo_path?: string
  default_branch?: string
  llm_provider?: string
  llm_base_url?: string
  llm_model?: string
  llm_api_key?: string
  llm_profile_id?: string
  extra?: Record<string, any>
}

export type MeResponse = {
  user?: {
    displayName?: string
    email?: string
    isGlobalAdmin?: boolean
  }
}

export type BranchesResponse = {
  branches?: string[]
}

export type ConnectorDoc = {
  id?: string
  type: "confluence" | "jira" | "github" | "bitbucket" | "azure_devops" | "local"
  isEnabled: boolean
  config: Record<string, unknown>
}

export type ConnectorsResponse = ConnectorDoc[]

export type ProjectEditForm = {
  name: string
  description: string
  repo_path: string
  default_branch: string
  llm_provider: string
  llm_base_url: string
  llm_model: string
  llm_api_key: string
  llm_profile_id: string
  grounding_require_sources: boolean
  grounding_min_sources: number
  routing_enabled: boolean
  routing_fast_profile_id: string
  routing_strong_profile_id: string
  routing_fallback_profile_id: string
  security_read_only_non_admin: boolean
  security_allow_write_members: boolean
}

export type GitForm = {
  isEnabled: boolean
  owner: string
  repo: string
  branch: string
  token: string
  paths: string
}

export type BitbucketForm = {
  isEnabled: boolean
  workspace: string
  repo: string
  branch: string
  username: string
  app_password: string
  paths: string
  base_url: string
}

export type AzureDevOpsForm = {
  isEnabled: boolean
  organization: string
  project: string
  repository: string
  branch: string
  pat: string
  paths: string
  base_url: string
}

export type LocalConnectorForm = {
  isEnabled: boolean
  paths: string
}

export type LlmProfileDoc = {
  id: string
  name: string
  provider: string
  model: string
}

export type ConfluenceForm = {
  isEnabled: boolean
  baseUrl: string
  spaceKey: string
  email: string
  apiToken: string
}

export type JiraForm = {
  isEnabled: boolean
  baseUrl: string
  email: string
  apiToken: string
  jql: string
}

export type LlmProviderOption = {
  value: string
  label: string
  defaultBaseUrl: string
  requiresApiKey: boolean
}

export type LlmOptionsResponse = {
  providers: LlmProviderOption[]
  ollama_models: string[]
  openai_models: string[]
  discovery_error?: string | null
  openai_discovery_error?: string | null
  ollama_discovery_error?: string | null
}

export type QaMetricsResponse = {
  project_id: string
  hours: number
  branch?: string | null
  tool_calls: number
  tool_errors: number
  tool_timeouts: number
  tool_latency_avg_ms: number
  tool_latency_p95_ms: number
  assistant_messages: number
  answers_with_sources: number
  source_coverage_pct: number
  grounded_failures: number
  avg_tool_calls_per_answer: number
  tool_summary: Array<{
    tool: string
    calls: number
    errors: number
    timeouts: number
    avg_duration_ms: number
    p95_duration_ms: number
  }>
}

export type EvalRunResponse = {
  id?: string
  summary?: {
    total?: number
    ok?: number
    failed?: number
    with_sources?: number
    source_coverage_pct?: number
    avg_latency_ms?: number
    avg_tool_calls?: number
  }
}

export type FeatureFlags = {
  enable_audit_events: boolean
  enable_connector_health: boolean
  enable_memory_controls: boolean
  dry_run_tools_default: boolean
  require_approval_for_write_tools: boolean
}

export type FeatureFlagsResponse = {
  project_id: string
  feature_flags: FeatureFlags
  defaults?: FeatureFlags
}

export type ConnectorHealthItem = {
  id: string
  type: string
  isEnabled: boolean
  ok: boolean
  severity?: string
  detail?: string
  latency_ms?: number
  updatedAt?: string | null
}

export type ConnectorHealthResponse = {
  project_id: string
  total: number
  ok: number
  failed: number
  items: ConnectorHealthItem[]
}

export const FALLBACK_OLLAMA_MODELS = ["llama3.2:3b", "llama3.1:8b", "mistral:7b", "qwen2.5:7b"]
export const FALLBACK_OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"]

export const DEFAULT_PROVIDER_OPTIONS: LlmProviderOption[] = [
  {
    value: "ollama",
    label: "Ollama (local)",
    defaultBaseUrl: "http://ollama:11434/v1",
    requiresApiKey: false,
  },
  {
    value: "openai",
    label: "ChatGPT / OpenAI API",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
  },
]

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function makeChatId(projectId: string, branch: string, user: string): string {
  return `${projectId}::${branch}::${user}::${Date.now().toString(36)}`
}

export function maskSecret(secret?: string): string {
  if (!secret) return "not set"
  if (secret.length <= 6) return "***"
  return `${secret.slice(0, 3)}...${secret.slice(-2)}`
}

export function asStr(v: unknown): string {
  return typeof v === "string" ? v : ""
}

export function normalizedOpenAiKey(input?: string): string {
  const key = (input || "").trim()
  if (!key) return ""
  if (key.toLowerCase() === "ollama") return ""
  if (key.startsWith("***")) return ""
  return key
}

export function csvToList(v: string): string[] {
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

export function getConnector(connectors: ConnectorDoc[], type: ConnectorDoc["type"]): ConnectorDoc | undefined {
  return connectors.find((c) => c.type === type)
}

export function emptyGit(branch = "main"): GitForm {
  return { isEnabled: true, owner: "", repo: "", branch, token: "", paths: "" }
}

export function emptyConfluence(): ConfluenceForm {
  return { isEnabled: false, baseUrl: "", spaceKey: "", email: "", apiToken: "" }
}

export function emptyJira(): JiraForm {
  return { isEnabled: false, baseUrl: "", email: "", apiToken: "", jql: "" }
}

export function emptyBitbucket(): BitbucketForm {
  return {
    isEnabled: false,
    workspace: "",
    repo: "",
    branch: "main",
    username: "",
    app_password: "",
    paths: "",
    base_url: "https://api.bitbucket.org/2.0",
  }
}

export function emptyAzureDevOps(): AzureDevOpsForm {
  return {
    isEnabled: false,
    organization: "",
    project: "",
    repository: "",
    branch: "main",
    pat: "",
    paths: "",
    base_url: "https://dev.azure.com",
  }
}

export function emptyLocalConnector(): LocalConnectorForm {
  return {
    isEnabled: false,
    paths: "",
  }
}

export function dedupeChatsById(items: DrawerChat[]): DrawerChat[] {
  const out: DrawerChat[] = []
  const seen = new Set<string>()
  for (const item of items || []) {
    const id = (item?.chat_id || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}
