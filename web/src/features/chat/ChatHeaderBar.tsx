"use client"

import {
    Button,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Typography,
} from "@mui/material"
import BuildRounded from "@mui/icons-material/BuildRounded"
import DescriptionRounded from "@mui/icons-material/DescriptionRounded"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded"
import VisibilityRounded from "@mui/icons-material/VisibilityRounded"
import AssignmentTurnedInRounded from "@mui/icons-material/AssignmentTurnedInRounded"
import type { LlmProfileDoc } from "@/features/chat/types"

type ChatHeaderBarProps = {
    projectLabel: string
    branch: string
    llmSummary: string
    selectedLlmProfileId: string
    llmProfiles: LlmProfileDoc[]
    savingLlmProfile: boolean
    selectedChatId: string | null
    enabledToolCount: number
    docsGenerating: boolean
    booting: boolean
    memoryHasItems: boolean
    sessionMemoryOpen: boolean
    onChangeLlmProfile: (profileId: string) => void
    onOpenTools: () => void
    onOpenTasks: () => void
    onOpenDocs: () => void
    onGenerateDocs: () => void
    onToggleSessionMemory: () => void
}

export function ChatHeaderBar({
    projectLabel,
    branch,
    llmSummary,
    selectedLlmProfileId,
    llmProfiles,
    savingLlmProfile,
    selectedChatId,
    enabledToolCount,
    docsGenerating,
    booting,
    memoryHasItems,
    sessionMemoryOpen,
    onChangeLlmProfile,
    onOpenTools,
    onOpenTasks,
    onOpenDocs,
    onGenerateDocs,
    onToggleSessionMemory,
}: ChatHeaderBarProps) {
    return (
        <Paper
            square
            elevation={0}
            sx={{
                borderBottom: "1px solid",
                borderColor: "divider",
                px: { xs: 1.5, md: 3 },
                py: { xs: 1.25, md: 1.8 },
            }}
        >
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.15em" }}>
                RAG Conversation
            </Typography>
            <Typography variant="h6" sx={{ mt: 0.2, fontWeight: 700, fontSize: { xs: "1.02rem", sm: "1.2rem" } }}>
                {projectLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                Branch: {branch} · {llmSummary}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
                <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 360 } }}>
                    <InputLabel id="chat-llm-profile-label">Chat LLM Profile</InputLabel>
                    <Select
                        labelId="chat-llm-profile-label"
                        label="Chat LLM Profile"
                        value={selectedLlmProfileId}
                        onChange={(e) => onChangeLlmProfile(e.target.value)}
                        disabled={savingLlmProfile || !selectedChatId}
                    >
                        <MenuItem value="">Project default</MenuItem>
                        {llmProfiles.map((profile) => (
                            <MenuItem key={profile.id} value={profile.id}>
                                {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<BuildRounded />}
                    onClick={onOpenTools}
                    disabled={!selectedChatId}
                >
                    Tools ({enabledToolCount})
                </Button>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AssignmentTurnedInRounded />}
                    onClick={onOpenTasks}
                    disabled={!selectedChatId}
                >
                    Tasks
                </Button>
                <Button size="small" variant="outlined" startIcon={<DescriptionRounded />} onClick={onOpenDocs}>
                    Open Docs
                </Button>
                <Button
                    size="small"
                    variant="contained"
                    startIcon={<AutoFixHighRounded />}
                    onClick={onGenerateDocs}
                    disabled={docsGenerating || booting}
                >
                    {docsGenerating ? "Generating..." : "Generate Docs"}
                </Button>
                {memoryHasItems && (
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={sessionMemoryOpen ? <VisibilityOffRounded /> : <VisibilityRounded />}
                        onClick={onToggleSessionMemory}
                    >
                        {sessionMemoryOpen ? "Hide Memory" : "Show Memory"}
                    </Button>
                )}
            </Stack>
        </Paper>
    )
}
