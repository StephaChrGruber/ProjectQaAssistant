"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"

type ProjectDoc = {
    _id: string
    key?: string
    name?: string
    description?: string
    repo_path?: string
    default_branch?: string
    llm_provider?: string
    llm_base_url?: string
    llm_model?: string
    llm_api_key?: string
}

type MeResponse = {
    user?: DrawerUser
}

type BranchesResponse = {
    branches?: string[]
}

type ProjectEditForm = {
    name: string
    description: string
    repo_path: string
    default_branch: string
    llm_provider: string
    llm_base_url: string
    llm_model: string
    llm_api_key: string
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

function makeChatId(projectId: string, branch: string, user: string): string {
    return `${projectId}::${branch}::${user}::${Date.now().toString(36)}`
}

function maskSecret(secret?: string): string {
    if (!secret) return "not set"
    if (secret.length <= 6) return "***"
    return `${secret.slice(0, 3)}...${secret.slice(-2)}`
}

function DetailCard({ title, value }: { title: string; value: string }) {
    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.1em" }}>
                    {title}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.8, wordBreak: "break-word" }}>
                    {value}
                </Typography>
            </CardContent>
        </Card>
    )
}

export default function ProjectSettingsPage() {
    const { projectId } = useParams<{ projectId: string }>()
    const router = useRouter()

    const [me, setMe] = useState<DrawerUser | null>(null)
    const [project, setProject] = useState<ProjectDoc | null>(null)
    const [branches, setBranches] = useState<string[]>(["main"])
    const [branch, setBranch] = useState("main")
    const [chats, setChats] = useState<DrawerChat[]>([])
    const [loadingChats, setLoadingChats] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [editForm, setEditForm] = useState<ProjectEditForm>({
        name: "",
        description: "",
        repo_path: "",
        default_branch: "main",
        llm_provider: "ollama",
        llm_base_url: "http://ollama:11434/v1",
        llm_model: "llama3.2:3b",
        llm_api_key: "ollama",
    })

    const projectLabel = useMemo(
        () => project?.name || project?.key || projectId,
        [project?.name, project?.key, projectId]
    )
    const userId = useMemo(() => me?.email || "dev@local", [me])

    const loadChats = useCallback(async () => {
        setLoadingChats(true)
        try {
            const docs = await backendJson<DrawerChat[]>(
                `/api/projects/${projectId}/chats?branch=${encodeURIComponent(branch)}&limit=100`
            )
            setChats(docs)
        } finally {
            setLoadingChats(false)
        }
    }, [branch, projectId])

    useEffect(() => {
        let cancelled = false

        async function boot() {
            setError(null)
            try {
                const [meRes, projectRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<ProjectDoc>(`/api/projects/${projectId}`),
                ])
                if (cancelled) return
                setMe(meRes.user || null)
                setProject(projectRes)
                setEditForm({
                    name: projectRes.name || "",
                    description: projectRes.description || "",
                    repo_path: projectRes.repo_path || "",
                    default_branch: projectRes.default_branch || "main",
                    llm_provider: projectRes.llm_provider || "ollama",
                    llm_base_url: projectRes.llm_base_url || "http://ollama:11434/v1",
                    llm_model: projectRes.llm_model || "",
                    llm_api_key: projectRes.llm_api_key || "",
                })

                let b: string[] = []
                try {
                    const br = await backendJson<BranchesResponse>(`/api/projects/${projectId}/branches`)
                    b = (br.branches || []).filter(Boolean)
                } catch {
                    b = []
                }
                if (!b.length) {
                    b = [projectRes.default_branch || "main"]
                }
                setBranches(b)
                setBranch((prev) => {
                    if (prev && b.includes(prev)) return prev
                    return b[0] || "main"
                })
            } catch (err) {
                if (!cancelled) setError(errText(err))
            }
        }

        void boot()
        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        void loadChats().catch((err) => setError(errText(err)))
    }, [loadChats])

    async function onSaveProjectSettings() {
        if (!me?.isGlobalAdmin) return
        setSaving(true)
        setError(null)
        setNotice(null)
        try {
            const updated = await backendJson<ProjectDoc>(`/api/admin/projects/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({
                    name: editForm.name.trim() || null,
                    description: editForm.description.trim() || null,
                    repo_path: editForm.repo_path.trim() || null,
                    default_branch: editForm.default_branch.trim() || "main",
                    llm_provider: editForm.llm_provider || null,
                    llm_base_url: editForm.llm_base_url.trim() || null,
                    llm_model: editForm.llm_model.trim() || null,
                    llm_api_key: editForm.llm_api_key.trim() || null,
                }),
            })
            setProject(updated)
            setNotice("Project settings saved.")
        } catch (err) {
            setError(errText(err))
        } finally {
            setSaving(false)
        }
    }

    const onSelectChat = useCallback(
        (chat: DrawerChat) => {
            const targetBranch = chat.branch || branch
            const path = buildChatPath(projectId, targetBranch, chat.chat_id)
            saveLastChat({
                projectId,
                branch: targetBranch,
                chatId: chat.chat_id,
                path,
                ts: Date.now(),
            })
            router.push(path)
        },
        [branch, projectId, router]
    )

    const onNewChat = useCallback(() => {
        const chatId = makeChatId(projectId, branch, userId)
        const path = buildChatPath(projectId, branch, chatId)
        saveLastChat({
            projectId,
            branch,
            chatId,
            path,
            ts: Date.now(),
        })
        router.push(path)
    }, [branch, projectId, router, userId])

    return (
        <ProjectDrawerLayout
            projectId={projectId}
            projectLabel={projectLabel}
            branch={branch}
            branches={branches}
            onBranchChange={setBranch}
            chats={chats}
            selectedChatId={null}
            onSelectChat={onSelectChat}
            onNewChat={onNewChat}
            user={me}
            loadingChats={loadingChats}
            activeSection="settings"
        >
            <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 1.5, md: 3 }, py: { xs: 1.8, md: 2.5 } }}>
                <Stack spacing={2} sx={{ maxWidth: 980, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                            <Typography variant="overline" color="primary.light" sx={{ letterSpacing: "0.14em" }}>
                                Workspace Settings
                            </Typography>
                            <Typography variant="h4" sx={{ mt: 0.5, fontWeight: 700, fontSize: { xs: "1.55rem", md: "2.1rem" } }}>
                                {projectLabel}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                Review where this assistant reads from and which model stack it uses.
                            </Typography>
                        </CardContent>
                    </Card>

                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="success">{notice}</Alert>}

                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                Project
                            </Typography>
                            <Box
                                sx={{
                                    mt: 1.5,
                                    display: "grid",
                                    gap: 1.2,
                                    gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                                }}
                            >
                                <DetailCard title="Project ID" value={projectId} />
                                <DetailCard title="Default Branch" value={project?.default_branch || "main"} />
                                <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                    <DetailCard title="Local Repo Path" value={project?.repo_path || "not configured"} />
                                </Box>
                                <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                    <DetailCard title="Description" value={project?.description || "No description"} />
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                LLM
                            </Typography>
                            <Box
                                sx={{
                                    mt: 1.5,
                                    display: "grid",
                                    gap: 1.2,
                                    gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                                }}
                            >
                                <DetailCard title="Provider" value={project?.llm_provider || "default"} />
                                <DetailCard title="Model" value={project?.llm_model || "backend default"} />
                                <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                    <DetailCard title="Base URL" value={project?.llm_base_url || "backend default"} />
                                </Box>
                                <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                    <DetailCard title="API Key" value={maskSecret(project?.llm_api_key)} />
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                Sources
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                Git, Confluence, and Jira connectors are managed from the admin console and ingested into this
                                project index.
                            </Typography>

                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
                                <Chip label="Git" color="primary" variant="outlined" />
                                <Chip label="Confluence" color="primary" variant="outlined" />
                                <Chip label="Jira" color="primary" variant="outlined" />
                            </Stack>

                            <Stack
                                direction="row"
                                spacing={1}
                                useFlexGap
                                flexWrap="wrap"
                                sx={{ mt: 2, "& .MuiButton-root": { width: { xs: "100%", sm: "auto" } } }}
                            >
                                <Button component={Link} href={`/projects/${projectId}/chat`} variant="contained">
                                    Open Chat
                                </Button>
                                {me?.isGlobalAdmin && (
                                    <Button
                                        component={Link}
                                        href="/admin"
                                        variant="outlined"
                                        endIcon={<OpenInNewRounded />}
                                    >
                                        Open Admin Workflow
                                    </Button>
                                )}
                            </Stack>
                        </CardContent>
                    </Card>

                    {me?.isGlobalAdmin && (
                        <Card variant="outlined">
                            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                    Edit Project Settings
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                                    Update this project's metadata and LLM configuration.
                                </Typography>

                                <Box
                                    sx={{
                                        mt: 1.5,
                                        display: "grid",
                                        gap: 1.2,
                                        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                                    }}
                                >
                                    <TextField
                                        label="Project Name"
                                        value={editForm.name}
                                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        label="Default Branch"
                                        value={editForm.default_branch}
                                        onChange={(e) => setEditForm((f) => ({ ...f, default_branch: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        label="Description"
                                        value={editForm.description}
                                        onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                        multiline
                                        minRows={3}
                                        fullWidth
                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                    />
                                    <TextField
                                        label="Local Repo Path"
                                        value={editForm.repo_path}
                                        onChange={(e) => setEditForm((f) => ({ ...f, repo_path: e.target.value }))}
                                        fullWidth
                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                    />
                                    <FormControl fullWidth size="small">
                                        <InputLabel id="project-settings-llm-provider">LLM Provider</InputLabel>
                                        <Select
                                            labelId="project-settings-llm-provider"
                                            label="LLM Provider"
                                            value={editForm.llm_provider}
                                            onChange={(e) => setEditForm((f) => ({ ...f, llm_provider: e.target.value }))}
                                        >
                                            <MenuItem value="ollama">Ollama (local)</MenuItem>
                                            <MenuItem value="openai">ChatGPT / OpenAI API</MenuItem>
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        label="LLM Model"
                                        value={editForm.llm_model}
                                        onChange={(e) => setEditForm((f) => ({ ...f, llm_model: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        label="LLM Base URL"
                                        value={editForm.llm_base_url}
                                        onChange={(e) => setEditForm((f) => ({ ...f, llm_base_url: e.target.value }))}
                                        fullWidth
                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                    />
                                    <TextField
                                        label="LLM API Key"
                                        value={editForm.llm_api_key}
                                        onChange={(e) => setEditForm((f) => ({ ...f, llm_api_key: e.target.value }))}
                                        fullWidth
                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                    />
                                </Box>

                                <Button
                                    variant="contained"
                                    startIcon={<SaveRounded />}
                                    onClick={() => void onSaveProjectSettings()}
                                    disabled={saving}
                                    sx={{ mt: 1.6 }}
                                >
                                    Save Changes
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </Stack>
            </Box>
        </ProjectDrawerLayout>
    )
}
