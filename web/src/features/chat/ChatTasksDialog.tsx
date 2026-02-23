"use client"

import { useMemo, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import type { ChatTaskItem } from "@/features/chat/types"

type ChatTasksDialogProps = {
    open: boolean
    loading: boolean
    saving: boolean
    error: string | null
    tasks: ChatTaskItem[]
    onClose: () => void
    onRefresh: () => Promise<void>
    onCreate: (input: { title: string; details: string }) => Promise<void>
    onUpdateStatus: (taskId: string, status: string) => Promise<void>
}

const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const

export function ChatTasksDialog(props: ChatTasksDialogProps) {
    const { open, loading, saving, error, tasks, onClose, onRefresh, onCreate, onUpdateStatus } = props
    const [title, setTitle] = useState("")
    const [details, setDetails] = useState("")
    const [busyTaskId, setBusyTaskId] = useState<string | null>(null)

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            const at = new Date(a.updated_at || a.created_at || 0).getTime()
            const bt = new Date(b.updated_at || b.created_at || 0).getTime()
            return bt - at
        })
    }, [tasks])

    async function submitCreate() {
        const cleanTitle = title.trim()
        if (!cleanTitle) return
        await onCreate({ title: cleanTitle, details: details.trim() })
        setTitle("")
        setDetails("")
    }

    async function changeStatus(taskId: string, status: string) {
        setBusyTaskId(taskId)
        try {
            await onUpdateStatus(taskId, status)
        } finally {
            setBusyTaskId(null)
        }
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle>Chat Tasks</DialogTitle>
            <DialogContent>
                <Stack spacing={1.5} sx={{ pt: 0.5 }}>
                    {error ? <Alert severity="error">{error}</Alert> : null}

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            size="small"
                            label="Task title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            fullWidth
                        />
                        <TextField
                            size="small"
                            label="Details (optional)"
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            fullWidth
                        />
                        <Button variant="contained" onClick={() => void submitCreate()} disabled={saving || !title.trim()}>
                            Add
                        </Button>
                    </Stack>

                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle2" color="text.secondary">
                            {sortedTasks.length} task(s)
                        </Typography>
                        <Button size="small" variant="outlined" onClick={() => void onRefresh()} disabled={loading}>
                            {loading ? "Refreshing..." : "Refresh"}
                        </Button>
                    </Stack>

                    <Stack spacing={1}>
                        {sortedTasks.map((task) => (
                            <Box
                                key={task.id}
                                sx={{
                                    border: "1px solid",
                                    borderColor: "divider",
                                    borderRadius: 1,
                                    p: 1.1,
                                }}
                            >
                                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="subtitle2" sx={{ wordBreak: "break-word" }}>
                                            {task.title}
                                        </Typography>
                                        {task.details ? (
                                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.2 }}>
                                                {task.details}
                                            </Typography>
                                        ) : null}
                                    </Box>
                                    <Select
                                        size="small"
                                        value={task.status || "open"}
                                        onChange={(e) => void changeStatus(task.id, String(e.target.value || "open"))}
                                        disabled={busyTaskId === task.id || saving}
                                        sx={{ minWidth: 150 }}
                                    >
                                        {TASK_STATUSES.map((status) => (
                                            <MenuItem key={status} value={status}>
                                                {status}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </Stack>
                            </Box>
                        ))}
                    </Stack>
                </Stack>
            </DialogContent>
        </Dialog>
    )
}
