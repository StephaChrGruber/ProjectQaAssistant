"use client"

import { Button, Chip, Paper, Stack, TextField, Typography } from "@mui/material"
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
                px: { xs: 1.1, md: 3 },
                pt: { xs: 1, md: 1.3 },
                pb: "calc(10px + env(safe-area-inset-bottom, 0px))",
            }}
        >
            <Stack sx={{ maxWidth: 1060, mx: "auto" }} spacing={1}>
                {pendingUserQuestion && (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 1.2,
                            borderRadius: 2,
                            bgcolor: "rgba(15,23,42,0.62)",
                        }}
                    >
                        <Stack spacing={1}>
                            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                ASSISTANT NEEDS INPUT
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
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
                        p: 1.1,
                        borderRadius: 2,
                        background: "linear-gradient(155deg, rgba(15,23,42,0.74), rgba(15,23,42,0.48))",
                    }}
                >
                    <Stack spacing={0.9}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" useFlexGap flexWrap="wrap" spacing={0.7}>
                            <Chip
                                size="small"
                                label={pendingUserQuestion ? "Pending Clarification" : "Assistant Ready"}
                                color={pendingUserQuestion ? "secondary" : "primary"}
                                variant="outlined"
                                sx={{ fontSize: 11 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                                Enter to send · Shift+Enter newline
                            </Typography>
                        </Stack>

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
                            minRows={2}
                            maxRows={8}
                            fullWidth
                            placeholder={
                                pendingUserQuestion
                                    ? "Reply to the pending assistant question (Enter to send)"
                                    : "Ask a project question (Enter to send, Shift+Enter for newline)"
                            }
                            disabled={!hasSelectedChat || sending}
                            InputProps={{
                                sx: {
                                    fontSize: { xs: 14, sm: 15 },
                                    borderRadius: 1.5,
                                },
                            }}
                        />

                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                                variant="outlined"
                                startIcon={<ClearAllRounded />}
                                onClick={onClear}
                                disabled={!hasSelectedChat || sending}
                                sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                            >
                                Clear
                            </Button>
                            <Button
                                variant="contained"
                                endIcon={<SendRounded />}
                                onClick={onSend}
                                disabled={sending || !input.trim() || !hasSelectedChat}
                                sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                            >
                                Send
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>
            </Stack>
        </Paper>
    )
}
