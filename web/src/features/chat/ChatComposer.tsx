"use client"

import { useMemo, useRef, useState } from "react"
import { Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import CodeRounded from "@mui/icons-material/CodeRounded"
import type { PendingUserQuestion } from "@/features/chat/types"
import { CodeComposerEditor, type CodeComposerEditorHandle, type SlashCommand } from "@/features/chat/CodeComposerEditor"

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
    const [codeLanguage, setCodeLanguage] = useState("typescript")
    const editorRef = useRef<CodeComposerEditorHandle | null>(null)
    const canSend = Boolean(input.trim())
    const codeBlockSnippet = useMemo(() => `\`\`\`${codeLanguage}\n\n\`\`\``, [codeLanguage])
    const slashCommands = useMemo<SlashCommand[]>(
        () => [
            {
                command: "code",
                description: `Insert a ${codeLanguage} code block`,
                template: `\`\`\`${codeLanguage}\n__CURSOR__\n\`\`\``,
            },
            {
                command: "table",
                description: "Insert a markdown table",
                template: "| Column A | Column B |\n| --- | --- |\n| __CURSOR__ |  |",
            },
            {
                command: "chart",
                description: "Insert a chart JSON block",
                template:
                    '```chart\n{\n  "type": "line",\n  "data": {\n    "labels": ["Jan", "Feb"],\n    "datasets": [{ "label": "Series", "data": [1, 2] }]\n  },\n  "note": "__CURSOR__"\n}\n```',
            },
            {
                command: "todo",
                description: "Insert a checklist",
                template: "- [ ] __CURSOR__\n- [ ] ",
            },
            {
                command: "quote",
                description: "Insert a quote block",
                template: "> __CURSOR__",
            },
            {
                command: "open",
                description: "Open a file in workspace (/open <path>)",
                template: "/open __CURSOR__",
            },
            {
                command: "suggest",
                description: "Generate workspace suggestion now",
                template: "/suggest",
            },
            {
                command: "apply-last",
                description: "Apply last workspace suggestion patch",
                template: "/apply-last",
            },
            {
                command: "diff",
                description: "Open workspace for diff target (/diff <path>)",
                template: "/diff __CURSOR__",
            },
        ],
        [codeLanguage]
    )

    function sendFromComposer() {
        const payload = input.trimEnd()
        if (!payload) return
        onSend(payload)
    }

    function insertCodeBlock() {
        editorRef.current?.insertSnippetAtCursor(codeBlockSnippet, codeLanguage.length + 4)
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
                                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={0.6} alignItems={{ sm: "center" }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, letterSpacing: "0.04em" }}>
                                COMPOSER
                            </Typography>
                            <Stack direction="row" spacing={0.6} sx={{ ml: { sm: "auto" } }}>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel id="chat-code-language-label">Code Language</InputLabel>
                                    <Select
                                        labelId="chat-code-language-label"
                                        label="Code Language"
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
                                    startIcon={<CodeRounded />}
                                    onClick={insertCodeBlock}
                                    disabled={!hasSelectedChat || sending}
                                >
                                    Insert Code Block
                                </Button>
                            </Stack>
                        </Stack>

                        <CodeComposerEditor
                            ref={editorRef}
                            value={input}
                            language="markdown"
                            slashCommands={slashCommands}
                            placeholder={
                                pendingUserQuestion
                                    ? "Reply with text and/or fenced code blocks. Try /code, /table, /chart. Ctrl/Cmd+Enter sends."
                                    : "Ask a project question. Use slash commands like /code, /table, /chart."
                            }
                            disabled={!hasSelectedChat || sending}
                            onChange={onInputChange}
                            onSubmit={sendFromComposer}
                        />

                        <Stack direction="row" spacing={0.75} justifyContent="space-between" alignItems="center">
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                                Ctrl/Cmd+Enter to send
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
