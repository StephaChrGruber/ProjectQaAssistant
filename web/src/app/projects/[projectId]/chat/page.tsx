"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import DescriptionRounded from "@mui/icons-material/DescriptionRounded"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import CloseRounded from "@mui/icons-material/CloseRounded"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"
import {
    buildLocalRepoDocumentationContext,
    buildFrontendLocalRepoContext,
    ensureLocalRepoWritePermission,
    hasLocalRepoSnapshot,
    hasLocalRepoWriteCapability,
    isBrowserLocalRepoPath,
    listLocalDocumentationFiles,
    readLocalDocumentationFile,
    restoreLocalRepoSession,
    writeLocalDocumentationFiles,
} from "@/lib/local-repo-bridge"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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

type GenerateDocsResponse = {
    branch?: string
    current_branch?: string
    mode?: string
    summary?: string
    llm_error?: string | null
    files_written?: string[]
    files?: Array<{ path: string; content: string }>
}

type DocumentationListResponse = {
    branch?: string
    current_branch?: string
    files?: Array<{
        path: string
        size?: number | null
        updated_at?: string | null
    }>
}

type DocumentationFileResponse = {
    branch?: string
    path: string
    content: string
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

function asksForDocumentationGeneration(text: string): boolean {
    const q = text.toLowerCase()
    const hasDoc = q.includes("documentation") || q.includes("docs")
    const hasAction =
        q.includes("generate") ||
        q.includes("create") ||
        q.includes("build") ||
        q.includes("refresh") ||
        q.includes("update")
    return hasDoc && hasAction
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
    const [docsOpen, setDocsOpen] = useState(false)
    const [docsLoading, setDocsLoading] = useState(false)
    const [docsGenerating, setDocsGenerating] = useState(false)
    const [docsError, setDocsError] = useState<string | null>(null)
    const [docsNotice, setDocsNotice] = useState<string | null>(null)
    const [docsFiles, setDocsFiles] = useState<Array<{ path: string; size?: number | null; updated_at?: string | null }>>([])
    const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null)
    const [selectedDocContent, setSelectedDocContent] = useState("")
    const [docContentLoading, setDocContentLoading] = useState(false)

    const scrollRef = useRef<HTMLDivElement | null>(null)
    const projectLabel = useMemo(() => project?.name || project?.key || projectId, [project, projectId])
    const userId = useMemo(() => me?.email || "dev@local", [me])
    const browserLocalRepoMode = useMemo(
        () => isBrowserLocalRepoPath((project?.repo_path || "").trim()),
        [project?.repo_path]
    )

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
                    `/api/projects/${projectId}/chats?branch=${encodeURIComponent(activeBranch)}&limit=100&user=${encodeURIComponent(userId)}`
                )

                const current = preferredChatId || selectedChatIdRef.current
                if (current && !docs.some((c) => c.chat_id === current)) {
                    await ensureChat(current, activeBranch)
                    const now = new Date().toISOString()
                    const merged: DrawerChat[] = [
                        {
                            chat_id: current,
                            title: `${projectLabel} / ${activeBranch}`,
                            branch: activeBranch,
                            updated_at: now,
                            created_at: now,
                        },
                        ...docs.filter((c) => c.chat_id !== current),
                    ]
                    setChats(merged)
                    setSelectedChatId(current)
                    return current
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

    useEffect(() => {
        if (!browserLocalRepoMode) return
        void restoreLocalRepoSession(projectId)
    }, [browserLocalRepoMode, projectId])

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

    const maybeAutoGenerateDocsFromQuestion = useCallback(
        async (question: string) => {
            if (!browserLocalRepoMode) return
            if (!asksForDocumentationGeneration(question)) return

            if (!hasLocalRepoSnapshot(projectId)) {
                await restoreLocalRepoSession(projectId)
            }
            if (!hasLocalRepoSnapshot(projectId)) {
                throw new Error(
                    "Browser-local repository is not indexed in this session. Open Project Settings and pick the local repository folder first."
                )
            }
            if (!hasLocalRepoWriteCapability(projectId)) {
                await restoreLocalRepoSession(projectId)
            }
            if (!hasLocalRepoWriteCapability(projectId)) {
                throw new Error(
                    "Local repository write access is not available. Re-pick the repository folder in Project Settings to grant write access."
                )
            }
            const allowed = await ensureLocalRepoWritePermission(projectId)
            if (!allowed) {
                throw new Error("Write permission to local repository folder was denied.")
            }

            const localContext = buildLocalRepoDocumentationContext(projectId, branch)
            if (!localContext) {
                throw new Error("Could not build local repository context for documentation generation.")
            }

            const out = await backendJson<GenerateDocsResponse>(
                `/api/projects/${projectId}/documentation/generate-local`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        branch,
                        local_repo_root: localContext.repo_root,
                        local_repo_file_paths: localContext.file_paths,
                        local_repo_context: localContext.context,
                    }),
                }
            )
            const generated = out.files || []
            const writeRes = await writeLocalDocumentationFiles(projectId, generated)
            const mode = out.mode || "generated"
            const count = writeRes.written.length
            const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
            setDocsNotice(
                `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for local repo branch ${out.branch || branch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
            )
        },
        [branch, browserLocalRepoMode, projectId]
    )

    const send = useCallback(async () => {
        const q = input.trim()
        if (!q || sending || !selectedChatId) return

        setSending(true)
        setError(null)
        setInput("")
        setMessages((prev) => [...prev, { role: "user", content: q, ts: new Date().toISOString() }])

        try {
            let effectiveQuestion = q
            const repoPath = (project?.repo_path || "").trim()
            let localRepoContext: string | undefined
            if (isBrowserLocalRepoPath(repoPath)) {
                if (!hasLocalRepoSnapshot(projectId)) {
                    await restoreLocalRepoSession(projectId)
                }
                if (!hasLocalRepoSnapshot(projectId)) {
                    throw new Error(
                        "This project uses a browser-local repository. Open Project Settings and pick the local repo folder on this device first."
                    )
                }
                localRepoContext = buildFrontendLocalRepoContext(projectId, q, branch) || undefined

                if (asksForDocumentationGeneration(q)) {
                    await maybeAutoGenerateDocsFromQuestion(q)
                    effectiveQuestion = `${q}\n\nNote: documentation has already been generated in the browser-local repository for this branch.`
                }
            }

            const res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                method: "POST",
                body: JSON.stringify({
                    project_id: projectId,
                    branch,
                    user: userId,
                    chat_id: selectedChatId,
                    top_k: 8,
                    question: effectiveQuestion,
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
    }, [branch, input, loadChats, loadMessages, maybeAutoGenerateDocsFromQuestion, project?.repo_path, projectId, selectedChatId, sending, userId])

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

    const loadDocumentationFile = useCallback(
        async (path: string) => {
            setDocContentLoading(true)
            setDocsError(null)
            try {
                if (browserLocalRepoMode) {
                    const content = readLocalDocumentationFile(projectId, path)
                    if (content == null) {
                        throw new Error(`Documentation file not found in local repo: ${path}`)
                    }
                    setSelectedDocPath(path)
                    setSelectedDocContent(content)
                } else {
                    const doc = await backendJson<DocumentationFileResponse>(
                        `/api/projects/${projectId}/documentation/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
                    )
                    setSelectedDocPath(doc.path || path)
                    setSelectedDocContent(doc.content || "")
                }
            } catch (err) {
                setDocsError(errText(err))
            } finally {
                setDocContentLoading(false)
            }
        },
        [branch, browserLocalRepoMode, projectId]
    )

    const loadDocumentationList = useCallback(
        async (preferredPath?: string | null) => {
            setDocsLoading(true)
            setDocsError(null)
            try {
                const files = browserLocalRepoMode
                    ? listLocalDocumentationFiles(projectId)
                    : (
                        (await backendJson<DocumentationListResponse>(
                            `/api/projects/${projectId}/documentation?branch=${encodeURIComponent(branch)}`
                        )).files || []
                    )
                        .filter((f) => !!f.path)
                        .sort((a, b) => a.path.localeCompare(b.path))
                setDocsFiles(files)
                const target = (preferredPath && files.find((f) => f.path === preferredPath)?.path) || files[0]?.path || null
                setSelectedDocPath(target)
                if (target) {
                    await loadDocumentationFile(target)
                } else {
                    setSelectedDocContent("")
                }
            } catch (err) {
                setDocsFiles([])
                setSelectedDocPath(null)
                setSelectedDocContent("")
                setDocsError(errText(err))
            } finally {
                setDocsLoading(false)
            }
        },
        [branch, browserLocalRepoMode, loadDocumentationFile, projectId]
    )

    const openDocumentationViewer = useCallback(() => {
        setDocsOpen(true)
        void loadDocumentationList(selectedDocPath)
    }, [loadDocumentationList, selectedDocPath])

    const generateDocumentation = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) {
            setDocsOpen(true)
            setError(null)
        }
        setDocsGenerating(true)
        setDocsError(null)
        setDocsNotice(null)
        try {
            if (browserLocalRepoMode) {
                if (!hasLocalRepoSnapshot(projectId)) {
                    await restoreLocalRepoSession(projectId)
                }
                if (!hasLocalRepoSnapshot(projectId)) {
                    throw new Error(
                        "Browser-local repository is not indexed in this session. Open Project Settings and pick the local repository folder first."
                    )
                }
                if (!hasLocalRepoWriteCapability(projectId)) {
                    await restoreLocalRepoSession(projectId)
                }
                if (!hasLocalRepoWriteCapability(projectId)) {
                    throw new Error(
                        "Local repository write access is not available. Re-pick the repository folder in Project Settings to grant write access."
                    )
                }
                const allowed = await ensureLocalRepoWritePermission(projectId)
                if (!allowed) {
                    throw new Error("Write permission to local repository folder was denied.")
                }

                const localContext = buildLocalRepoDocumentationContext(projectId, branch)
                if (!localContext) {
                    throw new Error("Could not build local repository context for documentation generation.")
                }

                const out = await backendJson<GenerateDocsResponse>(
                    `/api/projects/${projectId}/documentation/generate-local`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            branch,
                            local_repo_root: localContext.repo_root,
                            local_repo_file_paths: localContext.file_paths,
                            local_repo_context: localContext.context,
                        }),
                    }
                )

                const generated = out.files || []
                const writeRes = await writeLocalDocumentationFiles(projectId, generated)
                const mode = out.mode || "generated"
                const count = writeRes.written.length
                const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
                setDocsNotice(
                    `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for local repo branch ${out.branch || branch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
                )
            } else {
                const out = await backendJson<GenerateDocsResponse>(`/api/projects/${projectId}/documentation/generate`, {
                    method: "POST",
                    body: JSON.stringify({ branch }),
                })
                const mode = out.mode || "generated"
                const count = out.files_written?.length || 0
                const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
                setDocsNotice(
                    `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for branch ${out.branch || branch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
                )
            }

            await loadDocumentationList()
        } catch (err) {
            const msg = errText(err)
            setDocsError(msg)
            if (!opts?.silent) {
                setError(`Documentation generation failed: ${msg}`)
            }
        } finally {
            setDocsGenerating(false)
        }
    }, [branch, browserLocalRepoMode, loadDocumentationList, projectId])

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
                    <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<DescriptionRounded />}
                            onClick={openDocumentationViewer}
                        >
                            Open Docs
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<AutoFixHighRounded />}
                            onClick={() => void generateDocumentation()}
                            disabled={docsGenerating || booting}
                        >
                            {docsGenerating ? "Generating..." : "Generate Docs"}
                        </Button>
                    </Stack>
                </Paper>

                {error && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="error">{error}</Alert>
                    </Box>
                )}
                {docsNotice && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="success">{docsNotice}</Alert>
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

                <Dialog
                    open={docsOpen}
                    onClose={() => setDocsOpen(false)}
                    fullWidth
                    maxWidth="lg"
                >
                    <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                        <Stack spacing={0.2}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                Project Documentation
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Branch: {branch} · Source folder: <code>documentation/</code>
                            </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1}>
                            <Button
                                size="small"
                                variant="contained"
                                startIcon={<AutoFixHighRounded />}
                                onClick={() => void generateDocumentation()}
                                disabled={docsGenerating}
                            >
                                {docsGenerating ? "Generating..." : "Regenerate"}
                            </Button>
                            <Button
                                size="small"
                                variant="text"
                                startIcon={<CloseRounded />}
                                onClick={() => setDocsOpen(false)}
                            >
                                Close
                            </Button>
                        </Stack>
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 0 }}>
                        {(docsLoading || docContentLoading) && (
                            <Box sx={{ px: 2, py: 1 }}>
                                <CircularProgress size={18} />
                            </Box>
                        )}
                        {docsError && (
                            <Box sx={{ p: 1.5 }}>
                                <Alert severity="error">{docsError}</Alert>
                            </Box>
                        )}
                        {docsNotice && (
                            <Box sx={{ p: 1.5 }}>
                                <Alert severity="success">{docsNotice}</Alert>
                            </Box>
                        )}

                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px 1fr" }, minHeight: 500 }}>
                            <Box sx={{ borderRight: { md: "1px solid" }, borderColor: "divider", bgcolor: "background.default" }}>
                                <List dense sx={{ maxHeight: 560, overflowY: "auto" }}>
                                    {docsFiles.map((file) => (
                                        <ListItemButton
                                            key={file.path}
                                            selected={selectedDocPath === file.path}
                                            onClick={() => void loadDocumentationFile(file.path)}
                                        >
                                            <ListItemText
                                                primary={file.path.replace(/^documentation\//, "")}
                                                secondary={file.size ? `${Math.round(file.size / 1024)} KB` : undefined}
                                                primaryTypographyProps={{ noWrap: true }}
                                                secondaryTypographyProps={{ noWrap: true }}
                                            />
                                        </ListItemButton>
                                    ))}
                                    {!docsFiles.length && !docsLoading && (
                                        <ListItemButton disabled>
                                            <ListItemText primary="No documentation files found." />
                                        </ListItemButton>
                                    )}
                                </List>
                            </Box>

                            <Box sx={{ p: { xs: 1.5, md: 2.2 }, overflowY: "auto", maxHeight: 560 }}>
                                {selectedDocPath ? (
                                    <Stack spacing={1.4}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            {selectedDocPath}
                                        </Typography>
                                        <Divider />
                                        <Box
                                            sx={{
                                                "& h1, & h2, & h3": { mt: 2, mb: 1 },
                                                "& p, & li": { fontSize: "0.93rem" },
                                                "& code": {
                                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                    bgcolor: "action.hover",
                                                    px: 0.5,
                                                    borderRadius: 0.6,
                                                },
                                                "& pre code": {
                                                    display: "block",
                                                    p: 1.2,
                                                    overflowX: "auto",
                                                },
                                            }}
                                        >
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {selectedDocContent || "_No content._"}
                                            </ReactMarkdown>
                                        </Box>
                                    </Stack>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">
                                        Generate documentation or select a file to preview.
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    </DialogContent>
                </Dialog>
            </Stack>
        </ProjectDrawerLayout>
    )
}
