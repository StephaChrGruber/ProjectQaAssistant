"use client"

import { Box, Button, IconButton, Paper, Stack, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"
import type { AskAgentResponse } from "@/features/chat/types"

type ChatToolEventsBannerProps = {
    events: AskAgentResponse["tool_events"]
    onDismiss: () => void
    onOpenTools?: () => void
}

export function ChatToolEventsBanner({ events, onDismiss, onOpenTools }: ChatToolEventsBannerProps) {
    if (!events?.length) return null
    const blockedByApproval = Array.from(
        new Set(
            events
                .filter((ev) => {
                    if (ev?.ok) return false
                    if (String(ev?.error?.code || "") !== "forbidden") return false
                    const msg = String(ev?.error?.message || "").toLowerCase()
                    return msg.includes("write_approval_required") || msg.includes("approval_required")
                })
                .map((ev) => String(ev?.tool || "").trim())
                .filter(Boolean)
        )
    )

    return (
        <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
            <Paper variant="outlined" sx={{ p: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                        TOOL EXECUTION
                    </Typography>
                    <IconButton size="small" onClick={onDismiss}>
                        <CloseRounded fontSize="small" />
                    </IconButton>
                </Stack>
                <Stack spacing={0.45} sx={{ mt: 0.8 }}>
                    {events.map((ev, idx) => (
                        <Typography key={`${ev.tool}-${idx}`} variant="body2" color={ev.ok ? "success.main" : "warning.main"}>
                            {ev.ok ? "OK" : "ERR"} · {ev.tool} · {ev.duration_ms} ms
                            {ev.cached ? " · cached" : ""}
                            {ev.attempts && ev.attempts > 1 ? ` · attempts:${ev.attempts}` : ""}
                            {ev.error?.code ? ` · ${ev.error.code}` : ""}
                            {ev.error?.message ? ` · ${ev.error.message}` : ""}
                        </Typography>
                    ))}
                    {!!blockedByApproval.length && (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 0.5 }}>
                            <Typography variant="caption" color="warning.main">
                                Write tool approval required: {blockedByApproval.join(", ")}
                            </Typography>
                            {!!onOpenTools && (
                                <Button size="small" variant="outlined" onClick={onOpenTools}>
                                    Open Tools
                                </Button>
                            )}
                        </Stack>
                    )}
                </Stack>
            </Paper>
        </Box>
    )
}
