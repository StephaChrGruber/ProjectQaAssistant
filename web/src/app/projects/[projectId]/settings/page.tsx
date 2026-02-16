"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material"
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded"
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
                </Stack>
            </Box>
        </ProjectDrawerLayout>
    )
}
