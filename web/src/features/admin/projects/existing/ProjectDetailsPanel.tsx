"use client"

import type { Dispatch, FormEvent, SetStateAction } from "react"
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    TextField,
    Typography,
} from "@mui/material"
import type { LlmProfileDoc, LlmProviderOption, ProjectForm } from "@/features/admin/projects/form-model"

type ProjectDetailsPanelProps = {
    onSaveProject: (e: FormEvent<HTMLFormElement>) => void | Promise<void>
    editForm: ProjectForm
    setEditForm: Dispatch<SetStateAction<ProjectForm>>
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (setForm: Dispatch<SetStateAction<ProjectForm>>, nextProvider: string) => void
    editModelOptions: string[]
    setPathPickerTarget: Dispatch<SetStateAction<"createRepoPath" | "editRepoPath" | null>>
    busy: boolean
}

export default function ProjectDetailsPanel(props: ProjectDetailsPanelProps) {
    const {
        onSaveProject,
        editForm,
        setEditForm,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        editModelOptions,
        setPathPickerTarget,
        busy,
    } = props

    return (
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
    )
}
