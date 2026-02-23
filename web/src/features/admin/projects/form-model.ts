export type MeUser = {
  id?: string
  email?: string
  displayName?: string
  isGlobalAdmin?: boolean
}

export type MeResponse = {
  user?: MeUser
}

export type ConnectorDoc = {
  id?: string
  type: "confluence" | "jira" | "github" | "bitbucket" | "azure_devops" | "local"
  isEnabled: boolean
  config: Record<string, unknown>
}

export type AdminProject = {
  id: string
  key: string
  name: string
  description?: string
  repo_path?: string
  default_branch?: string
  llm_provider?: string
  llm_base_url?: string
  llm_model?: string
  llm_api_key?: string
  llm_profile_id?: string
  connectors?: ConnectorDoc[]
}

export type LlmProfileDoc = {
  id: string
  name: string
  description?: string
  provider: string
  base_url?: string
  model: string
  api_key?: string
  isEnabled?: boolean
}

export type LlmProfileForm = {
  name: string
  description: string
  provider: string
  base_url: string
  model: string
  api_key: string
  isEnabled: boolean
}

export type ProjectForm = {
  key: string
  name: string
  description: string
  repo_path: string
  default_branch: string
  llm_provider: string
  llm_base_url: string
  llm_model: string
  llm_api_key: string
  llm_profile_id: string
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

export type RepoSourceMode = "local" | "github" | "bitbucket" | "azure_devops"
export type CreateConnectorType = "github" | "bitbucket" | "azure_devops" | "local" | "confluence" | "jira"

export const CREATE_STEPS = ["Repository", "Project", "Connectors", "LLM", "Review"] as const
export const FALLBACK_OLLAMA_MODELS = ["llama3.2:3b", "llama3.1:8b", "mistral:7b", "qwen2.5:7b"]
export const FALLBACK_OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"]

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

export type DeleteProjectResponse = {
  projectId: string
  projectKey?: string
  deleted?: Record<string, number>
  chroma?: {
    path?: string
    deleted?: boolean
    error?: string | null
  }
}

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

export const CREATE_DRAFT_LOCAL_REPO_KEY = "draft:create:active"
export const CONNECTOR_LABELS: Record<CreateConnectorType, string> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
  azure_devops: "Azure DevOps",
  local: "Local Repository",
  confluence: "Confluence",
  jira: "Jira",
}

export function emptyProjectForm(): ProjectForm {
  return {
    key: "",
    name: "",
    description: "",
    repo_path: "",
    default_branch: "main",
    llm_provider: "ollama",
    llm_base_url: "http://ollama:11434/v1",
    llm_model: "llama3.2:3b",
    llm_api_key: "ollama",
    llm_profile_id: "",
  }
}

export function emptyGit(): GitForm {
  return { isEnabled: true, owner: "", repo: "", branch: "main", token: "", paths: "" }
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

export function emptyLlmProfileForm(): LlmProfileForm {
  return {
    name: "",
    description: "",
    provider: "ollama",
    base_url: "http://ollama:11434/v1",
    model: "llama3.2:3b",
    api_key: "ollama",
    isEnabled: true,
  }
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function csvToList(v: string): string[] {
  return v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
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

export function getConnector(project: AdminProject | undefined, type: ConnectorDoc["type"]): ConnectorDoc | undefined {
  return project?.connectors?.find((c) => c.type === type)
}

export function repoModeToConnector(mode: RepoSourceMode): CreateConnectorType {
  if (mode === "github") return "github"
  if (mode === "bitbucket") return "bitbucket"
  if (mode === "azure_devops") return "azure_devops"
  return "local"
}

export function connectorPayloads(
  git: GitForm,
  bitbucket: BitbucketForm,
  azureDevOps: AzureDevOpsForm,
  localConnector: LocalConnectorForm,
  confluence: ConfluenceForm,
  jira: JiraForm
) {
  return {
    git: {
      isEnabled: git.isEnabled,
      config: {
        owner: git.owner.trim(),
        repo: git.repo.trim(),
        branch: git.branch.trim() || "main",
        token: git.token.trim(),
        paths: csvToList(git.paths),
      },
    },
    bitbucket: {
      isEnabled: bitbucket.isEnabled,
      config: {
        workspace: bitbucket.workspace.trim(),
        repo_slug: bitbucket.repo.trim(),
        branch: bitbucket.branch.trim() || "main",
        username: bitbucket.username.trim(),
        app_password: bitbucket.app_password.trim(),
        paths: csvToList(bitbucket.paths),
        base_url: bitbucket.base_url.trim(),
      },
    },
    azure_devops: {
      isEnabled: azureDevOps.isEnabled,
      config: {
        organization: azureDevOps.organization.trim(),
        project: azureDevOps.project.trim(),
        repository: azureDevOps.repository.trim(),
        branch: azureDevOps.branch.trim() || "main",
        pat: azureDevOps.pat.trim(),
        paths: csvToList(azureDevOps.paths),
        base_url: azureDevOps.base_url.trim(),
      },
    },
    local: {
      isEnabled: localConnector.isEnabled,
      config: {
        paths: csvToList(localConnector.paths),
      },
    },
    confluence: {
      isEnabled: confluence.isEnabled,
      config: {
        baseUrl: confluence.baseUrl.trim(),
        spaceKey: confluence.spaceKey.trim(),
        email: confluence.email.trim(),
        apiToken: confluence.apiToken.trim(),
      },
    },
    jira: {
      isEnabled: jira.isEnabled,
      config: {
        baseUrl: jira.baseUrl.trim(),
        email: jira.email.trim(),
        apiToken: jira.apiToken.trim(),
        jql: jira.jql.trim(),
      },
    },
  }
}

