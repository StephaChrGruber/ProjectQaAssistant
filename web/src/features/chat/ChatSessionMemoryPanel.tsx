"use client"

import { useEffect, useMemo, useState } from "react"
import { Box, Button, Chip, IconButton, Paper, Stack, TextField, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"
import type { ChatMemorySummary, ChatTaskState } from "@/features/chat/types"

type ChatSessionMemoryPanelProps = {
    chatMemory: ChatMemorySummary | null
    chatTaskState?: ChatTaskState | null
    onClose: () => void
    onReset?: () => void
    resetting?: boolean
    onSave?: (next: ChatMemorySummary) => Promise<void> | void
    saving?: boolean
}

type MemoryBucket =
    | "decisions"
    | "open_questions"
    | "next_steps"
    | "goals"
    | "constraints"
    | "blockers"
    | "assumptions"
    | "knowledge"

const MEMORY_SECTIONS: Array<{ key: MemoryBucket; label: string }> = [
    { key: "decisions", label: "Decisions" },
    { key: "open_questions", label: "Open Questions" },
    { key: "next_steps", label: "Next Steps" },
    { key: "goals", label: "Goals" },
    { key: "constraints", label: "Constraints" },
    { key: "blockers", label: "Blockers" },
    { key: "assumptions", label: "Assumptions" },
    { key: "knowledge", label: "Knowledge" },
]

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
    chatTaskState = null,
    onClose,
    onReset,
    resetting = false,
    onSave,
    saving = false,
}: ChatSessionMemoryPanelProps) {
    const [editing, setEditing] = useState(false)
    const [drafts, setDrafts] = useState<Record<MemoryBucket, string>>({
        decisions: "",
        open_questions: "",
        next_steps: "",
        goals: "",
        constraints: "",
        blockers: "",
        assumptions: "",
        knowledge: "",
    })

    const mergedMemory = useMemo(() => {
        const out: Record<MemoryBucket, string[]> = {
            decisions: [],
            open_questions: [],
            next_steps: [],
            goals: [],
            constraints: [],
            blockers: [],
            assumptions: [],
            knowledge: [],
        }
        for (const section of MEMORY_SECTIONS) {
            const seen = new Set<string>()
            const fromSummary = (chatMemory?.[section.key] as string[] | undefined) || []
            const fromTaskState = (chatTaskState?.[section.key] as string[] | undefined) || []
            for (const item of [...fromSummary, ...fromTaskState]) {
                const clean = String(item || "").trim()
                if (!clean) continue
                const k = clean.toLowerCase()
                if (seen.has(k)) continue
                seen.add(k)
                out[section.key].push(clean)
            }
        }
        return out
    }, [chatMemory, chatTaskState])

    const hasChanges = useMemo(() => {
        for (const section of MEMORY_SECTIONS) {
            if (toLines(mergedMemory[section.key]) !== drafts[section.key]) {
                return true
            }
        }
        return false
    }, [drafts, mergedMemory])

    useEffect(() => {
        setDrafts({
            decisions: toLines(mergedMemory.decisions),
            open_questions: toLines(mergedMemory.open_questions),
            next_steps: toLines(mergedMemory.next_steps),
            goals: toLines(mergedMemory.goals),
            constraints: toLines(mergedMemory.constraints),
            blockers: toLines(mergedMemory.blockers),
            assumptions: toLines(mergedMemory.assumptions),
            knowledge: toLines(mergedMemory.knowledge),
        })
    }, [mergedMemory])

    async function saveEdits() {
        if (!onSave) return
        await onSave({
            decisions: parseLines(drafts.decisions),
            open_questions: parseLines(drafts.open_questions),
            next_steps: parseLines(drafts.next_steps),
            goals: parseLines(drafts.goals),
            constraints: parseLines(drafts.constraints),
            blockers: parseLines(drafts.blockers),
            assumptions: parseLines(drafts.assumptions),
            knowledge: parseLines(drafts.knowledge),
        })
        setEditing(false)
    }

    return (
        <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
            <Paper
                variant="outlined"
                sx={{
                    p: { xs: 1.2, md: 1.5 },
                    maxWidth: 1200,
                    maxHeight: { xs: "72vh", md: "64vh" },
                    mx: "auto",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    spacing={1}
                >
                    <Stack spacing={0.3}>
                        <Typography variant="overline" color="primary" sx={{ letterSpacing: "0.12em" }}>
                            Session Memory
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Updated: {chatMemory?.updated_at || chatTaskState?.updated_at || "n/a"}
                        </Typography>
                    </Stack>
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

                <Box sx={{ mt: 1, overflow: "auto", pr: { xs: 0.2, sm: 0.5 } }}>
                    <Box
                        sx={{
                            display: "grid",
                            gap: 1.1,
                            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                        }}
                    >
                        {MEMORY_SECTIONS.map((section) => {
                            const items = mergedMemory[section.key] || []
                            const value = drafts[section.key] || ""
                            return (
                                <Box
                                    key={section.key}
                                    sx={{
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 1.5,
                                        p: 1,
                                        minHeight: 132,
                                        display: "flex",
                                        flexDirection: "column",
                                        overflow: "hidden",
                                    }}
                                >
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                            {section.label}
                                        </Typography>
                                        <Chip size="small" variant="outlined" label={items.length} />
                                    </Stack>
                                    {editing ? (
                                        <TextField
                                            multiline
                                            minRows={4}
                                            maxRows={10}
                                            size="small"
                                            value={value}
                                            onChange={(e) =>
                                                setDrafts((prev) => ({
                                                    ...prev,
                                                    [section.key]: e.target.value,
                                                }))
                                            }
                                            placeholder="One item per line"
                                            fullWidth
                                            sx={{ mt: 0.6 }}
                                        />
                                    ) : (
                                        <Box sx={{ mt: 0.45, overflow: "auto", maxHeight: 220 }}>
                                            {items.length ? (
                                                items.map((item, idx) => (
                                                    <Typography
                                                        key={`${section.key}-${idx}`}
                                                        variant="body2"
                                                        sx={{
                                                            mt: 0.4,
                                                            wordBreak: "break-word",
                                                            overflowWrap: "anywhere",
                                                            whiteSpace: "pre-wrap",
                                                        }}
                                                    >
                                                        - {item}
                                                    </Typography>
                                                ))
                                            ) : (
                                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6, fontStyle: "italic" }}>
                                                    No items yet.
                                                </Typography>
                                            )}
                                        </Box>
                                    )}
                                </Box>
                            )
                        })}
                    </Box>
                </Box>
            </Paper>
        </Box>
    )
}
