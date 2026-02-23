"use client"

import { ComponentType, Dispatch, SetStateAction } from "react"
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import {
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConfluenceForm,
    type EvalRunResponse,
    type GitForm,
    type JiraForm,
    type LlmProfileDoc,
    type LlmProviderOption,
    type LocalConnectorForm,
    type ProjectEditForm,
    type QaMetricsResponse,
} from "@/features/project-settings/form-model"

type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

type ProjectSettingsAdminPanelProps = {
    editForm: ProjectEditForm
    setEditForm: Dispatch<SetStateAction<ProjectEditForm>>
    isBrowserLocalRepoPath: (path: string) => boolean
    localRepoConfiguredInBrowser: boolean
    setPathPickerOpen: Dispatch<SetStateAction<boolean>>
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (nextProvider: string) => void
    editModelOptions: string[]
    onSaveProjectSettings: () => Promise<void>
    savingProject: boolean
    savingConnector: boolean
    ingesting: boolean
    loadLlmOptions: (opts?: LoadOptionsArgs) => Promise<void>
    loadingLlmOptions: boolean
    llmOptionsError: string | null
    gitForm: GitForm
    setGitForm: Dispatch<SetStateAction<GitForm>>
    bitbucketForm: BitbucketForm
    setBitbucketForm: Dispatch<SetStateAction<BitbucketForm>>
    azureDevOpsForm: AzureDevOpsForm
    setAzureDevOpsForm: Dispatch<SetStateAction<AzureDevOpsForm>>
    localConnectorForm: LocalConnectorForm
    setLocalConnectorForm: Dispatch<SetStateAction<LocalConnectorForm>>
    confluenceForm: ConfluenceForm
    setConfluenceForm: Dispatch<SetStateAction<ConfluenceForm>>
    jiraForm: JiraForm
    setJiraForm: Dispatch<SetStateAction<JiraForm>>
    saveConnector: (type: "git" | "bitbucket" | "azure_devops" | "local" | "confluence" | "jira") => Promise<void>
    runIngest: () => Promise<void>
    runningIncrementalIngest: boolean
    runIncrementalIngest: () => Promise<void>
    loadQaMetrics: () => Promise<void>
    loadingQaMetrics: boolean
    qaMetrics: QaMetricsResponse | null
    evaluationQuestions: string
    setEvaluationQuestions: Dispatch<SetStateAction<string>>
    runEvaluations: () => Promise<void>
    runningEvaluations: boolean
    latestEvalRun: EvalRunResponse | null
    DetailCardComponent: ComponentType<{ title: string; value: string }>
}

