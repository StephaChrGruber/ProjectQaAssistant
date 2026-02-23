"use client"

import { useEffect, useMemo, useState } from "react"
import { Box, Button, IconButton, Paper, Stack, TextField, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"
import type { ChatMemorySummary } from "@/features/chat/types"

type ChatSessionMemoryPanelProps = {
    chatMemory: ChatMemorySummary | null
    onClose: () => void
    onReset?: () => void
    resetting?: boolean
    onSave?: (next: ChatMemorySummary) => Promise<void> | void
    saving?: boolean
}

function toLines(items: string[] | undefined): string {
    return (items || []).join("\n")
}

function parseLines(text: string): string[] {
    return text
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
}

export function ChatSessionMemoryPanel({
    chatMemory,
    onClose,
    onReset,
    resetting = false,
    onSave,
    saving = false,
}: ChatSessionMemoryPanelProps) {
    const [editing, setEditing] = useState(false)
    const [decisionsText, setDecisionsText] = useState("")
    const [questionsText, setQuestionsText] = useState("")
    const [nextStepsText, setNextStepsText] = useState("")

    const hasChanges = useMemo(() => {
        const a = toLines(chatMemory?.decisions)
        const b = toLines(chatMemory?.open_questions)
        const c = toLines(chatMemory?.next_steps)
        return a !== decisionsText || b !== questionsText || c !== nextStepsText
    }, [chatMemory?.decisions, chatMemory?.next_steps, chatMemory?.open_questions, decisionsText, nextStepsText, questionsText])

    useEffect(() => {
        setDecisionsText(toLines(chatMemory?.decisions))
        setQuestionsText(toLines(chatMemory?.open_questions))
        setNextStepsText(toLines(chatMemory?.next_steps))
    }, [chatMemory?.decisions, chatMemory?.next_steps, chatMemory?.open_questions])

    async function saveEdits() {
        if (!onSave) return
        await onSave({
            decisions: parseLines(decisionsText),
            open_questions: parseLines(questionsText),
            next_steps: parseLines(nextStepsText),
        })
        setEditing(false)
    }

    return (
        <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
            <Paper variant="outlined" sx={{ p: { xs: 1.2, md: 1.5 }, maxWidth: 980, mx: "auto" }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="overline" color="primary" sx={{ letterSpacing: "0.12em" }}>
                        Session Memory
                    </Typography>
                    <Stack direction="row" spacing={0.6} alignItems="center">
                        {onSave ? (
                            <Button size="small" variant={editing ? "contained" : "outlined"} onClick={() => setEditing((v) => !v)}>
                                {editing ? "Editing" : "Edit"}
                            </Button>
                        ) : null}
                        {editing && onSave ? (
                            <Button size="small" variant="contained" onClick={() => void saveEdits()} disabled={saving || !hasChanges}>
                                {saving ? "Saving..." : "Save"}
                            </Button>
                        ) : null}
                        {onReset ? (
                            <Button size="small" variant="outlined" onClick={onReset} disabled={resetting}>
                                {resetting ? "Resetting..." : "Reset"}
                            </Button>
                        ) : null}
                        <IconButton size="small" onClick={onClose}>
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Stack>
                </Stack>
                <Box
                    sx={{
                        mt: 0.8,
                        display: "grid",
                        gap: 1.2,
                        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                    }}
                >
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                            Decisions
                        </Typography>
                        {editing ? (
                            <TextField
                                multiline
                                minRows={4}
                                size="small"
                                value={decisionsText}
                                onChange={(e) => setDecisionsText(e.target.value)}
                                placeholder="One item per line"
                                fullWidth
                                sx={{ mt: 0.5 }}
                            />
                        ) : (
                            (chatMemory?.decisions || []).slice(0, 6).map((item, idx) => (
                                <Typography key={`mem-d-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                    - {item}
                                </Typography>
                            ))
                        )}
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                            Open Questions
                        </Typography>
                        {editing ? (
                            <TextField
                                multiline
                                minRows={4}
                                size="small"
                                value={questionsText}
                                onChange={(e) => setQuestionsText(e.target.value)}
                                placeholder="One item per line"
                                fullWidth
                                sx={{ mt: 0.5 }}
                            />
                        ) : (
                            (chatMemory?.open_questions || []).slice(0, 6).map((item, idx) => (
                                <Typography key={`mem-q-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                    - {item}
                                </Typography>
                            ))
                        )}
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                            Next Steps
                        </Typography>
                        {editing ? (
                            <TextField
                                multiline
                                minRows={4}
                                size="small"
                                value={nextStepsText}
                                onChange={(e) => setNextStepsText(e.target.value)}
                                placeholder="One item per line"
                                fullWidth
                                sx={{ mt: 0.5 }}
                            />
                        ) : (
                            (chatMemory?.next_steps || []).slice(0, 6).map((item, idx) => (
                                <Typography key={`mem-n-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                    - {item}
                                </Typography>
                            ))
                        )}
                    </Box>
                </Box>
            </Paper>
        </Box>
    )
}
