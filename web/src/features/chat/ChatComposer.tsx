"use client"

import { Button, Paper, Stack, TextField, Typography } from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import type { PendingUserQuestion } from "@/features/chat/types"

type ChatComposerProps = {
    pendingUserQuestion: PendingUserQuestion | null
    pendingAnswerInput: string
    input: string
    sending: boolean
    hasSelectedChat: boolean
    onInputChange: (next: string) => void
    onPendingAnswerInputChange: (next: string) => void
    onSend: () => void
    onClear: () => void
    onSubmitPendingAnswer: (answer: string, pendingQuestionId: string) => void
}

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
                        <TextField
                            value={input}
                            onChange={(e) => onInputChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault()
                                    onSend()
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

                        <Stack direction="row" spacing={0.75} justifyContent="space-between" alignItems="center">
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                                Enter to send
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
                                onClick={onSend}
                                disabled={sending || !input.trim() || !hasSelectedChat}
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
