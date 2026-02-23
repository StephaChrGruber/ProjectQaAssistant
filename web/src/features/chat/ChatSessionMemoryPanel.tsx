"use client"

import { Box, Button, IconButton, Paper, Stack, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"
import type { ChatMemorySummary } from "@/features/chat/types"

type ChatSessionMemoryPanelProps = {
    chatMemory: ChatMemorySummary | null
    onClose: () => void
    onReset?: () => void
    resetting?: boolean
}

export function ChatSessionMemoryPanel({ chatMemory, onClose, onReset, resetting = false }: ChatSessionMemoryPanelProps) {
    return (
        <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
            <Paper variant="outlined" sx={{ p: { xs: 1.2, md: 1.5 }, maxWidth: 980, mx: "auto" }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="overline" color="primary" sx={{ letterSpacing: "0.12em" }}>
                        Session Memory
                    </Typography>
                    <Stack direction="row" spacing={0.6} alignItems="center">
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
                        {(chatMemory?.decisions || []).slice(0, 5).map((item, idx) => (
                            <Typography key={`mem-d-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                - {item}
                            </Typography>
                        ))}
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                            Open Questions
                        </Typography>
                        {(chatMemory?.open_questions || []).slice(0, 5).map((item, idx) => (
                            <Typography key={`mem-q-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                - {item}
                            </Typography>
                        ))}
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                            Next Steps
                        </Typography>
                        {(chatMemory?.next_steps || []).slice(0, 5).map((item, idx) => (
                            <Typography key={`mem-n-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                - {item}
                            </Typography>
                        ))}
                    </Box>
                </Box>
            </Paper>
        </Box>
    )
}
