"use client"

import type { Dispatch, SetStateAction } from "react"
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
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
import type { LlmProfileDoc, LlmProviderOption, ProjectEditForm } from "@/features/project-settings/form-model"

type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

type ProjectSettingsFormCardProps = {
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
}

export default function ProjectSettingsFormCard(props: ProjectSettingsFormCardProps) {
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
    } = props

    return (
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
                                    <IconButton edge="end" size="small" onClick={() => setPathPickerOpen(true)}>
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
    )
}
