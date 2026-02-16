"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Paper,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"
import {
    buildFrontendLocalRepoContext,
    hasLocalRepoSnapshot,
    isBrowserLocalRepoPath,
} from "@/lib/local-repo-bridge"

type ChatMessage = {
    role: "user" | "assistant" | "system" | "tool"
    content: string
    ts?: string
}

type ProjectDoc = {
    _id: string
    key?: string
    name?: string
    repo_path?: string
    default_branch?: string
    llm_provider?: string
    llm_model?: string
}

type MeResponse = {
    user?: DrawerUser
}

type BranchesResponse = {
    branches?: string[]
}

type ChatResponse = {
    chat_id: string
    messages: ChatMessage[]
}

type AskAgentResponse = {
    answer?: string
}

function splitChartBlocks(text: string): Array<{ type: "text" | "chart"; value: string }> {
    const parts: Array<{ type: "text" | "chart"; value: string }> = []
    const re = /```chart\s*([\s\S]*?)```/g
    let last = 0
    let m: RegExpExecArray | null

    while ((m = re.exec(text)) !== null) {
        const start = m.index
        const end = re.lastIndex
        if (start > last) {
            parts.push({ type: "text", value: text.slice(last, start) })
        }
        parts.push({ type: "chart", value: (m[1] ?? "").trim() })
        last = end
    }

    if (last < text.length) {
        parts.push({ type: "text", value: text.slice(last) })
    }
    return parts
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

function makeChatId(projectId: string, branch: string, user: string): string {
    return `${projectId}::${branch}::${user}::${Date.now().toString(36)}`
}

export default function ProjectChatPage() {
    const { projectId } = useParams<{ projectId: string }>()
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialChatRef = useRef(searchParams.get("chat"))
    const initialBranchRef = useRef(searchParams.get("branch"))

    const [me, setMe] = useState<DrawerUser | null>(null)
    const [project, setProject] = useState<ProjectDoc | null>(null)
    const [branches, setBranches] = useState<string[]>(["main"])
    const [branch, setBranch] = useState("main")

    const [chats, setChats] = useState<DrawerChat[]>([])
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
    const selectedChatIdRef = useRef<string | null>(null)

    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState("")
    const [loadingChats, setLoadingChats] = useState(false)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [booting, setBooting] = useState(true)

    const scrollRef = useRef<HTMLDivElement | null>(null)
    const projectLabel = useMemo(() => project?.name || project?.key || projectId, [project, projectId])
    const userId = useMemo(() => me?.email || "dev@local", [me])

    useEffect(() => {
        selectedChatIdRef.current = selectedChatId
    }, [selectedChatId])

    const syncUrl = useCallback(
        (chatId: string, activeBranch: string) => {
            const next = buildChatPath(projectId, activeBranch, chatId)
            router.replace(next)
        },
        [projectId, router]
    )

    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
    }, [])

    const ensureChat = useCallback(
        async (chatId: string, activeBranch: string) => {
            await backendJson<ChatResponse>("/api/chats/ensure", {
                method: "POST",
                body: JSON.stringify({
                    chat_id: chatId,
                    project_id: projectId,
                    branch: activeBranch,
                    user: userId,
                    messages: [],
                }),
            })
        },
        [projectId, userId]
    )

    const loadMessages = useCallback(async (chatId: string) => {
        const doc = await backendJson<ChatResponse>(`/api/chats/${encodeURIComponent(chatId)}`)
        setMessages(doc.messages || [])
    }, [])

    const loadChats = useCallback(
        async (activeBranch: string, preferredChatId?: string | null) => {
            setLoadingChats(true)
            try {
                const docs = await backendJson<DrawerChat[]>(
                    `/api/projects/${projectId}/chats?branch=${encodeURIComponent(activeBranch)}&limit=100`
                )

                if (preferredChatId && !docs.some((c) => c.chat_id === preferredChatId)) {
                    await ensureChat(preferredChatId, activeBranch)
                    const now = new Date().toISOString()
                    const merged: DrawerChat[] = [
                        {
                            chat_id: preferredChatId,
                            title: `${projectLabel} / ${activeBranch}`,
                            branch: activeBranch,
                            updated_at: now,
                            created_at: now,
                        },
                        ...docs,
                    ]
                    setChats(merged)
                    setSelectedChatId(preferredChatId)
                    return preferredChatId
                }

                if (!docs.length) {
                    const fallback = preferredChatId || `${projectId}::${activeBranch}::${userId}`
                    await ensureChat(fallback, activeBranch)
                    const now = new Date().toISOString()
                    const seeded: DrawerChat = {
                        chat_id: fallback,
                        title: `${projectLabel} / ${activeBranch}`,
                        branch: activeBranch,
                        updated_at: now,
                        created_at: now,
                    }
                    setChats([seeded])
                    setSelectedChatId(fallback)
                    return fallback
                }

                setChats(docs)
                const current = preferredChatId || selectedChatIdRef.current
                const next = (current && docs.some((c) => c.chat_id === current) && current) || docs[0]?.chat_id || null
                setSelectedChatId(next)
                return next
            } finally {
                setLoadingChats(false)
            }
        },
        [ensureChat, projectId, projectLabel, userId]
    )

    useEffect(() => {
        let cancelled = false

        async function boot() {
            setBooting(true)
            setError(null)
            try {
                const [meRes, projectRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<ProjectDoc>(`/api/projects/${projectId}`),
                ])
                if (cancelled) return
                setMe(meRes.user || null)
                setProject(projectRes)

                let fetchedBranches: string[] = []
                try {
                    const b = await backendJson<BranchesResponse>(`/api/projects/${projectId}/branches`)
                    fetchedBranches = (b.branches || []).filter(Boolean)
                } catch {
                    fetchedBranches = []
                }

                if (!fetchedBranches.length) {
                    fetchedBranches = [projectRes.default_branch || "main"]
                }

                setBranches(fetchedBranches)

                const urlBranch = (initialBranchRef.current || "").trim()
                const preferred = (projectRes.default_branch || "").trim()
                if (urlBranch && fetchedBranches.includes(urlBranch)) {
                    setBranch(urlBranch)
                } else if (preferred && fetchedBranches.includes(preferred)) {
                    setBranch(preferred)
                } else {
                    setBranch(fetchedBranches[0] || "main")
                }
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            } finally {
                if (!cancelled) {
                    setBooting(false)
                }
            }
        }

        void boot()
        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        if (!branch) return
        let cancelled = false

        async function loadByBranch() {
            try {
                const next = await loadChats(branch, initialChatRef.current)
                if (!cancelled && next) {
                    initialChatRef.current = null
                }
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            }
        }

        void loadByBranch()
        return () => {
            cancelled = true
        }
    }, [branch, loadChats])

    useEffect(() => {
        if (!selectedChatId || !branch) return
        const chatId = selectedChatId
        let cancelled = false

        async function syncSelectedChat() {
            setLoadingMessages(true)
            setError(null)
            try {
                await ensureChat(chatId, branch)
                await loadMessages(chatId)
            } catch (err) {
                if (!cancelled) {
                    setMessages([])
                    setError(errText(err))
                }
            } finally {
                if (!cancelled) {
                    setLoadingMessages(false)
                }
            }
        }

        void syncSelectedChat()
        return () => {
            cancelled = true
        }
    }, [branch, ensureChat, loadMessages, selectedChatId])

    useEffect(() => {
        scrollToBottom()
    }, [messages, sending, loadingMessages, scrollToBottom])

    useEffect(() => {
        if (!selectedChatId || !branch) return
        syncUrl(selectedChatId, branch)
        saveLastChat({
            projectId,
            branch,
            chatId: selectedChatId,
            path: buildChatPath(projectId, branch, selectedChatId),
            ts: Date.now(),
        })
    }, [branch, projectId, selectedChatId, syncUrl])

    const onSelectChat = useCallback((chat: DrawerChat) => {
        setSelectedChatId(chat.chat_id)
    }, [])

    const onBranchChange = useCallback((nextBranch: string) => {
        setBranch(nextBranch)
        setMessages([])
        setSelectedChatId(null)
    }, [])

    const onNewChat = useCallback(async () => {
        const newChatId = makeChatId(projectId, branch, userId)
        setError(null)
        try {
            await ensureChat(newChatId, branch)
            await loadChats(branch, newChatId)
            setMessages([])
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, ensureChat, loadChats, projectId, userId])

    const send = useCallback(async () => {
        const q = input.trim()
        if (!q || sending || !selectedChatId) return

        setSending(true)
        setError(null)
        setInput("")
        setMessages((prev) => [...prev, { role: "user", content: q, ts: new Date().toISOString() }])

        try {
            const repoPath = (project?.repo_path || "").trim()
            let localRepoContext: string | undefined
            if (isBrowserLocalRepoPath(repoPath)) {
                if (!hasLocalRepoSnapshot(projectId)) {
                    throw new Error(
                        "This project uses a browser-local repository. Open Project Settings and pick the local repo folder on this device first."
                    )
                }
                localRepoContext = buildFrontendLocalRepoContext(projectId, q, branch) || undefined
            }

            const res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                method: "POST",
                body: JSON.stringify({
                    project_id: projectId,
                    branch,
                    user: userId,
                    chat_id: selectedChatId,
                    top_k: 8,
                    question: q,
                    local_repo_context: localRepoContext,
                }),
            })

            if (res.answer?.trim()) {
                setMessages((prev) => [...prev, { role: "assistant", content: res.answer || "", ts: new Date().toISOString() }])
            }

            await loadMessages(selectedChatId)
            await loadChats(branch, selectedChatId)
        } catch (err) {
            setError(errText(err))
        } finally {
            setSending(false)
        }
    }, [branch, input, loadChats, loadMessages, project?.repo_path, projectId, selectedChatId, sending, userId])

    const clearChat = useCallback(async () => {
        if (!selectedChatId) return
        setError(null)
        try {
            await backendJson(`/api/chats/${encodeURIComponent(selectedChatId)}/clear`, { method: "POST" })
            await loadMessages(selectedChatId)
            await loadChats(branch, selectedChatId)
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, loadChats, loadMessages, selectedChatId])

    return (
        <ProjectDrawerLayout
            projectId={projectId}
            projectLabel={projectLabel}
            branch={branch}
            branches={branches}
            onBranchChange={onBranchChange}
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={onSelectChat}
            onNewChat={onNewChat}
            user={me}
            loadingChats={loadingChats}
            activeSection="chat"
        >
            <Stack sx={{ minHeight: 0, flex: 1 }}>
                <Paper
                    square
                    elevation={0}
                    sx={{
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        px: { xs: 1.5, md: 3 },
                        py: { xs: 1.25, md: 1.8 },
                    }}
                >
                    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.15em" }}>
                        RAG Conversation
                    </Typography>
                    <Typography variant="h6" sx={{ mt: 0.2, fontWeight: 700, fontSize: { xs: "1.02rem", sm: "1.2rem" } }}>
                        {projectLabel}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Branch: {branch} · {(project?.llm_provider || "default LLM").toUpperCase()}
                        {project?.llm_model ? ` · ${project.llm_model}` : ""}
                    </Typography>
                </Paper>

                {error && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="error">{error}</Alert>
                    </Box>
                )}

                <Box
                    ref={scrollRef}
                    sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 1.25, md: 4 }, py: { xs: 1.6, md: 2.5 } }}
                >
                    <Stack spacing={1.5} sx={{ maxWidth: 980, mx: "auto" }}>
                        {booting && (
                            <Paper variant="outlined" sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.2 }}>
                                <CircularProgress size={18} />
                                <Typography variant="body2">Loading workspace...</Typography>
                            </Paper>
                        )}

                        {!booting && !loadingMessages && messages.length === 0 && (
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                <Typography variant="body2" color="text.secondary">
                                    Start with a question about this project. The assistant can use Git, Confluence, and Jira context.
                                </Typography>
                            </Paper>
                        )}

                        {messages.map((m, idx) => {
                            const isUser = m.role === "user"
                            return (
                                <Box key={`${m.ts || idx}-${idx}`} sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                                    <Paper
                                        variant={isUser ? "elevation" : "outlined"}
                                        elevation={isUser ? 3 : 0}
                                        sx={{
                                            maxWidth: { xs: "96%", sm: "92%" },
                                            px: { xs: 1.5, sm: 2 },
                                            py: { xs: 1.1, sm: 1.4 },
                                            borderRadius: 3,
                                            bgcolor: isUser ? "primary.main" : "background.paper",
                                            color: isUser ? "primary.contrastText" : "text.primary",
                                        }}
                                    >
                                        <Stack spacing={1}>
                                            {splitChartBlocks(m.content || "").map((part, i) => {
                                                if (part.type === "chart") {
                                                    return (
                                                        <Paper key={i} variant="outlined" sx={{ p: 1.2, bgcolor: "rgba(0,0,0,0.24)" }}>
                                                            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.12em" }}>
                                                                CHART BLOCK
                                                            </Typography>
                                                            <Box
                                                                component="pre"
                                                                sx={{
                                                                    mt: 0.8,
                                                                    mb: 0,
                                                                    overflowX: "auto",
                                                                    whiteSpace: "pre",
                                                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                                    fontSize: 12,
                                                                }}
                                                            >
                                                                {part.value}
                                                            </Box>
                                                        </Paper>
                                                    )
                                                }

                                                return (
                                                    <Typography key={i} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                                                        {part.value}
                                                    </Typography>
                                                )
                                            })}
                                        </Stack>
                                    </Paper>
                                </Box>
                            )
                        })}

                        {(sending || loadingMessages) && (
                            <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                                <Paper variant="outlined" sx={{ px: 1.6, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                                    <CircularProgress size={16} />
                                    <Typography variant="body2" color="text.secondary">
                                        Thinking...
                                    </Typography>
                                </Paper>
                            </Box>
                        )}
                    </Stack>
                </Box>

                <Paper
                    square
                    elevation={0}
                    sx={{
                        borderTop: "1px solid",
                        borderColor: "divider",
                        px: { xs: 1.25, md: 3 },
                        pt: { xs: 1.25, md: 1.8 },
                        pb: "calc(10px + env(safe-area-inset-bottom, 0px))",
                    }}
                >
                    <Stack sx={{ maxWidth: 980, mx: "auto" }} spacing={1.2}>
                        <TextField
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault()
                                    void send()
                                }
                            }}
                            multiline
                            minRows={1}
                            maxRows={6}
                            fullWidth
                            placeholder="Ask a project question (Enter to send, Shift+Enter for newline)"
                            disabled={!selectedChatId || sending}
                            InputProps={{
                                sx: {
                                    fontSize: { xs: 14, sm: 15 },
                                },
                            }}
                        />

                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                                variant="outlined"
                                startIcon={<ClearAllRounded />}
                                onClick={() => void clearChat()}
                                disabled={!selectedChatId || sending}
                                sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                            >
                                Clear
                            </Button>
                            <Button
                                variant="contained"
                                endIcon={<SendRounded />}
                                onClick={() => void send()}
                                disabled={sending || !input.trim() || !selectedChatId}
                                sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                            >
                                Send
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>
            </Stack>
        </ProjectDrawerLayout>
    )
}
