"use client"

import { Dispatch, SetStateAction } from "react"
import AddRounded from "@mui/icons-material/AddRounded"
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    Chip,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Step,
    StepButton,
    Stepper,
    TextField,
    Typography,
} from "@mui/material"
import {
    CONNECTOR_LABELS,
    CREATE_STEPS,
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConfluenceForm,
    type CreateConnectorType,
    type GitForm,
    type JiraForm,
    type LlmProfileDoc,
    type LlmProviderOption,
    type LocalConnectorForm,
    type ProjectForm,
    type RepoSourceMode,
} from "@/features/admin/projects/form-model"

type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

type NewProjectWizardCardProps = {
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

export default function NewProjectWizardCard(props: NewProjectWizardCardProps) {
    const {
        compactWizard,
        wizardStep,
        stepStatus,
        canOpenStep,
        setWizardStep,
        createRepoMode,
        setCreateRepoMode,
        setPathPickerTarget,
        createForm,
        setCreateForm,
        createGitForm,
        setCreateGitForm,
        createBitbucketForm,
        setCreateBitbucketForm,
        createAzureDevOpsForm,
        setCreateAzureDevOpsForm,
        createLocalConnectorForm,
        setCreateLocalConnectorForm,
        createConfluenceForm,
        setCreateConfluenceForm,
        createJiraForm,
        setCreateJiraForm,
        createOptionalConnectors,
        createConnectorChoices,
        toggleCreateOptionalConnector,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        loadLlmOptions,
        loadingLlmOptions,
        llmOptionsError,
        defaultBaseUrlForProvider,
        createModelOptions,
        primaryRepoConnector,
        createRepoBranch,
        selectedCreateConnectorTypes,
        ingestOnCreate,
        setIngestOnCreate,
        busy,
        repoValid,
        projectValid,
        llmValid,
        createProjectFromWizard,
        resetCreateWorkflow,
        setError,
    } = props

    return (
                        <Card variant="outlined">
                            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                <Stack spacing={{ xs: 2, md: 2.5 }}>
                                    <Box>
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                            New Project Wizard
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                            Start with repository setup, then project info, optional connectors, and finally LLM configuration.
                                        </Typography>
                                    </Box>

                                    <Stepper
                                        nonLinear
                                        activeStep={wizardStep}
                                        alternativeLabel={!compactWizard}
                                        orientation={compactWizard ? "vertical" : "horizontal"}
                                        sx={{
                                            "& .MuiStepLabel-label": {
                                                fontSize: { xs: "0.8rem", sm: "0.9rem" },
                                            },
                                        }}
                                    >
                                        {CREATE_STEPS.map((label, index) => (
                                            <Step key={label} completed={index < wizardStep && stepStatus[index]}>
                                                <StepButton
                                                    color="inherit"
                                                    onClick={() => {
                                                        if (canOpenStep(index)) {
                                                            setWizardStep(index)
                                                        }
                                                    }}
                                                    disabled={!canOpenStep(index)}
                                                >
                                                    {label}
                                                </StepButton>
                                            </Step>
                                        ))}
                                    </Stepper>

                                    {wizardStep === 0 && (
                                        <Stack spacing={1.5}>
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-repo-source-label">Repository Source</InputLabel>
                                                <Select
                                                    labelId="create-repo-source-label"
                                                    label="Repository Source"
                                                    value={createRepoMode}
                                                    onChange={(e) => setCreateRepoMode(e.target.value as RepoSourceMode)}
                                                >
                                                    <MenuItem value="local">Local repository path</MenuItem>
                                                    <MenuItem value="github">GitHub connector</MenuItem>
                                                    <MenuItem value="bitbucket">Bitbucket connector</MenuItem>
                                                    <MenuItem value="azure_devops">Azure DevOps connector</MenuItem>
                                                </Select>
                                            </FormControl>

                                            <Alert severity="info">
                                                Repository comes first. You can add additional connectors in the next step.
                                            </Alert>

                                            {createRepoMode === "local" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Local Repo Path"
                                                        value={createForm.repo_path}
                                                        onChange={(e) =>
                                                            setCreateForm((f) => ({ ...f, repo_path: e.target.value }))
                                                        }
                                                        placeholder="/workspace/repo or browser-local://<project>"
                                                        fullWidth
                                                        size="small"
                                                        InputProps={{
                                                            endAdornment: (
                                                                <InputAdornment position="end">
                                                                    <IconButton
                                                                        edge="end"
                                                                        size="small"
                                                                        onClick={() => setPathPickerTarget("createRepoPath")}
                                                                    >
                                                                        <FolderOpenRounded fontSize="small" />
                                                                    </IconButton>
                                                                </InputAdornment>
                                                            ),
                                                        }}
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createForm.default_branch}
                                                        onChange={(e) =>
                                                            setCreateForm((f) => ({ ...f, default_branch: e.target.value }))
                                                        }
                                                        placeholder="main"
                                                        fullWidth
                                                        size="small"
                                                    />
                                                </Stack>
                                            )}

                                            {createRepoMode === "github" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Owner"
                                                        value={createGitForm.owner}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, owner: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Repository"
                                                        value={createGitForm.repo}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, repo: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createGitForm.branch}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, branch: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Token"
                                                        value={createGitForm.token}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, token: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={createGitForm.paths}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        size="small"
                                                    />
                                                </Stack>
                                            )}

                                            {createRepoMode === "bitbucket" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Workspace"
                                                        value={createBitbucketForm.workspace}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Repository Slug"
                                                        value={createBitbucketForm.repo}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createBitbucketForm.branch}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Username"
                                                        value={createBitbucketForm.username}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, username: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="App Password"
                                                        value={createBitbucketForm.app_password}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="API Base URL"
                                                        value={createBitbucketForm.base_url}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                                                        }
                                                        placeholder="https://api.bitbucket.org/2.0"
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={createBitbucketForm.paths}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        size="small"
                                                    />
                                                </Stack>
                                            )}

                                            {createRepoMode === "azure_devops" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Organization"
                                                        value={createAzureDevOpsForm.organization}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({
                                                                ...f,
                                                                organization: e.target.value,
                                                            }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Project"
                                                        value={createAzureDevOpsForm.project}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Repository"
                                                        value={createAzureDevOpsForm.repository}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({
                                                                ...f,
                                                                repository: e.target.value,
                                                            }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createAzureDevOpsForm.branch}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="PAT"
                                                        value={createAzureDevOpsForm.pat}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="API Base URL"
                                                        value={createAzureDevOpsForm.base_url}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                        }
                                                        placeholder="https://dev.azure.com"
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={createAzureDevOpsForm.paths}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        size="small"
                                                    />
                                                </Stack>
                                            )}
                                        </Stack>
                                    )}

                                    {wizardStep === 1 && (
                                        <Stack spacing={1.5}>
                                            <TextField
                                                label="Project Key"
                                                value={createForm.key}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value }))}
                                                placeholder="qa-assist"
                                                required
                                                fullWidth
                                                size="small"
                                            />
                                            <TextField
                                                label="Project Name"
                                                value={createForm.name}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                                                placeholder="QA Assistant"
                                                required
                                                fullWidth
                                                size="small"
                                            />
                                            <TextField
                                                label="Description"
                                                value={createForm.description}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, description: e.target.value }))
                                                }
                                                multiline
                                                minRows={3}
                                                fullWidth
                                                size="small"
                                            />
                                        </Stack>
                                    )}

                                    {wizardStep === 2 && (
                                        <Stack spacing={1.5}>
                                            <Typography variant="body2" color="text.secondary">
                                                Select additional connectors you want to attach to this project. Only selected connectors show configuration fields.
                                            </Typography>
                                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                                {createConnectorChoices.map((type) => {
                                                    const selected = createOptionalConnectors.includes(type)
                                                    return (
                                                        <Chip
                                                            key={type}
                                                            label={CONNECTOR_LABELS[type]}
                                                            clickable
                                                            color={selected ? "primary" : "default"}
                                                            variant={selected ? "filled" : "outlined"}
                                                            onClick={() => toggleCreateOptionalConnector(type)}
                                                        />
                                                    )
                                                })}
                                            </Stack>

                                            {!createOptionalConnectors.length && (
                                                <Alert severity="info">No additional connectors selected.</Alert>
                                            )}

                                            {createOptionalConnectors.includes("github") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">GitHub Connector</Typography>
                                                        <TextField
                                                            label="Owner"
                                                            value={createGitForm.owner}
                                                            onChange={(e) =>
                                                                setCreateGitForm((f) => ({ ...f, owner: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository"
                                                            value={createGitForm.repo}
                                                            onChange={(e) =>
                                                                setCreateGitForm((f) => ({ ...f, repo: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={createGitForm.branch}
                                                            onChange={(e) =>
                                                                setCreateGitForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Token"
                                                            value={createGitForm.token}
                                                            onChange={(e) =>
                                                                setCreateGitForm((f) => ({ ...f, token: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createGitForm.paths}
                                                            onChange={(e) =>
                                                                setCreateGitForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("bitbucket") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Bitbucket Connector</Typography>
                                                        <TextField
                                                            label="Workspace"
                                                            value={createBitbucketForm.workspace}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository Slug"
                                                            value={createBitbucketForm.repo}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={createBitbucketForm.branch}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Username"
                                                            value={createBitbucketForm.username}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, username: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="App Password"
                                                            value={createBitbucketForm.app_password}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={createBitbucketForm.base_url}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://api.bitbucket.org/2.0"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createBitbucketForm.paths}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("azure_devops") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Azure DevOps Connector</Typography>
                                                        <TextField
                                                            label="Organization"
                                                            value={createAzureDevOpsForm.organization}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({
                                                                    ...f,
                                                                    organization: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Project"
                                                            value={createAzureDevOpsForm.project}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository"
                                                            value={createAzureDevOpsForm.repository}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({
                                                                    ...f,
                                                                    repository: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={createAzureDevOpsForm.branch}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="PAT"
                                                            value={createAzureDevOpsForm.pat}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={createAzureDevOpsForm.base_url}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://dev.azure.com"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createAzureDevOpsForm.paths}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("local") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Local Repository Connector</Typography>
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createLocalConnectorForm.paths}
                                                            onChange={(e) =>
                                                                setCreateLocalConnectorForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                            helperText="Reads from project local repo_path on backend host."
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("confluence") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Confluence Connector</Typography>
                                                        <TextField
                                                            label="Base URL"
                                                            value={createConfluenceForm.baseUrl}
                                                            onChange={(e) =>
                                                                setCreateConfluenceForm((f) => ({
                                                                    ...f,
                                                                    baseUrl: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="https://your-domain.atlassian.net/wiki"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Space Key"
                                                            value={createConfluenceForm.spaceKey}
                                                            onChange={(e) =>
                                                                setCreateConfluenceForm((f) => ({
                                                                    ...f,
                                                                    spaceKey: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Email"
                                                            value={createConfluenceForm.email}
                                                            onChange={(e) =>
                                                                setCreateConfluenceForm((f) => ({ ...f, email: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Token"
                                                            value={createConfluenceForm.apiToken}
                                                            onChange={(e) =>
                                                                setCreateConfluenceForm((f) => ({
                                                                    ...f,
                                                                    apiToken: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("jira") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Jira Connector</Typography>
                                                        <TextField
                                                            label="Base URL"
                                                            value={createJiraForm.baseUrl}
                                                            onChange={(e) =>
                                                                setCreateJiraForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                            }
                                                            placeholder="https://your-domain.atlassian.net"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Email"
                                                            value={createJiraForm.email}
                                                            onChange={(e) =>
                                                                setCreateJiraForm((f) => ({ ...f, email: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Token"
                                                            value={createJiraForm.apiToken}
                                                            onChange={(e) =>
                                                                setCreateJiraForm((f) => ({ ...f, apiToken: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="JQL"
                                                            value={createJiraForm.jql}
                                                            onChange={(e) =>
                                                                setCreateJiraForm((f) => ({ ...f, jql: e.target.value }))
                                                            }
                                                            placeholder="project = CORE ORDER BY updated DESC"
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}
                                        </Stack>
                                    )}

                                    {wizardStep === 3 && (
                                        <Stack spacing={1.5}>
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-profile-label">LLM Profile</InputLabel>
                                                <Select
                                                    labelId="create-llm-profile-label"
                                                    value={createForm.llm_profile_id}
                                                    label="LLM Profile"
                                                    onChange={(e) =>
                                                        setCreateForm((f) => ({ ...f, llm_profile_id: e.target.value }))
                                                    }
                                                >
                                                    <MenuItem value="">No profile (custom settings below)</MenuItem>
                                                    {llmProfiles.filter((profile) => profile.isEnabled !== false).map((profile) => (
                                                        <MenuItem key={profile.id} value={profile.id}>
                                                            {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-provider-label">Provider</InputLabel>
                                                <Select
                                                    labelId="create-llm-provider-label"
                                                    value={createForm.llm_provider}
                                                    label="Provider"
                                                    onChange={(e) => applyProviderChange(setCreateForm, e.target.value)}
                                                    disabled={Boolean(createForm.llm_profile_id)}
                                                >
                                                    {providerOptions.map((option) => (
                                                        <MenuItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>

                                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                                <Typography variant="caption" color="text.secondary">
                                                    {createForm.llm_profile_id
                                                        ? "Project uses selected reusable LLM profile."
                                                        : createForm.llm_provider === "ollama"
                                                        ? "Choose from discovered local Ollama models."
                                                        : "Use ChatGPT model IDs through OpenAI-compatible API."}
                                                </Typography>
                                                <Button
                                                    variant="text"
                                                    size="small"
                                                    onClick={() =>
                                                        void loadLlmOptions(
                                                            createForm.llm_provider === "openai"
                                                                ? {
                                                                    openaiApiKey: createForm.llm_api_key,
                                                                    openaiBaseUrl: createForm.llm_base_url,
                                                                }
                                                                : undefined
                                                        )
                                                    }
                                                    disabled={loadingLlmOptions}
                                                >
                                                    {loadingLlmOptions ? "Refreshing..." : "Refresh models"}
                                                </Button>
                                            </Stack>

                                            {llmOptionsError && (
                                                <Alert severity="warning">
                                                    Model discovery warning: {llmOptionsError}
                                                </Alert>
                                            )}

                                            <TextField
                                                label="Base URL"
                                                value={createForm.llm_base_url}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, llm_base_url: e.target.value }))
                                                }
                                                placeholder={defaultBaseUrlForProvider(createForm.llm_provider)}
                                                fullWidth
                                                size="small"
                                                disabled={Boolean(createForm.llm_profile_id)}
                                            />

                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-model-label">Model</InputLabel>
                                                <Select
                                                    labelId="create-llm-model-label"
                                                    label="Model"
                                                    value={createForm.llm_model}
                                                    onChange={(e) =>
                                                        setCreateForm((f) => ({ ...f, llm_model: e.target.value }))
                                                    }
                                                    disabled={Boolean(createForm.llm_profile_id)}
                                                >
                                                    {createModelOptions.map((model) => (
                                                        <MenuItem key={model} value={model}>
                                                            {model}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>

                                            <TextField
                                                label="Custom Model ID (optional)"
                                                value={createForm.llm_model}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, llm_model: e.target.value }))
                                                }
                                                placeholder="e.g. llama3.2:3b or gpt-4o-mini"
                                                fullWidth
                                                size="small"
                                                helperText="You can type any OpenAI-compatible model ID."
                                                disabled={Boolean(createForm.llm_profile_id)}
                                            />

                                            <TextField
                                                label="API Key"
                                                value={createForm.llm_api_key}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, llm_api_key: e.target.value }))
                                                }
                                                placeholder={createForm.llm_provider === "openai" ? "sk-..." : "ollama"}
                                                fullWidth
                                                size="small"
                                                helperText={
                                                    createForm.llm_provider === "openai"
                                                        ? "Required for ChatGPT API."
                                                        : "For local Ollama this can stay as 'ollama'."
                                                }
                                                disabled={Boolean(createForm.llm_profile_id)}
                                            />
                                        </Stack>
                                    )}

                                    {wizardStep === 4 && (
                                        <Stack spacing={1.5}>
                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">Repository</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Source: {CONNECTOR_LABELS[primaryRepoConnector]}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Branch: {createRepoBranch || "main"}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createRepoMode === "local"
                                                            ? `Repo path: ${createForm.repo_path || "not set"}`
                                                            : createRepoMode === "github"
                                                            ? `Repository: ${createGitForm.owner || "?"}/${createGitForm.repo || "?"}`
                                                            : createRepoMode === "bitbucket"
                                                            ? `Repository: ${createBitbucketForm.workspace || "?"}/${createBitbucketForm.repo || "?"}`
                                                            : `Repository: ${createAzureDevOpsForm.organization || "?"}/${createAzureDevOpsForm.project || "?"}/${createAzureDevOpsForm.repository || "?"}`}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">Project</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createForm.name || "(no name)"} · {createForm.key || "(no key)"}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">LLM</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createForm.llm_profile_id
                                                            ? `Profile: ${
                                                                llmProfiles.find((p) => p.id === createForm.llm_profile_id)?.name || createForm.llm_profile_id
                                                            }`
                                                            : `${createForm.llm_provider.toUpperCase()} · ${createForm.llm_model || "n/a"}`}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                                                        {createForm.llm_base_url || "backend default"}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                                {selectedCreateConnectorTypes.map((type) => (
                                                    <Chip key={type} label={CONNECTOR_LABELS[type]} color="primary" variant="filled" />
                                                ))}
                                            </Stack>

                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={ingestOnCreate}
                                                        onChange={(e) => setIngestOnCreate(e.target.checked)}
                                                    />
                                                }
                                                label="Run ingestion immediately after create"
                                            />
                                        </Stack>
                                    )}

                                    <Divider />

                                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                                        <Button
                                            variant="text"
                                            disabled={wizardStep === 0 || busy}
                                            onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
                                            sx={{ width: { xs: "100%", sm: "auto" } }}
                                        >
                                            Back
                                        </Button>

                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                                            {wizardStep < CREATE_STEPS.length - 1 ? (
                                                <Button
                                                    variant="contained"
                                                    onClick={() => {
                                                        if (!canOpenStep(wizardStep + 1)) {
                                                            if (wizardStep === 0) {
                                                                setError("Please complete repository setup before continuing.")
                                                            } else if (wizardStep === 1) {
                                                                setError("Please enter project key and name before continuing.")
                                                            } else if (wizardStep === 3) {
                                                                setError("Please choose an LLM profile or set provider and model before continuing.")
                                                            }
                                                            return
                                                        }
                                                        setError(null)
                                                        setWizardStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1))
                                                    }}
                                                    disabled={busy}
                                                    sx={{ width: { xs: "100%", sm: "auto" } }}
                                                >
                                                    Next
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="contained"
                                                    startIcon={<AddRounded />}
                                                    onClick={() => void createProjectFromWizard()}
                                                    disabled={busy || !repoValid || !projectValid || !llmValid}
                                                    sx={{ width: { xs: "100%", sm: "auto" } }}
                                                >
                                                    Create Project
                                                </Button>
                                            )}

                                            <Button
                                                variant="outlined"
                                                onClick={resetCreateWorkflow}
                                                disabled={busy}
                                                sx={{ width: { xs: "100%", sm: "auto" } }}
                                            >
                                                Reset
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </Stack>
                            </CardContent>
                        </Card>
    )
}
