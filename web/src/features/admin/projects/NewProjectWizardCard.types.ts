import type { Dispatch, SetStateAction } from "react"
import type {
    AzureDevOpsForm,
    BitbucketForm,
    ConfluenceForm,
    CreateConnectorType,
    GitForm,
    JiraForm,
    LlmProfileDoc,
    LlmProviderOption,
    LocalConnectorForm,
    ProjectForm,
    RepoSourceMode,
} from "@/features/admin/projects/form-model"

export type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

export type NewProjectWizardCardProps = {
    compactWizard: boolean
    wizardStep: number
    stepStatus: boolean[]
    canOpenStep: (target: number) => boolean
    setWizardStep: Dispatch<SetStateAction<number>>
    createRepoMode: RepoSourceMode
    setCreateRepoMode: Dispatch<SetStateAction<RepoSourceMode>>
    setPathPickerTarget: Dispatch<SetStateAction<"createRepoPath" | "editRepoPath" | null>>
    createForm: ProjectForm
    setCreateForm: Dispatch<SetStateAction<ProjectForm>>
    createGitForm: GitForm
    setCreateGitForm: Dispatch<SetStateAction<GitForm>>
    createBitbucketForm: BitbucketForm
    setCreateBitbucketForm: Dispatch<SetStateAction<BitbucketForm>>
    createAzureDevOpsForm: AzureDevOpsForm
    setCreateAzureDevOpsForm: Dispatch<SetStateAction<AzureDevOpsForm>>
    createLocalConnectorForm: LocalConnectorForm
    setCreateLocalConnectorForm: Dispatch<SetStateAction<LocalConnectorForm>>
    createConfluenceForm: ConfluenceForm
    setCreateConfluenceForm: Dispatch<SetStateAction<ConfluenceForm>>
    createJiraForm: JiraForm
    setCreateJiraForm: Dispatch<SetStateAction<JiraForm>>
    createOptionalConnectors: CreateConnectorType[]
    createConnectorChoices: CreateConnectorType[]
    toggleCreateOptionalConnector: (type: CreateConnectorType) => void
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (setForm: Dispatch<SetStateAction<ProjectForm>>, nextProvider: string) => void
    loadLlmOptions: (opts?: LoadOptionsArgs) => Promise<void>
    loadingLlmOptions: boolean
    llmOptionsError: string | null
    defaultBaseUrlForProvider: (provider: string) => string
    createModelOptions: string[]
    primaryRepoConnector: CreateConnectorType
    createRepoBranch: string
    selectedCreateConnectorTypes: CreateConnectorType[]
    ingestOnCreate: boolean
    setIngestOnCreate: Dispatch<SetStateAction<boolean>>
    busy: boolean
    repoValid: boolean
    projectValid: boolean
    llmValid: boolean
    createProjectFromWizard: () => Promise<void>
    resetCreateWorkflow: () => void
    setError: Dispatch<SetStateAction<string | null>>
}
