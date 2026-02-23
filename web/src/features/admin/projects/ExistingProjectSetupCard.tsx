"use client"

import { Dispatch, FormEvent, SetStateAction } from "react"
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded"
import DeleteForeverRounded from "@mui/icons-material/DeleteForeverRounded"
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import {
    type AdminProject,
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConfluenceForm,
    type GitForm,
    type JiraForm,
    type LlmProfileDoc,
    type LlmProviderOption,
    type LocalConnectorForm,
    type ProjectForm,
} from "@/features/admin/projects/form-model"

type ExistingProjectSetupCardProps = {
    selectedProjectId: string | null
    setSelectedProjectId: Dispatch<SetStateAction<string | null>>
    projects: AdminProject[]
    selectedProject: AdminProject | undefined
    busy: boolean
    setDeleteConfirmKey: Dispatch<SetStateAction<string>>
    setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>
    onSaveProject: (e: FormEvent<HTMLFormElement>) => void | Promise<void>
    editForm: ProjectForm
    setEditForm: Dispatch<SetStateAction<ProjectForm>>
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (setForm: Dispatch<SetStateAction<ProjectForm>>, nextProvider: string) => void
    editModelOptions: string[]
    setPathPickerTarget: Dispatch<SetStateAction<"createRepoPath" | "editRepoPath" | null>>
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
    refreshProjects: (preferredProjectId?: string) => Promise<void>
    runIngest: (projectId: string) => Promise<void>
}

