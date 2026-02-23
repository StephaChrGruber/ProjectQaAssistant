"use client"

import { Dispatch, SetStateAction } from "react"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    FormControlLabel,
    TextField,
    Typography,
} from "@mui/material"
import {
    type LlmProfileDoc,
    type LlmProfileForm,
    type LlmProviderOption,
} from "@/features/admin/projects/form-model"

type LoadOptionsArgs = { openaiApiKey?: string; openaiBaseUrl?: string }

type LlmProfilesCardProps = {
    llmProfileForm: LlmProfileForm
    setLlmProfileForm: Dispatch<SetStateAction<LlmProfileForm>>
    providerOptions: LlmProviderOption[]
    applyProviderChangeToLlmProfile: (provider: string) => void
    loadingLlmOptions: boolean
    loadLlmOptions: (opts?: LoadOptionsArgs) => Promise<void>
    llmOptionsError: string | null
    llmProfileModelOptions: string[]
    busy: boolean
    editingLlmProfileId: string | null
    llmProfiles: LlmProfileDoc[]
    saveLlmProfile: () => Promise<void>
    onSelectProfile: (profile: LlmProfileDoc) => void
    deleteLlmProfile: (profileId: string) => Promise<void>
    onResetEditing: () => void
}

export default function LlmProfilesCard(props: LlmProfilesCardProps) {
    const {
        llmProfileForm,
        setLlmProfileForm,
        providerOptions,
        applyProviderChangeToLlmProfile,
        loadingLlmOptions,
        loadLlmOptions,
        llmOptionsError,
        llmProfileModelOptions,
        busy,
        editingLlmProfileId,
        llmProfiles,
        saveLlmProfile,
        onSelectProfile,
        deleteLlmProfile,
        onResetEditing,
    } = props

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Stack spacing={1.5}>
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            Reusable LLM Profiles
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Create once and reuse across projects and chats.
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            display: "grid",
                            gap: 1.2,
                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                        }}
                    >
                        <TextField
                            label="Profile Name"
                            value={llmProfileForm.name}
                            onChange={(e) => setLlmProfileForm((f) => ({ ...f, name: e.target.value }))}
                            size="small"
                            fullWidth
                        />
                        <FormControl size="small" fullWidth>
                            <InputLabel id="llm-profile-provider-label">Provider</InputLabel>
                            <Select
                                labelId="llm-profile-provider-label"
                                label="Provider"
                                value={llmProfileForm.provider}
                                onChange={(e) => applyProviderChangeToLlmProfile(e.target.value)}
                            >
                                {providerOptions.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Description"
                            value={llmProfileForm.description}
                            onChange={(e) => setLlmProfileForm((f) => ({ ...f, description: e.target.value }))}
                            size="small"
                            fullWidth
                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                        />
                        <Stack
                            direction="row"
                            alignItems="center"
                            justifyContent="space-between"
                            spacing={1}
                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                        >
                            <Typography variant="caption" color="text.secondary">
                                {llmProfileForm.provider === "openai"
                                    ? "Use OpenAI-compatible model IDs for this profile."
                                    : "Choose from discovered local Ollama models."}
                            </Typography>
                            <Button
                                variant="text"
                                size="small"
                                onClick={() =>
                                    void loadLlmOptions(
                                        llmProfileForm.provider === "openai"
                                            ? {
                                                  openaiApiKey: llmProfileForm.api_key,
                                                  openaiBaseUrl: llmProfileForm.base_url,
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
                            <Alert severity="warning" sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                Model discovery warning: {llmOptionsError}
                            </Alert>
                        )}
                        <TextField
                            label="Base URL"
                            value={llmProfileForm.base_url}
                            onChange={(e) => setLlmProfileForm((f) => ({ ...f, base_url: e.target.value }))}
                            size="small"
                            fullWidth
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel id="llm-profile-model-label">Model</InputLabel>
                            <Select
                                labelId="llm-profile-model-label"
                                label="Model"
                                value={llmProfileForm.model}
                                onChange={(e) => setLlmProfileForm((f) => ({ ...f, model: e.target.value }))}
                            >
                                {llmProfileModelOptions.map((model) => (
                                    <MenuItem key={model} value={model}>
                                        {model}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Custom Model ID (optional)"
                            value={llmProfileForm.model}
                            onChange={(e) => setLlmProfileForm((f) => ({ ...f, model: e.target.value }))}
                            size="small"
                            fullWidth
                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                        />
                        <TextField
                            label="API Key"
                            value={llmProfileForm.api_key}
                            onChange={(e) => setLlmProfileForm((f) => ({ ...f, api_key: e.target.value }))}
                            size="small"
                            fullWidth
                            sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                        />
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={llmProfileForm.isEnabled}
                                    onChange={(e) =>
                                        setLlmProfileForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                    }
                                />
                            }
                            label="Enabled"
                        />
                    </Box>

                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        <Button variant="contained" onClick={() => void saveLlmProfile()} disabled={busy}>
                            {editingLlmProfileId ? "Update Profile" : "Create Profile"}
                        </Button>
                        <Button variant="outlined" onClick={onResetEditing} disabled={busy}>
                            Reset
                        </Button>
                    </Stack>

                    <Divider />

                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        {llmProfiles.map((profile) => (
                            <Chip
                                key={profile.id}
                                label={`${profile.name} · ${profile.provider.toUpperCase()} · ${profile.model}`}
                                variant={editingLlmProfileId === profile.id ? "filled" : "outlined"}
                                color={editingLlmProfileId === profile.id ? "primary" : "default"}
                                onClick={() => onSelectProfile(profile)}
                                onDelete={() => void deleteLlmProfile(profile.id)}
                                disabled={busy}
                            />
                        ))}
                        {!llmProfiles.length && (
                            <Typography variant="body2" color="text.secondary">
                                No LLM profiles configured yet.
                            </Typography>
                        )}
                    </Stack>
                </Stack>
            </CardContent>
        </Card>
    )
}
