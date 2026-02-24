"use client"

import { useState } from "react"
import { Alert, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import type { PendingUserQuestion } from "@/features/chat/types"
import { CodeComposerEditor } from "@/features/chat/CodeComposerEditor"

type ChatComposerProps = {
    pendingUserQuestion: PendingUserQuestion | null
    pendingAnswerInput: string
    input: string
    sending: boolean
    hasSelectedChat: boolean
    onInputChange: (next: string) => void
    onPendingAnswerInputChange: (next: string) => void
    onSend: (overrideQuestion?: string) => void
    onClear: () => void
    onSubmitPendingAnswer: (answer: string, pendingQuestionId: string) => void
}

const CODE_LANGUAGE_OPTIONS = [
    "typescript",
    "javascript",
    "python",
    "json",
    "bash",
    "sql",
    "yaml",
    "java",
    "go",
    "csharp",
    "rust",
]

export function ChatComposer({
    pendingUserQuestion,
    pendingAnswerInput,
    input,
    sending,
    hasSelectedChat,
    onInputChange,
    onPendingAnswerInputChange,
    onSend,
    onClear,
    onSubmitPendingAnswer,
}: ChatComposerProps) {
    const [composeMode, setComposeMode] = useState<"text" | "code">("text")
    const [codeLanguage, setCodeLanguage] = useState("typescript")
    const [codeDraft, setCodeDraft] = useState("")
    const [formatError, setFormatError] = useState<string | null>(null)

    const canSend = composeMode === "code" ? Boolean(codeDraft.trim()) : Boolean(input.trim())

    function formatCode() {
        setFormatError(null)
        const normalized = codeDraft
            .split("\n")
            .map((line) => line.replace(/\t/g, "  ").replace(/[ \t]+$/g, ""))
            .join("\n")

        if (codeLanguage === "json") {
            try {
                const parsed = JSON.parse(normalized || "{}")
                setCodeDraft(JSON.stringify(parsed, null, 2))
                return
            } catch {
                setFormatError("JSON formatting failed. Check JSON syntax.")
                return
            }
        }
        setCodeDraft(normalized)
    }

    function sendFromComposer() {
        if (composeMode === "code") {
            const payload = codeDraft.trimEnd()
            if (!payload) return
            onSend(`\`\`\`${codeLanguage}\n${payload}\n\`\`\``)
            setCodeDraft("")
            setFormatError(null)
            return
        }
        onSend()
    }

    return (
        <Paper
            square
            elevation={0}
            sx={{
                borderTop: "1px solid",
                borderColor: "divider",
                backgroundColor: "rgba(7, 12, 24, 0.72)",
                backdropFilter: "blur(12px)",
                px: { xs: 0.9, md: 2 },
                pt: { xs: 0.65, md: 0.8 },
                pb: "calc(8px + env(safe-area-inset-bottom, 0px))",
            }}
        >
            <Stack sx={{ maxWidth: 1060, mx: "auto" }} spacing={0.7}>
                {pendingUserQuestion && (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 0.9,
                            borderRadius: 1.6,
                            bgcolor: "rgba(15,23,42,0.62)",
                        }}
                    >
                        <Stack spacing={0.75}>
                            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.06em", fontSize: 10.5 }}>
                                ASSISTANT NEEDS INPUT
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13.5 }}>
                                {pendingUserQuestion.question}
                            </Typography>
                            {pendingUserQuestion.answer_mode === "single_choice" ? (
                                <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                                    {(pendingUserQuestion.options || []).map((option, idx) => (
                                        <Button
                                            key={`${option}-${idx}`}
                                            size="small"
                                            variant="outlined"
                                            onClick={() => onSubmitPendingAnswer(option, pendingUserQuestion.id)}
                                            disabled={sending || !hasSelectedChat}
                                        >
                                            {option}
                                        </Button>
                                    ))}
                                </Stack>
                            ) : (
                                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                    <TextField
                                        size="small"
                                        value={pendingAnswerInput}
                                        onChange={(e) => onPendingAnswerInputChange(e.target.value)}
                                        placeholder="Type your answer for the assistant"
                                        fullWidth
                                        disabled={sending || !hasSelectedChat}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault()
                                                onSubmitPendingAnswer(pendingAnswerInput, pendingUserQuestion.id)
                                            }
                                        }}
                                    />
                                    <Button
                                        variant="contained"
                                        onClick={() => onSubmitPendingAnswer(pendingAnswerInput, pendingUserQuestion.id)}
                                        disabled={sending || !pendingAnswerInput.trim() || !hasSelectedChat}
                                    >
                                        Submit Answer
                                    </Button>
                                </Stack>
                            )}
                        </Stack>
                    </Paper>
                )}

                <Paper
                    variant="outlined"
                    sx={{
                        p: 0.8,
                        borderRadius: 1.6,
                        background: "linear-gradient(155deg, rgba(15,23,42,0.74), rgba(15,23,42,0.48))",
                    }}
                >
                    <Stack spacing={0.7}>
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={0.7} alignItems={{ sm: "center" }}>
                            <Stack direction="row" spacing={0.6}>
                                <Button
                                    size="small"
                                    variant={composeMode === "text" ? "contained" : "outlined"}
                                    onClick={() => setComposeMode("text")}
                                    disabled={!hasSelectedChat || sending}
                                >
                                    Text
                                </Button>
                                <Button
                                    size="small"
                                    variant={composeMode === "code" ? "contained" : "outlined"}
                                    onClick={() => setComposeMode("code")}
                                    disabled={!hasSelectedChat || sending}
                                >
                                    Code
                                </Button>
                            </Stack>

                            {composeMode === "code" && (
                                <Stack direction="row" spacing={0.6} sx={{ ml: { sm: "auto" } }}>
                                    <FormControl size="small" sx={{ minWidth: 150 }}>
                                        <InputLabel id="chat-code-language-label">Language</InputLabel>
                                        <Select
                                            labelId="chat-code-language-label"
                                            label="Language"
                                            value={codeLanguage}
                                            onChange={(e) => setCodeLanguage(String(e.target.value || "typescript"))}
                                            disabled={!hasSelectedChat || sending}
                                        >
                                            {CODE_LANGUAGE_OPTIONS.map((lang) => (
                                                <MenuItem key={lang} value={lang}>
                                                    {lang}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={formatCode}
                                        disabled={!hasSelectedChat || sending || !codeDraft.trim()}
                                    >
                                        Format
                                    </Button>
                                </Stack>
                            )}
                        </Stack>

                        {composeMode === "code" ? (
                            <Stack spacing={0.6}>
                                {formatError && <Alert severity="warning">{formatError}</Alert>}
                                <CodeComposerEditor
                                    value={codeDraft}
                                    language={codeLanguage}
                                    placeholder="Write code here"
                                    disabled={!hasSelectedChat || sending}
                                    onChange={setCodeDraft}
                                    onSubmit={sendFromComposer}
                                />
                            </Stack>
                        ) : (
                            <TextField
                                value={input}
                                onChange={(e) => onInputChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault()
                                        sendFromComposer()
                                    }
                                }}
                                multiline
                                minRows={1}
                                maxRows={6}
                                fullWidth
                                placeholder={
                                    pendingUserQuestion
                                        ? "Reply to the pending assistant question (Enter to send)"
                                        : "Ask a project question (Enter to send, Shift+Enter for newline)"
                                }
                                disabled={!hasSelectedChat || sending}
                                InputProps={{
                                    sx: {
                                        fontSize: { xs: 13.5, sm: 14 },
                                        borderRadius: 1.2,
                                    },
                                }}
                            />
                        )}

                        <Stack direction="row" spacing={0.75} justifyContent="space-between" alignItems="center">
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                                {composeMode === "code" ? "Ctrl/Cmd+Enter to send code" : "Enter to send"}
                            </Typography>
                            <Stack direction="row" spacing={0.75}>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<ClearAllRounded />}
                                    onClick={onClear}
                                    disabled={!hasSelectedChat || sending}
                                    sx={{ minWidth: 88 }}
                                >
                                    Clear
                                </Button>
                                <Button
                                    size="small"
                                    variant="contained"
                                    endIcon={<SendRounded />}
                                    onClick={sendFromComposer}
                                    disabled={sending || !canSend || !hasSelectedChat}
                                    sx={{ minWidth: 88 }}
                                >
                                    Send
                                </Button>
                            </Stack>
                        </Stack>
                    </Stack>
                </Paper>
            </Stack>
        </Paper>
    )
}