export default function ExistingProjectSetupCard(props: ExistingProjectSetupCardProps) {
    const {
        selectedProjectId,
        setSelectedProjectId,
        projects,
        selectedProject,
        busy,
        setDeleteConfirmKey,
        setDeleteDialogOpen,
        onSaveProject,
        editForm,
        setEditForm,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        editModelOptions,
        setPathPickerTarget,
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
        refreshProjects,
        runIngest,
    } = props

    return (
                        <Card variant="outlined">
                            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                <Stack spacing={2}>
                                    <Stack
                                        direction={{ xs: "column", sm: "row" }}
                                        spacing={1.5}
                                        alignItems={{ xs: "stretch", sm: "center" }}
                                    >
                                        <Box>
                                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                                Existing Project Setup
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Update project metadata, connectors, and run ingestion.
                                            </Typography>
                                        </Box>

                                        <FormControl size="small" sx={{ ml: { sm: "auto" }, minWidth: { xs: "100%", sm: 280 } }}>
                                            <InputLabel id="selected-project-label">Project</InputLabel>
                                            <Select
                                                labelId="selected-project-label"
                                                label="Project"
                                                value={selectedProjectId || ""}
                                                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                                            >
                                                {projects.map((p) => (
                                                    <MenuItem key={p.id} value={p.id}>
                                                        {p.name} ({p.key})
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <Button
                                            variant="outlined"
                                            color="error"
                                            startIcon={<DeleteForeverRounded />}
                                            disabled={!selectedProject || busy}
                                            onClick={() => {
                                                setDeleteConfirmKey("")
                                                setDeleteDialogOpen(true)
                                            }}
                                            sx={{ width: { xs: "100%", sm: "auto" } }}
                                        >
                                            Delete Project
                                        </Button>
                                    </Stack>

                                    {!selectedProject && <Alert severity="info">No project selected.</Alert>}

                                    {selectedProject && (
                                        <Stack spacing={2}>
                                            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                                                    Project Settings
                                                </Typography>

                                                <Box
                                                    component="form"
                                                    onSubmit={onSaveProject}
                                                    sx={{
                                                        display: "grid",
                                                        gap: 1.5,
                                                        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                                                    }}
                                                >
                                                    <TextField label="Key" value={editForm.key} disabled size="small" fullWidth />
                                                    <TextField
                                                        label="Name"
                                                        value={editForm.name}
                                                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                                        size="small"
                                                        fullWidth
                                                    />
                                                    <TextField
                                                        label="Description"
                                                        value={editForm.description}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, description: e.target.value }))
                                                        }
                                                        size="small"
                                                        multiline
                                                        minRows={3}
                                                        fullWidth
                                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                                    />
                                                    <TextField
                                                        label="Local Repo Path"
                                                        value={editForm.repo_path}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, repo_path: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                                        InputProps={{
                                                            endAdornment: (
                                                                <InputAdornment position="end">
                                                                    <IconButton
                                                                        edge="end"
                                                                        size="small"
                                                                        onClick={() => setPathPickerTarget("editRepoPath")}
                                                                    >
                                                                        <FolderOpenRounded fontSize="small" />
                                                                    </IconButton>
                                                                </InputAdornment>
                                                            ),
                                                        }}
                                                    />
                                                    <TextField
                                                        label="Default Branch"
                                                        value={editForm.default_branch}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, default_branch: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                    />
                                                    <FormControl size="small" fullWidth sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                                        <InputLabel id="edit-llm-profile-label">LLM Profile</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-profile-label"
                                                            label="LLM Profile"
                                                            value={editForm.llm_profile_id}
                                                            onChange={(e) =>
                                                                setEditForm((f) => ({ ...f, llm_profile_id: e.target.value }))
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
                                                    <FormControl size="small" fullWidth>
                                                        <InputLabel id="edit-llm-provider-label">LLM Provider</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-provider-label"
                                                            label="LLM Provider"
                                                            value={editForm.llm_provider}
                                                            onChange={(e) => applyProviderChange(setEditForm, e.target.value)}
                                                            disabled={Boolean(editForm.llm_profile_id)}
                                                        >
                                                            {providerOptions.map((option) => (
                                                                <MenuItem key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                    <TextField
                                                        label="LLM Base URL"
                                                        value={editForm.llm_base_url}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, llm_base_url: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                                        disabled={Boolean(editForm.llm_profile_id)}
                                                    />
                                                    <FormControl size="small" fullWidth>
                                                        <InputLabel id="edit-llm-model-label">LLM Model</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-model-label"
                                                            label="LLM Model"
                                                            value={editForm.llm_model}
                                                            onChange={(e) =>
                                                                setEditForm((f) => ({ ...f, llm_model: e.target.value }))
                                                            }
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
                                                        size="small"
                                                        fullWidth
                                                        helperText="Override with any compatible model ID."
                                                        disabled={Boolean(editForm.llm_profile_id)}
                                                    />
                                                    <TextField
                                                        label="LLM API Key"
                                                        value={editForm.llm_api_key}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, llm_api_key: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                        helperText={
                                                            editForm.llm_provider === "openai"
                                                                ? "Required for ChatGPT API."
                                                                : "Usually 'ollama' for local models."
                                                        }
                                                        disabled={Boolean(editForm.llm_profile_id)}
                                                    />

                                                    <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                                        <Button
                                                            type="submit"
                                                            variant="contained"
                                                            startIcon={<SaveRounded />}
                                                            disabled={busy}
                                                        >
                                                            Save Project Settings
                                                        </Button>
                                                    </Box>
                                                </Box>
                                            </Paper>

                                            <Box
                                                sx={{
                                                    display: "grid",
                                                    gap: 1.5,
                                                    gridTemplateColumns: {
                                                        xs: "1fr",
                                                        lg: "repeat(3, minmax(0, 1fr))",
                                                    },
                                                }}
                                            >
                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Git Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={gitForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setGitForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Owner"
                                                            value={gitForm.owner}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, owner: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repo"
                                                            value={gitForm.repo}
                                                            onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={gitForm.branch}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Token"
                                                            value={gitForm.token}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, token: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={gitForm.paths}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("git")}
                                                            disabled={busy}
                                                        >
                                                            Save Git
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Bitbucket Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={bitbucketForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setBitbucketForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Workspace"
                                                            value={bitbucketForm.workspace}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository Slug"
                                                            value={bitbucketForm.repo}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={bitbucketForm.branch}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Username"
                                                            value={bitbucketForm.username}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, username: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="App Password"
                                                            value={bitbucketForm.app_password}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={bitbucketForm.base_url}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://api.bitbucket.org/2.0"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={bitbucketForm.paths}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("bitbucket")}
                                                            disabled={busy}
                                                        >
                                                            Save Bitbucket
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Azure DevOps Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={azureDevOpsForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setAzureDevOpsForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
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
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Project"
                                                            value={azureDevOpsForm.project}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository"
                                                            value={azureDevOpsForm.repository}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, repository: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={azureDevOpsForm.branch}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="PAT"
                                                            value={azureDevOpsForm.pat}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={azureDevOpsForm.base_url}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://dev.azure.com"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={azureDevOpsForm.paths}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("azure_devops")}
                                                            disabled={busy}
                                                        >
                                                            Save Azure DevOps
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Local Repository Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={localConnectorForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setLocalConnectorForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
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
                                                            size="small"
                                                            helperText="Reads from the configured project repo path."
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("local")}
                                                            disabled={busy}
                                                        >
                                                            Save Local Source
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Confluence Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={confluenceForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setConfluenceForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Base URL"
                                                            value={confluenceForm.baseUrl}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({
                                                                    ...f,
                                                                    baseUrl: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="https://your-domain.atlassian.net/wiki"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Space Key"
                                                            value={confluenceForm.spaceKey}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({
                                                                    ...f,
                                                                    spaceKey: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Email"
                                                            value={confluenceForm.email}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({ ...f, email: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Token"
                                                            value={confluenceForm.apiToken}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({
                                                                    ...f,
                                                                    apiToken: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("confluence")}
                                                            disabled={busy}
                                                        >
                                                            Save Confluence
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Jira Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={jiraForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setJiraForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Base URL"
                                                            value={jiraForm.baseUrl}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                            }
                                                            placeholder="https://your-domain.atlassian.net"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Email"
                                                            value={jiraForm.email}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, email: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Token"
                                                            value={jiraForm.apiToken}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, apiToken: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="JQL"
                                                            value={jiraForm.jql}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, jql: e.target.value }))
                                                            }
                                                            placeholder="project = CORE ORDER BY updated DESC"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("jira")}
                                                            disabled={busy}
                                                        >
                                                            Save Jira
                                                        </Button>
                                                    </Stack>
                                                </Paper>
                                            </Box>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                <Stack
                                                    direction={{ xs: "column", sm: "row" }}
                                                    spacing={1.5}
                                                    alignItems={{ xs: "flex-start", sm: "center" }}
                                                    justifyContent="space-between"
                                                >
                                                    <Box>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Ingestion
                                                        </Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            Pull configured source data and refresh the retrieval index.
                                                        </Typography>
                                                    </Box>

                                                    <Stack direction="row" spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                                                        <Button
                                                            variant="outlined"
                                                            startIcon={<RefreshRounded />}
                                                            onClick={() => void refreshProjects(selectedProject.id)}
                                                            disabled={busy}
                                                            sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                                                        >
                                                            Refresh
                                                        </Button>
                                                        <Button
                                                            variant="contained"
                                                            color="success"
                                                            startIcon={<CloudUploadRounded />}
                                                            onClick={() => void runIngest(selectedProject.id)}
                                                            disabled={busy}
                                                            sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                                                        >
                                                            Run Ingestion
                                                        </Button>
                                                    </Stack>
                                                </Stack>
                                            </Paper>
                                        </Stack>
                                    )}
                                </Stack>
                            </CardContent>
                        </Card>
    )
}
