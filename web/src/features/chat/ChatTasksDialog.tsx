"use client"

import { useEffect, useMemo, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogContent,
    Divider,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import type { ChatTaskItem } from "@/features/chat/types"
import AppDialogTitle from "@/components/AppDialogTitle"

type ChatTasksDialogProps = {
    open: boolean
    loading: boolean
    saving: boolean
    error: string | null
    tasks: ChatTaskItem[]
    onClose: () => void
    onRefresh: () => Promise<void>
    onCreate: (input: { title: string; details: string; assignee: string; due_date: string }) => Promise<void>
    onUpdateTask: (
        taskId: string,
        patch: { title?: string; details?: string; assignee?: string | null; due_date?: string | null; status?: string }
    ) => Promise<void>
}

const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const

type TaskDraft = {
    title: string
    details: string
    assignee: string
    due_date: string
    status: string
}

export function ChatTasksDialog(props: ChatTasksDialogProps) {
    const { open, loading, saving, error, tasks, onClose, onRefresh, onCreate, onUpdateTask } = props
    const [title, setTitle] = useState("")
    const [details, setDetails] = useState("")
    const [assignee, setAssignee] = useState("")
    const [dueDate, setDueDate] = useState("")
    const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
    const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({})

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            const at = new Date(a.updated_at || a.created_at || 0).getTime()
            const bt = new Date(b.updated_at || b.created_at || 0).getTime()
            return bt - at
        })
    }, [tasks])

    useEffect(() => {
        const next: Record<string, TaskDraft> = {}
        for (const task of tasks) {
            next[task.id] = {
                title: task.title || "",
                details: task.details || "",
                assignee: task.assignee || "",
                due_date: task.due_date || "",
                status: task.status || "open",
            }
        }
        setDrafts(next)
    }, [tasks])

    async function submitCreate() {
        const cleanTitle = title.trim()
        if (!cleanTitle) return
        await onCreate({
            title: cleanTitle,
            details: details.trim(),
            assignee: assignee.trim(),
            due_date: dueDate.trim(),
        })
        setTitle("")
        setDetails("")
        setAssignee("")
        setDueDate("")
    }

    async function saveTask(taskId: string) {
        const draft = drafts[taskId]
        if (!draft) return
        setBusyTaskId(taskId)
        try {
            await onUpdateTask(taskId, {
                title: draft.title.trim(),
                details: draft.details.trim(),
                assignee: draft.assignee.trim() || null,
                due_date: draft.due_date.trim() || null,
                status: draft.status,
            })
        } finally {
            setBusyTaskId(null)
        }
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <AppDialogTitle title="Chat Tasks" onClose={onClose} />
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
                            label="Details"
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            fullWidth
                        />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            size="small"
                            label="Assignee"
                            value={assignee}
                            onChange={(e) => setAssignee(e.target.value)}
                            fullWidth
                        />
                        <TextField
                            size="small"
                            label="Due date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
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
                        {sortedTasks.map((task) => {
                            const draft = drafts[task.id] || {
                                title: task.title || "",
                                details: task.details || "",
                                assignee: task.assignee || "",
                                due_date: task.due_date || "",
                                status: task.status || "open",
                            }
                            return (
                                <Box
                                    key={task.id}
                                    sx={{
                                        border: "1px solid",
                                        borderColor: "divider",
                                        borderRadius: 1,
                                        p: 1.1,
                                    }}
                                >
                                    <Stack spacing={1}>
                                        <TextField
                                            size="small"
                                            label="Title"
                                            value={draft.title}
                                            onChange={(e) =>
                                                setDrafts((prev) => ({
                                                    ...prev,
                                                    [task.id]: { ...draft, title: e.target.value },
                                                }))
                                            }
                                            fullWidth
                                        />
                                        <TextField
                                            size="small"
                                            label="Details"
                                            value={draft.details}
                                            onChange={(e) =>
                                                setDrafts((prev) => ({
                                                    ...prev,
                                                    [task.id]: { ...draft, details: e.target.value },
                                                }))
                                            }
                                            multiline
                                            minRows={2}
                                            fullWidth
                                        />
                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                            <TextField
                                                size="small"
                                                label="Assignee"
                                                value={draft.assignee}
                                                onChange={(e) =>
                                                    setDrafts((prev) => ({
                                                        ...prev,
                                                        [task.id]: { ...draft, assignee: e.target.value },
                                                    }))
                                                }
                                                fullWidth
                                            />
                                            <TextField
                                                size="small"
                                                label="Due date"
                                                type="date"
                                                InputLabelProps={{ shrink: true }}
                                                value={draft.due_date}
                                                onChange={(e) =>
                                                    setDrafts((prev) => ({
                                                        ...prev,
                                                        [task.id]: { ...draft, due_date: e.target.value },
                                                    }))
                                                }
                                                fullWidth
                                            />
                                        </Stack>
                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                                            <Select
                                                size="small"
                                                value={draft.status || "open"}
                                                onChange={(e) =>
                                                    setDrafts((prev) => ({
                                                        ...prev,
                                                        [task.id]: { ...draft, status: String(e.target.value || "open") },
                                                    }))
                                                }
                                                disabled={busyTaskId === task.id || saving}
                                                sx={{ minWidth: 170 }}
                                            >
                                                {TASK_STATUSES.map((status) => (
                                                    <MenuItem key={status} value={status}>
                                                        {status}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                onClick={() => void saveTask(task.id)}
                                                disabled={busyTaskId === task.id || saving}
                                            >
                                                {busyTaskId === task.id ? "Saving..." : "Save"}
                                            </Button>
                                        </Stack>
                                    </Stack>
                                    <Divider sx={{ mt: 1 }} />
                                </Box>
                            )
                        })}
                    </Stack>
                </Stack>
            </DialogContent>
        </Dialog>
    )
}
