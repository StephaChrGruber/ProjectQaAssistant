"use client"

import {
    Box,
    Button,
    Chip,
    Divider,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Tooltip,
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
    projectDefaultLlmLabel?: string
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
    projectDefaultLlmLabel,
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
        <Box sx={{ px: { xs: 1, md: 2 }, pt: { xs: 0.6, md: 0.8 } }}>
            <Paper
                variant="outlined"
                sx={{
                    px: { xs: 1, md: 1.4 },
                    py: { xs: 0.7, md: 0.85 },
                    borderRadius: 1.5,
                    background: "linear-gradient(160deg, rgba(15,23,42,0.8), rgba(15,23,42,0.5))",
                }}
            >
                <Stack
                    direction={{ xs: "column", lg: "row" }}
                    spacing={{ xs: 0.8, lg: 1 }}
                    justifyContent="space-between"
                    alignItems={{ xs: "stretch", lg: "center" }}
                >
                    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.6} alignItems="center" useFlexGap flexWrap="wrap">
                            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.12em", fontSize: 10 }}>
                                RAG Conversation
                            </Typography>
                            <Chip
                                size="small"
                                label={branch}
                                sx={{
                                    height: 18,
                                    fontSize: 10,
                                    bgcolor: "rgba(148,163,184,0.14)",
                                    color: "text.secondary",
                                }}
                            />
                        </Stack>
                        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: "0.95rem", sm: "1.06rem" }, lineHeight: 1.2 }}>
                            {projectLabel}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 11.5 }}>
                            {llmSummary}
                        </Typography>
                    </Stack>

                    <Stack spacing={0.7} sx={{ minWidth: { xs: "100%", lg: 360 }, maxWidth: 560 }}>
                        <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 320 } }}>
                            <InputLabel id="chat-llm-profile-label">Chat LLM Profile</InputLabel>
                            <Select
                                labelId="chat-llm-profile-label"
                                label="Chat LLM Profile"
                                value={selectedLlmProfileId}
                                onChange={(e) => onChangeLlmProfile(e.target.value)}
                                disabled={savingLlmProfile || !selectedChatId}
                            >
                                <MenuItem value="">
                                    {projectDefaultLlmLabel ? `Project default · ${projectDefaultLlmLabel}` : "Project default"}
                                </MenuItem>
                                {llmProfiles.map((profile) => (
                                    <MenuItem key={profile.id} value={profile.id}>
                                        {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap" alignItems="center">
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
                                Docs
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
                                <>
                                    <Divider orientation="vertical" flexItem sx={{ mx: 0.2, display: { xs: "none", sm: "block" } }} />
                                    <Tooltip title={sessionMemoryOpen ? "Hide session memory panel" : "Show session memory panel"}>
                                        <IconButton size="small" onClick={onToggleSessionMemory} color="secondary">
                                            {sessionMemoryOpen ? <VisibilityOffRounded fontSize="small" /> : <VisibilityRounded fontSize="small" />}
                                        </IconButton>
                                    </Tooltip>
                                </>
                            )}
                        </Stack>
                    </Stack>
                </Stack>
            </Paper>
        </Box>
    )
}
