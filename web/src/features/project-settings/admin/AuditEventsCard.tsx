"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material"
import { backendJson } from "@/lib/backend"
import { errText, type AuditEventItem, type AuditEventsResponse } from "@/features/project-settings/form-model"

type AuditEventsCardProps = {
    projectId: string
    branch: string
}

const EVENT_FILTERS = [
    "",
    "ask_agent.start",
    "ask_agent.finish",
    "ask_agent.llm_upstream_error",
    "ask_agent.internal_error",
]

export default function AuditEventsCard({ projectId, branch }: AuditEventsCardProps) {
    const [items, setItems] = useState<AuditEventItem[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [eventFilter, setEventFilter] = useState("")
    const [chatFilter, setChatFilter] = useState("")
    const [limit, setLimit] = useState(120)

    const queryPath = useMemo(() => {
        const params = new URLSearchParams()
        params.set("branch", branch || "main")
        params.set("limit", String(limit))
        if (eventFilter.trim()) params.set("event", eventFilter.trim())
        if (chatFilter.trim()) params.set("chat_id", chatFilter.trim())
        return `/api/projects/${projectId}/audit-events?${params.toString()}`
    }, [branch, chatFilter, eventFilter, limit, projectId])

    const refresh = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const out = await backendJson<AuditEventsResponse>(queryPath)
            setItems((out.items || []).filter((x) => x && x.event))
        } catch (err) {
            setError(errText(err))
        } finally {
            setLoading(false)
        }
    }, [queryPath])

    useEffect(() => {
        void refresh()
    }, [refresh])

    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        Audit Events
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Select
                            size="small"
                            value={eventFilter}
                            onChange={(e) => setEventFilter(String(e.target.value || ""))}
                            sx={{ minWidth: 220 }}
                        >
                            <MenuItem value="">All events</MenuItem>
                            {EVENT_FILTERS.filter(Boolean).map((ev) => (
                                <MenuItem key={ev} value={ev}>
                                    {ev}
                                </MenuItem>
                            ))}
                        </Select>
                        <TextField
                            size="small"
                            label="Chat ID"
                            value={chatFilter}
                            onChange={(e) => setChatFilter(e.target.value)}
                            sx={{ minWidth: 240 }}
                        />
                        <Select size="small" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value || 120))}>
                            {[50, 120, 250, 500].map((n) => (
                                <MenuItem key={n} value={String(n)}>
                                    {n}
                                </MenuItem>
                            ))}
                        </Select>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={() => void refresh()}
                            disabled={loading}
                            startIcon={<RefreshRounded />}
                        >
                            Refresh
                        </Button>
                    </Stack>
                </Stack>

                {error ? (
                    <Alert severity="error" sx={{ mt: 1.2 }}>
                        {error}
                    </Alert>
                ) : null}

                <TableContainer sx={{ mt: 1.2, maxHeight: 360, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Table stickyHeader size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Time</TableCell>
                                <TableCell>Event</TableCell>
                                <TableCell>Level</TableCell>
                                <TableCell>User</TableCell>
                                <TableCell>Chat</TableCell>
                                <TableCell>Request</TableCell>
                                <TableCell>Details</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items.map((row, idx) => (
                                <TableRow key={row.id || `${row.event}-${row.created_at || ""}-${idx}`} hover>
                                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                                        {row.created_at ? new Date(row.created_at).toLocaleString() : "-"}
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: "nowrap" }}>{row.event}</TableCell>
                                    <TableCell>{row.level || "-"}</TableCell>
                                    <TableCell sx={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {row.user || "-"}
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {row.chat_id || "-"}
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {row.request_id || "-"}
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 420, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                        {row.details ? JSON.stringify(row.details).slice(0, 240) : "-"}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!items.length ? (
                                <TableRow>
                                    <TableCell colSpan={7}>
                                        <Box sx={{ py: 2 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                {loading ? "Loading audit events..." : "No audit events found."}
                                            </Typography>
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ) : null}
                        </TableBody>
                    </Table>
                </TableContainer>
            </CardContent>
        </Card>
    )
}