export default function ProjectSettingsAdminPanel(props: ProjectSettingsAdminPanelProps) {
    const {
        editForm,
        setEditForm,
        isBrowserLocalRepoPath,
        localRepoConfiguredInBrowser,
        setPathPickerOpen,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        editModelOptions,
        onSaveProjectSettings,
        savingProject,
        savingConnector,
        ingesting,
        loadLlmOptions,
        loadingLlmOptions,
        llmOptionsError,
        gitForm,
        setGitForm,
        bitbucketForm,
        setBitbucketForm,
        azureDevOpsForm,
        setAzureDevOpsForm,
        localConnectorForm,
        setLocalConnectorForm,
        confluenceForm,
        setConfluenceForm,
        jiraForm,
        setJiraForm,
        saveConnector,
        runIngest,
        runningIncrementalIngest,
        runIncrementalIngest,
        loadQaMetrics,
        loadingQaMetrics,
        qaMetrics,
        evaluationQuestions,
        setEvaluationQuestions,
        runEvaluations,
        runningEvaluations,
        latestEvalRun,
        DetailCardComponent,
    } = props

    return (
        <>
                            <Card variant="outlined">
                                <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                        Edit Project Settings
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                                        Includes the same project + LLM configuration fields as admin workflow.
                                    </Typography>

                                    <Box
                                        sx={{
                                            mt: 1.5,
                                            display: "grid",
                                            gap: 1.2,
                                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                                        }}
                                    >
                                        <TextField
                                            label="Project Name"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                            fullWidth
                                        />
                                        <TextField
                                            label="Default Branch"
                                            value={editForm.default_branch}
                                            onChange={(e) => setEditForm((f) => ({ ...f, default_branch: e.target.value }))}
                                            fullWidth
                                        />
                                        <TextField
                                            label="Description"
                                            value={editForm.description}
                                            onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                            multiline
                                            minRows={3}
                                            fullWidth
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                        />
                                        <TextField
                                            label="Local Repo Path"
                                            value={editForm.repo_path}
                                            onChange={(e) => setEditForm((f) => ({ ...f, repo_path: e.target.value }))}
                                            fullWidth
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                            helperText={
                                                isBrowserLocalRepoPath(editForm.repo_path)
                                                    ? localRepoConfiguredInBrowser
                                                        ? "Browser-local repo is indexed in this browser session."
                                                        : "Browser-local repo path set. Pick the folder again to load local repo tools in this browser."
                                                    : undefined
                                            }
                                            InputProps={{
                                                endAdornment: (
                                                    <InputAdornment position="end">
                                                        <IconButton
                                                            edge="end"
                                                            size="small"
                                                            onClick={() => setPathPickerOpen(true)}
                                                        >
                                                            <FolderOpenRounded fontSize="small" />
                                                        </IconButton>
                                                    </InputAdornment>
                                                ),
                                            }}
                                        />

                                        <FormControl fullWidth size="small">
                                            <InputLabel id="project-settings-llm-profile">LLM Profile</InputLabel>
                                            <Select
                                                labelId="project-settings-llm-profile"
                                                label="LLM Profile"
                                                value={editForm.llm_profile_id}
                                                onChange={(e) => setEditForm((f) => ({ ...f, llm_profile_id: e.target.value }))}
                                            >
                                                <MenuItem value="">No profile (custom settings below)</MenuItem>
                                                {llmProfiles.map((profile) => (
                                                    <MenuItem key={profile.id} value={profile.id}>
                                                        {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <FormControl fullWidth size="small">
                                            <InputLabel id="project-settings-llm-provider">LLM Provider</InputLabel>
                                            <Select
                                                labelId="project-settings-llm-provider"
                                                label="LLM Provider"
                                                value={editForm.llm_provider}
                                                onChange={(e) => applyProviderChange(e.target.value)}
                                                disabled={Boolean(editForm.llm_profile_id)}
                                            >
                                                {providerOptions.map((option) => (
                                                    <MenuItem key={option.value} value={option.value}>
                                                        {option.label}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <FormControl fullWidth size="small">
                                            <InputLabel id="project-settings-llm-model">LLM Model</InputLabel>
                                            <Select
                                                labelId="project-settings-llm-model"
                                                label="LLM Model"
                                                value={editForm.llm_model}
                                                onChange={(e) => setEditForm((f) => ({ ...f, llm_model: e.target.value }))}
                                                disabled={Boolean(editForm.llm_profile_id)}
                                            >
                                                {editModelOptions.map((model) => (
                                                    <MenuItem key={model} value={model}>
                                                        {model}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <TextField
                                            label="Custom Model ID (optional)"
                                            value={editForm.llm_model}
                                            onChange={(e) => setEditForm((f) => ({ ...f, llm_model: e.target.value }))}
                                            fullWidth
                                            helperText="Override with any OpenAI-compatible model ID."
                                            disabled={Boolean(editForm.llm_profile_id)}
                                        />

                                        <TextField
                                            label="LLM Base URL"
                                            value={editForm.llm_base_url}
                                            onChange={(e) => setEditForm((f) => ({ ...f, llm_base_url: e.target.value }))}
                                            fullWidth
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                            disabled={Boolean(editForm.llm_profile_id)}
                                        />

                                        <TextField
                                            label="LLM API Key"
                                            value={editForm.llm_api_key}
                                            onChange={(e) => setEditForm((f) => ({ ...f, llm_api_key: e.target.value }))}
                                            fullWidth
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                            helperText={
                                                editForm.llm_provider === "openai"
                                                    ? "Required for ChatGPT API."
                                                    : "Usually 'ollama' for local models."
                                            }
                                            disabled={Boolean(editForm.llm_profile_id)}
                                        />

                                        <Divider sx={{ gridColumn: { xs: "auto", md: "1 / span 2" }, my: 0.5 }} />

                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={editForm.grounding_require_sources}
                                                    onChange={(e) =>
                                                        setEditForm((f) => ({ ...f, grounding_require_sources: e.target.checked }))
                                                    }
                                                />
                                            }
                                            label="Require grounded answers with sources"
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                        />
                                        <TextField
                                            label="Minimum Sources"
                                            type="number"
                                            value={editForm.grounding_min_sources}
                                            onChange={(e) =>
                                                setEditForm((f) => ({
                                                    ...f,
                                                    grounding_min_sources: Math.max(1, Math.min(5, Number(e.target.value || 1))),
                                                }))
                                            }
                                            inputProps={{ min: 1, max: 5 }}
                                        />
                                        <Box />

                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={editForm.routing_enabled}
                                                    onChange={(e) =>
                                                        setEditForm((f) => ({ ...f, routing_enabled: e.target.checked }))
                                                    }
                                                />
                                            }
                                            label="Enable smart model routing"
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                        />
                                        <FormControl fullWidth size="small">
                                            <InputLabel id="settings-fast-profile">Fast Route Profile</InputLabel>
                                            <Select
                                                labelId="settings-fast-profile"
                                                label="Fast Route Profile"
                                                value={editForm.routing_fast_profile_id}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, routing_fast_profile_id: e.target.value }))
                                                }
                                                disabled={!editForm.routing_enabled}
                                            >
                                                <MenuItem value="">None</MenuItem>
                                                {llmProfiles.map((profile) => (
                                                    <MenuItem key={profile.id} value={profile.id}>
                                                        {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <FormControl fullWidth size="small">
                                            <InputLabel id="settings-strong-profile">Strong Route Profile</InputLabel>
                                            <Select
                                                labelId="settings-strong-profile"
                                                label="Strong Route Profile"
                                                value={editForm.routing_strong_profile_id}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, routing_strong_profile_id: e.target.value }))
                                                }
                                                disabled={!editForm.routing_enabled}
                                            >
                                                <MenuItem value="">None</MenuItem>
                                                {llmProfiles.map((profile) => (
                                                    <MenuItem key={profile.id} value={profile.id}>
                                                        {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <FormControl fullWidth size="small" sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                            <InputLabel id="settings-fallback-profile">Fallback Route Profile</InputLabel>
                                            <Select
                                                labelId="settings-fallback-profile"
                                                label="Fallback Route Profile"
                                                value={editForm.routing_fallback_profile_id}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, routing_fallback_profile_id: e.target.value }))
                                                }
                                                disabled={!editForm.routing_enabled}
                                            >
                                                <MenuItem value="">None</MenuItem>
                                                {llmProfiles.map((profile) => (
                                                    <MenuItem key={profile.id} value={profile.id}>
                                                        {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={editForm.security_read_only_non_admin}
                                                    onChange={(e) =>
                                                        setEditForm((f) => ({
                                                            ...f,
                                                            security_read_only_non_admin: e.target.checked,
                                                        }))
                                                    }
                                                />
                                            }
                                            label="Force read-only tools for non-admin users"
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                        />
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={editForm.security_allow_write_members}
                                                    onChange={(e) =>
                                                        setEditForm((f) => ({
                                                            ...f,
                                                            security_allow_write_members: e.target.checked,
                                                        }))
                                                    }
                                                />
                                            }
                                            label="Allow write tools for project members"
                                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                        />
                                    </Box>

                                    <Stack direction="row" spacing={1} sx={{ mt: 1.6 }}>
                                        <Button
                                            variant="contained"
                                            startIcon={<SaveRounded />}
                                            onClick={() => void onSaveProjectSettings()}
                                            disabled={savingProject || savingConnector || ingesting}
                                        >
                                            Save Project
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            startIcon={<RefreshRounded />}
                                            onClick={() =>
                                                void loadLlmOptions(
                                                    editForm.llm_provider === "openai"
                                                        ? {
                                                            openaiApiKey: editForm.llm_api_key,
                                                            openaiBaseUrl: editForm.llm_base_url,
                                                        }
                                                        : undefined
                                                )
                                            }
                                            disabled={loadingLlmOptions || savingProject || savingConnector || ingesting}
                                        >
                                            {loadingLlmOptions ? "Refreshing Models..." : "Refresh Models"}
                                        </Button>
                                    </Stack>

                                    {llmOptionsError && (
                                        <Alert severity="warning" sx={{ mt: 1.3 }}>
                                            Model discovery warning: {llmOptionsError}
                                        </Alert>
                                    )}
                                </CardContent>
                            </Card>

                            <Card variant="outlined">
                                <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                        Source Connectors
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                                        Configure GitHub, Bitbucket, Azure DevOps, Local Repo, Confluence, and Jira connectors directly here.
                                    </Typography>

                                    <Box
                                        sx={{
                                            mt: 1.5,
                                            display: "grid",
                                            gap: 1.2,
                                            gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0,1fr))" },
                                        }}
                                    >
                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Git Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={gitForm.isEnabled}
                                                                onChange={(e) => setGitForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Owner"
                                                        value={gitForm.owner}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, owner: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Repo"
                                                        value={gitForm.repo}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={gitForm.branch}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, branch: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Token"
                                                        value={gitForm.token}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, token: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={gitForm.paths}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, paths: e.target.value }))}
                                                        placeholder="src, docs"
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("git")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Git
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Bitbucket Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={bitbucketForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setBitbucketForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                                                }
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Workspace"
                                                        value={bitbucketForm.workspace}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, workspace: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Repository Slug"
                                                        value={bitbucketForm.repo}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, repo: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={bitbucketForm.branch}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, branch: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Username"
                                                        value={bitbucketForm.username}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, username: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="App Password"
                                                        value={bitbucketForm.app_password}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, app_password: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="API Base URL"
                                                        value={bitbucketForm.base_url}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, base_url: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={bitbucketForm.paths}
                                                        onChange={(e) => setBitbucketForm((f) => ({ ...f, paths: e.target.value }))}
                                                        placeholder="src, docs"
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("bitbucket")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Bitbucket
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Azure DevOps Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={azureDevOpsForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setAzureDevOpsForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                                                }
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Organization"
                                                        value={azureDevOpsForm.organization}
                                                        onChange={(e) =>
                                                            setAzureDevOpsForm((f) => ({ ...f, organization: e.target.value }))
                                                        }
                                                    />
                                                    <TextField
                                                        label="Project"
                                                        value={azureDevOpsForm.project}
                                                        onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Repository"
                                                        value={azureDevOpsForm.repository}
                                                        onChange={(e) =>
                                                            setAzureDevOpsForm((f) => ({ ...f, repository: e.target.value }))
                                                        }
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={azureDevOpsForm.branch}
                                                        onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="PAT"
                                                        value={azureDevOpsForm.pat}
                                                        onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="API Base URL"
                                                        value={azureDevOpsForm.base_url}
                                                        onChange={(e) =>
                                                            setAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                        }
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={azureDevOpsForm.paths}
                                                        onChange={(e) => setAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))}
                                                        placeholder="src, docs"
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("azure_devops")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Azure DevOps
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Local Repository Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={localConnectorForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setLocalConnectorForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                                                }
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={localConnectorForm.paths}
                                                        onChange={(e) =>
                                                            setLocalConnectorForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        helperText="Uses project local repo path on backend."
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("local")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Local Source
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Confluence Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={confluenceForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setConfluenceForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                                                }
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Base URL"
                                                        value={confluenceForm.baseUrl}
                                                        onChange={(e) =>
                                                            setConfluenceForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                        }
                                                        placeholder="https://your-domain.atlassian.net/wiki"
                                                    />
                                                    <TextField
                                                        label="Space Key"
                                                        value={confluenceForm.spaceKey}
                                                        onChange={(e) =>
                                                            setConfluenceForm((f) => ({ ...f, spaceKey: e.target.value }))
                                                        }
                                                    />
                                                    <TextField
                                                        label="Email"
                                                        value={confluenceForm.email}
                                                        onChange={(e) => setConfluenceForm((f) => ({ ...f, email: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="API Token"
                                                        value={confluenceForm.apiToken}
                                                        onChange={(e) =>
                                                            setConfluenceForm((f) => ({ ...f, apiToken: e.target.value }))
                                                        }
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("confluence")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Confluence
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Jira Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={jiraForm.isEnabled}
                                                                onChange={(e) => setJiraForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Base URL"
                                                        value={jiraForm.baseUrl}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))}
                                                        placeholder="https://your-domain.atlassian.net"
                                                    />
                                                    <TextField
                                                        label="Email"
                                                        value={jiraForm.email}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, email: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="API Token"
                                                        value={jiraForm.apiToken}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, apiToken: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="JQL"
                                                        value={jiraForm.jql}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, jql: e.target.value }))}
                                                        placeholder="project = CORE ORDER BY updated DESC"
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("jira")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Jira
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>
                                    </Box>

                                    <Divider sx={{ my: 1.5 }} />

                                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                                        <Typography variant="body2" color="text.secondary">
                                            After changing sources, run ingestion to refresh indexed context.
                                        </Typography>
                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                            <Button
                                                variant="contained"
                                                color="success"
                                                startIcon={<CloudUploadRounded />}
                                                onClick={() => void runIngest()}
                                                disabled={ingesting || savingConnector || savingProject || runningIncrementalIngest}
                                            >
                                                Run Ingestion
                                            </Button>
                                            <Button
                                                variant="outlined"
                                                color="success"
                                                onClick={() => void runIncrementalIngest()}
                                                disabled={runningIncrementalIngest || ingesting || savingConnector || savingProject}
                                            >
                                                {runningIncrementalIngest ? "Running..." : "Run Incremental"}
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>

                            <Card variant="outlined">
                                <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                            Reliability Dashboard
                                        </Typography>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            onClick={() => void loadQaMetrics()}
                                            disabled={loadingQaMetrics}
                                            startIcon={<RefreshRounded />}
                                        >
                                            Refresh
                                        </Button>
                                    </Stack>
                                    {qaMetrics ? (
                                        <Box
                                            sx={{
                                                mt: 1.4,
                                                display: "grid",
                                                gap: 1.2,
                                                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                                            }}
                                        >
                                            <DetailCardComponent title="Source Coverage" value={`${qaMetrics.source_coverage_pct}%`} />
                                            <DetailCardComponent title="Grounded Failures" value={String(qaMetrics.grounded_failures || 0)} />
                                            <DetailCardComponent title="Tool Errors" value={String(qaMetrics.tool_errors || 0)} />
                                            <DetailCardComponent title="Tool Timeouts" value={String(qaMetrics.tool_timeouts || 0)} />
                                            <DetailCardComponent title="Latency Avg / P95" value={`${qaMetrics.tool_latency_avg_ms} / ${qaMetrics.tool_latency_p95_ms} ms`} />
                                            <DetailCardComponent title="Avg Tool Calls/Answer" value={String(qaMetrics.avg_tool_calls_per_answer || 0)} />
                                        </Box>
                                    ) : (
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.2 }}>
                                            {loadingQaMetrics ? "Loading metrics..." : "No reliability metrics yet."}
                                        </Typography>
                                    )}
                                </CardContent>
                            </Card>

                            <Card variant="outlined">
                                <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                        Evaluation Runner
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                                        Run regression questions and track grounded/source coverage trends.
                                    </Typography>
                                    <TextField
                                        label="Questions (one per line)"
                                        multiline
                                        minRows={4}
                                        value={evaluationQuestions}
                                        onChange={(e) => setEvaluationQuestions(e.target.value)}
                                        sx={{ mt: 1.3 }}
                                        fullWidth
                                    />
                                    <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                                        <Button
                                            variant="contained"
                                            onClick={() => void runEvaluations()}
                                            disabled={runningEvaluations}
                                        >
                                            {runningEvaluations ? "Running..." : "Run Evaluations"}
                                        </Button>
                                    </Stack>
                                    {latestEvalRun?.summary && (
                                        <Box
                                            sx={{
                                                mt: 1.3,
                                                display: "grid",
                                                gap: 1.1,
                                                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                                            }}
                                        >
                                            <DetailCardComponent title="Questions" value={String(latestEvalRun.summary.total || 0)} />
                                            <DetailCardComponent title="Source Coverage" value={`${latestEvalRun.summary.source_coverage_pct || 0}%`} />
                                            <DetailCardComponent title="Avg Latency" value={`${latestEvalRun.summary.avg_latency_ms || 0} ms`} />
                                        </Box>
                                    )}
                                </CardContent>
                            </Card>
        </>
    )
}
