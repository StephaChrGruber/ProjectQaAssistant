"use client"

import { useEffect, useMemo, useState } from "react"
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from "@mui/material"
import { backendJson } from "@/lib/backend"
import type { BranchesResponse, LlmProfileDoc } from "@/features/chat/types"
import AppDialogTitle from "@/components/AppDialogTitle"

type NewChatProject = {
    id: string
    label: string
    defaultBranch?: string
}

type Props = {
    open: boolean
    projects: NewChatProject[]
    llmProfiles: LlmProfileDoc[]
    defaultProjectId: string
    defaultBranch: string
    busy?: boolean
    error?: string | null
    onClose: () => void
    onCreate: (input: { projectId: string; branch: string; llmProfileId: string }) => void
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

export function NewChatDialog({
    open,
    projects,
    llmProfiles,
    defaultProjectId,
    defaultBranch,
    busy = false,
    error,
    onClose,
    onCreate,
}: Props) {
    const [projectId, setProjectId] = useState(defaultProjectId)
    const [branch, setBranch] = useState(defaultBranch || "main")
    const [llmProfileId, setLlmProfileId] = useState("")
    const [branches, setBranches] = useState<string[]>([])
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [branchesError, setBranchesError] = useState<string | null>(null)

    const selectedProject = useMemo(
        () => projects.find((p) => p.id === projectId) || null,
        [projects, projectId]
    )

    useEffect(() => {
        if (!open) return
        setProjectId(defaultProjectId || projects[0]?.id || "")
        setBranch(defaultBranch || "main")
        setLlmProfileId("")
        setBranchesError(null)
    }, [defaultBranch, defaultProjectId, open, projects])

    useEffect(() => {
        if (!open || !projectId) return
        let cancelled = false

        async function loadBranches() {
            setLoadingBranches(true)
            setBranchesError(null)
            try {
                const out = await backendJson<BranchesResponse>(`/api/projects/${encodeURIComponent(projectId)}/branches`)
                const next = (out.branches || []).filter(Boolean)
                if (cancelled) return
                const fallback = selectedProject?.defaultBranch || "main"
                const resolved = next.length ? next : [fallback]
                setBranches(resolved)
                setBranch((current) => (resolved.includes(current) ? current : resolved[0] || fallback))
            } catch (err) {
                if (cancelled) return
                const fallback = selectedProject?.defaultBranch || "main"
                setBranches([fallback])
                setBranch(fallback)
                setBranchesError(errText(err))
            } finally {
                if (!cancelled) setLoadingBranches(false)
            }
        }

        void loadBranches()
        return () => {
            cancelled = true
        }
    }, [open, projectId, selectedProject?.defaultBranch])

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
            <AppDialogTitle
                title="Start New Chat"
                subtitle="Choose project, branch, and LLM profile for the new conversation."
                onClose={busy ? undefined : onClose}
                closeDisabled={busy}
            />
            <DialogContent>
                <Stack spacing={1.4} sx={{ mt: 0.2 }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    {branchesError && <Alert severity="warning">{branchesError}</Alert>}

                    <FormControl fullWidth size="small">
                        <InputLabel id="new-chat-project-label">Project</InputLabel>
                        <Select
                            labelId="new-chat-project-label"
                            label="Project"
                            value={projectId}
                            onChange={(e) => setProjectId(String(e.target.value || ""))}
                            disabled={busy}
                        >
                            {projects.map((project) => (
                                <MenuItem key={project.id} value={project.id}>
                                    {project.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth size="small" disabled={busy || loadingBranches || !projectId}>
                        <InputLabel id="new-chat-branch-label">Branch</InputLabel>
                        <Select
                            labelId="new-chat-branch-label"
                            label="Branch"
                            value={branch}
                            onChange={(e) => setBranch(String(e.target.value || ""))}
                        >
                            {(branches.length ? branches : [selectedProject?.defaultBranch || "main"]).map((item) => (
                                <MenuItem key={item} value={item}>
                                    {item}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth size="small" disabled={busy || !projectId}>
                        <InputLabel id="new-chat-llm-label">LLM</InputLabel>
                        <Select
                            labelId="new-chat-llm-label"
                            label="LLM"
                            value={llmProfileId}
                            onChange={(e) => setLlmProfileId(String(e.target.value || ""))}
                        >
                            <MenuItem value="">Project default</MenuItem>
                            {llmProfiles.map((profile) => (
                                <MenuItem key={profile.id} value={profile.id}>
                                    {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button
                    variant="contained"
                    onClick={() => onCreate({ projectId, branch, llmProfileId })}
                    disabled={busy || !projectId || !branch}
                >
                    {busy ? "Creating..." : "Create Chat"}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
