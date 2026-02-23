"use client"

import type { Dispatch, SetStateAction } from "react"
import { Alert, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from "@mui/material"
import type { LlmProfileDoc, LlmProviderOption, ProjectForm } from "@/features/admin/projects/form-model"

type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

type LlmStepProps = {
    createForm: ProjectForm
    setCreateForm: Dispatch<SetStateAction<ProjectForm>>
    llmProfiles: LlmProfileDoc[]
    providerOptions: LlmProviderOption[]
    applyProviderChange: (setForm: Dispatch<SetStateAction<ProjectForm>>, nextProvider: string) => void
    loadLlmOptions: (opts?: LoadOptionsArgs) => Promise<void>
    loadingLlmOptions: boolean
    llmOptionsError: string | null
    defaultBaseUrlForProvider: (provider: string) => string
    createModelOptions: string[]
}

export default function LlmStep(props: LlmStepProps) {
    const {
        createForm,
        setCreateForm,
        llmProfiles,
        providerOptions,
        applyProviderChange,
        loadLlmOptions,
        loadingLlmOptions,
        llmOptionsError,
        defaultBaseUrlForProvider,
        createModelOptions,
    } = props

    return (
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
    )
}
