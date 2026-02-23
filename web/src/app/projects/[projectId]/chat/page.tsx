"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import DescriptionRounded from "@mui/icons-material/DescriptionRounded"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import CloseRounded from "@mui/icons-material/CloseRounded"
import FolderRounded from "@mui/icons-material/FolderRounded"
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import BuildRounded from "@mui/icons-material/BuildRounded"
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded"
import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded"
import VisibilityRounded from "@mui/icons-material/VisibilityRounded"
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
import { executeLocalToolJob } from "@/lib/local-custom-tool-runner"
import { ChatMessagesPane } from "@/features/chat/ChatMessagesPane"
import { ChatToolsDialog } from "@/features/chat/ChatToolsDialog"
import { DocumentationDialog } from "@/features/chat/DocumentationDialog"
import type {
    AskAgentResponse,
    BranchesResponse,
    ChatAnswerSource,
    ChatLlmProfileResponse,
    ChatMemorySummary,
    ChatMessage,
    ChatResponse,
    ChatToolApprovalsResponse,
    ChatToolPolicy,
    ChatToolPolicyResponse,
    DocTreeNode,
    DocumentationFileEntry,
    DocumentationFileResponse,
    DocumentationListResponse,
    GenerateDocsResponse,
    LlmProfileDoc,
    LocalToolClaimResponse,
    MeResponse,
    PendingUserQuestion,
    ProjectDoc,
    ToolCatalogItem,
    ToolCatalogResponse,
} from "@/features/chat/types"
import {
    asksForDocumentationGeneration,
    buildDocTree,
    dedupeChatsById,
    docAncestorFolders,
    enabledToolsFromPolicy,
    errText,
    isDocumentationPath,
    makeChatId,
} from "@/features/chat/utils"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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
    const [lastToolEvents, setLastToolEvents] = useState<AskAgentResponse["tool_events"]>([])
    const [toolEventsDismissed, setToolEventsDismissed] = useState(false)
    const [booting, setBooting] = useState(true)
    const [docsOpen, setDocsOpen] = useState(false)
    const [docsLoading, setDocsLoading] = useState(false)
    const [docsGenerating, setDocsGenerating] = useState(false)
    const [docsError, setDocsError] = useState<string | null>(null)
    const [docsNotice, setDocsNotice] = useState<string | null>(null)
    const [docsFiles, setDocsFiles] = useState<DocumentationFileEntry[]>([])
    const [expandedDocFolders, setExpandedDocFolders] = useState<string[]>([])
    const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null)
    const [selectedDocContent, setSelectedDocContent] = useState("")
    const [docContentLoading, setDocContentLoading] = useState(false)
    const [toolsOpen, setToolsOpen] = useState(false)
    const [toolsLoading, setToolsLoading] = useState(false)
    const [toolsSaving, setToolsSaving] = useState(false)
    const [toolsError, setToolsError] = useState<string | null>(null)
    const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([])
    const [chatToolPolicy, setChatToolPolicy] = useState<ChatToolPolicy | null>(null)
    const [toolEnabledSet, setToolEnabledSet] = useState<Set<string>>(new Set())
    const [toolReadOnlyOnly, setToolReadOnlyOnly] = useState(false)
    const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set())
    const [approvalBusyTool, setApprovalBusyTool] = useState<string | null>(null)
    const [llmProfiles, setLlmProfiles] = useState<LlmProfileDoc[]>([])
    const [selectedLlmProfileId, setSelectedLlmProfileId] = useState<string>("")
    const [savingLlmProfile, setSavingLlmProfile] = useState(false)
    const [expandedSourceMessages, setExpandedSourceMessages] = useState<Record<string, boolean>>({})
    const [chatMemory, setChatMemory] = useState<ChatMemorySummary | null>(null)
    const [sessionMemoryOpen, setSessionMemoryOpen] = useState(true)
    const [pendingUserQuestion, setPendingUserQuestion] = useState<PendingUserQuestion | null>(null)
    const [pendingAnswerInput, setPendingAnswerInput] = useState("")

    const scrollRef = useRef<HTMLDivElement | null>(null)
    const projectLabel = useMemo(() => project?.name || project?.key || projectId, [project, projectId])
    const userId = useMemo(() => me?.email || "dev@local", [me])
    const browserLocalRepoMode = useMemo(
        () => isBrowserLocalRepoPath((project?.repo_path || "").trim()),
        [project?.repo_path]
    )
    const docsTree = useMemo(() => buildDocTree(docsFiles), [docsFiles])
    const enabledToolCount = useMemo(() => toolEnabledSet.size, [toolEnabledSet])
    const selectedLlmProfile = useMemo(
        () => llmProfiles.find((p) => p.id === selectedLlmProfileId) || null,
        [llmProfiles, selectedLlmProfileId]
    )
    const memoryHasItems = useMemo(() => {
        const d = chatMemory?.decisions || []
        const q = chatMemory?.open_questions || []
        const n = chatMemory?.next_steps || []
        return d.length > 0 || q.length > 0 || n.length > 0
    }, [chatMemory])

    useEffect(() => {
        if (!error) return
        const timer = window.setTimeout(() => setError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [error])

    useEffect(() => {
        if (!docsNotice) return
        const timer = window.setTimeout(() => setDocsNotice(null), 7000)
        return () => window.clearTimeout(timer)
    }, [docsNotice])

    useEffect(() => {
        if (!docsError) return
        const timer = window.setTimeout(() => setDocsError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [docsError])

    useEffect(() => {
        if (!toolsError) return
        const timer = window.setTimeout(() => setToolsError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [toolsError])

    useEffect(() => {
        if (!lastToolEvents?.length) {
            setToolEventsDismissed(false)
            return
        }
        setToolEventsDismissed(false)
        const timer = window.setTimeout(() => setToolEventsDismissed(true), 12000)
        return () => window.clearTimeout(timer)
    }, [lastToolEvents])

    useEffect(() => {
        selectedChatIdRef.current = selectedChatId
    }, [selectedChatId])

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem("pqa.sessionMemory.open")
            if (raw === "0") {
                setSessionMemoryOpen(false)
            }
        } catch {
            // Ignore persistence issues and keep the default visible behavior.
        }
    }, [])

    useEffect(() => {
        try {
            window.localStorage.setItem("pqa.sessionMemory.open", sessionMemoryOpen ? "1" : "0")
        } catch {
            // Ignore persistence issues.
        }
    }, [sessionMemoryOpen])

    useEffect(() => {
        setPendingAnswerInput("")
    }, [pendingUserQuestion?.id])

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

    const toggleSourceList = useCallback((messageKey: string) => {
        setExpandedSourceMessages((prev) => ({ ...prev, [messageKey]: !prev[messageKey] }))
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
        setChatMemory((doc.memory_summary as ChatMemorySummary) || null)
        setPendingUserQuestion((doc.pending_user_question as PendingUserQuestion) || null)
    }, [])

    const loadChats = useCallback(
        async (activeBranch: string, preferredChatId?: string | null) => {
            setLoadingChats(true)
            try {
                const docs = await backendJson<DrawerChat[]>(
                    `/api/projects/${projectId}/chats?branch=${encodeURIComponent(activeBranch)}&limit=100&user=${encodeURIComponent(userId)}`
                )
                const uniqueDocs = dedupeChatsById(docs || [])

                const current = preferredChatId || selectedChatIdRef.current
                if (current && !uniqueDocs.some((c) => c.chat_id === current)) {
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
                        ...uniqueDocs.filter((c) => c.chat_id !== current),
                    ]
                    setChats(dedupeChatsById(merged))
                    setSelectedChatId(current)
                    return current
                }

                if (!uniqueDocs.length) {
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

                setChats(uniqueDocs)
                const next =
                    (current && uniqueDocs.some((c) => c.chat_id === current) && current) || uniqueDocs[0]?.chat_id || null
                setSelectedChatId(next)
                return next
            } finally {
                setLoadingChats(false)
            }
        },
        [ensureChat, projectId, projectLabel, userId]
    )

    const loadChatToolConfig = useCallback(
        async (chatId: string) => {
            setToolsLoading(true)
            setToolsError(null)
            try {
                const [catalogRes, policyRes, approvalsRes] = await Promise.all([
                    backendJson<ToolCatalogResponse>(`/api/tools/catalog?projectId=${encodeURIComponent(projectId)}`),
                    backendJson<ChatToolPolicyResponse>(`/api/chats/${encodeURIComponent(chatId)}/tool-policy`),
                    backendJson<ChatToolApprovalsResponse>(
                        `/api/chats/${encodeURIComponent(chatId)}/tool-approvals?user=${encodeURIComponent(userId)}`
                    ),
                ])
                const catalog = (catalogRes.tools || []).filter((t) => !!t.name)
                const policy = (policyRes.tool_policy || {}) as ChatToolPolicy
                const enabled = enabledToolsFromPolicy(catalog, policy)
                const approved = new Set(
                    (approvalsRes.items || [])
                        .map((row) => String(row.toolName || "").trim())
                        .filter(Boolean)
                )

                setToolCatalog(catalog)
                setChatToolPolicy(policy)
                setToolEnabledSet(enabled)
                setToolReadOnlyOnly(Boolean(policy.read_only_only))
                setApprovedTools(approved)
            } catch (err) {
                setToolsError(errText(err))
            } finally {
                setToolsLoading(false)
            }
        },
        [projectId, userId]
    )

    const loadLlmProfiles = useCallback(async () => {
        try {
            const rows = await backendJson<LlmProfileDoc[]>("/api/llm/profiles")
            setLlmProfiles((rows || []).filter((r) => r && r.id))
        } catch {
            setLlmProfiles([])
        }
    }, [])

    const loadChatLlmProfile = useCallback(async (chatId: string) => {
        try {
            const out = await backendJson<ChatLlmProfileResponse>(`/api/chats/${encodeURIComponent(chatId)}/llm-profile`)
            setSelectedLlmProfileId((out.llm_profile_id || "").trim())
        } catch {
            setSelectedLlmProfileId("")
        }
    }, [])

    useEffect(() => {
        let stopped = false
        let inFlight = false
        const claimId = `webchat-${projectId}-${Math.random().toString(36).slice(2, 10)}`

        async function tick() {
            if (stopped || inFlight) return
            inFlight = true
            try {
                const claim = await backendJson<LocalToolClaimResponse>("/api/local-tools/jobs/claim", {
                    method: "POST",
                    body: JSON.stringify({
                        projectId,
                        claimId,
                        user: userId,
                    }),
                })
                const job = claim.job
                if (!job?.id) return

                try {
                    const result = await executeLocalToolJob(job)
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/complete`, {
                        method: "POST",
                        body: JSON.stringify({ claimId, result, user: userId }),
                    })
                } catch (err) {
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/fail`, {
                        method: "POST",
                        body: JSON.stringify({ claimId, error: errText(err), user: userId }),
                    })
                }
            } catch {
                // Silent background worker: avoid noisy UI when no jobs are pending.
            } finally {
                inFlight = false
            }
        }

        const timer = window.setInterval(() => {
            void tick()
        }, 900)
        void tick()

        return () => {
            stopped = true
            window.clearInterval(timer)
        }
    }, [projectId, userId])

    const saveChatLlmProfile = useCallback(async (chatId: string, llmProfileId: string) => {
        setSavingLlmProfile(true)
        try {
            await backendJson<ChatLlmProfileResponse>(`/api/chats/${encodeURIComponent(chatId)}/llm-profile`, {
                method: "PUT",
                body: JSON.stringify({ llm_profile_id: llmProfileId || null }),
            })
            setDocsNotice(llmProfileId ? "Chat LLM profile updated." : "Chat LLM profile cleared.")
        } catch (err) {
            setError(errText(err))
        } finally {
            setSavingLlmProfile(false)
        }
    }, [])

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
                await loadLlmProfiles()
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
    }, [loadLlmProfiles, projectId])

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
        if (!selectedChatId) return
        void loadChatToolConfig(selectedChatId)
        void loadChatLlmProfile(selectedChatId)
    }, [loadChatLlmProfile, loadChatToolConfig, selectedChatId])

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

    const toggleToolEnabled = useCallback((toolName: string) => {
        setToolEnabledSet((prev) => {
            const next = new Set(prev)
            if (next.has(toolName)) next.delete(toolName)
            else next.add(toolName)
            return next
        })
    }, [])

    const openToolDialog = useCallback(async () => {
        setToolsOpen(true)
        if (selectedChatId) {
            await loadChatToolConfig(selectedChatId)
        }
    }, [loadChatToolConfig, selectedChatId])

    const saveChatToolPolicy = useCallback(async () => {
        if (!selectedChatId) return
        setToolsSaving(true)
        setToolsError(null)
        try {
            const allNames = toolCatalog.map((t) => t.name)
            const enabled = Array.from(toolEnabledSet).filter((name) => allNames.includes(name)).sort((a, b) => a.localeCompare(b))
            const blocked = allNames.filter((name) => !toolEnabledSet.has(name)).sort((a, b) => a.localeCompare(b))

            const body: ChatToolPolicy = {
                allowed_tools: enabled,
                blocked_tools: blocked,
                read_only_only: toolReadOnlyOnly,
            }
            const out = await backendJson<ChatToolPolicyResponse>(
                `/api/chats/${encodeURIComponent(selectedChatId)}/tool-policy`,
                {
                    method: "PUT",
                    body: JSON.stringify(body),
                }
            )
            setChatToolPolicy(out.tool_policy || body)
            setDocsNotice(`Tool configuration saved for chat ${selectedChatId}.`)
        } catch (err) {
            setToolsError(errText(err))
        } finally {
            setToolsSaving(false)
        }
    }, [selectedChatId, toolCatalog, toolEnabledSet, toolReadOnlyOnly])

    const setToolApproval = useCallback(
        async (toolName: string, approve: boolean) => {
            if (!selectedChatId) return
            setApprovalBusyTool(toolName)
            setToolsError(null)
            try {
                if (approve) {
                    await backendJson(`/api/chats/${encodeURIComponent(selectedChatId)}/tool-approvals`, {
                        method: "POST",
                        body: JSON.stringify({
                            tool_name: toolName,
                            ttl_minutes: 60,
                            user: userId,
                        }),
                    })
                    setApprovedTools((prev) => {
                        const next = new Set(prev)
                        next.add(toolName)
                        return next
                    })
                } else {
                    await backendJson(
                        `/api/chats/${encodeURIComponent(selectedChatId)}/tool-approvals/${encodeURIComponent(toolName)}?user=${encodeURIComponent(userId)}`,
                        {
                            method: "DELETE",
                        }
                    )
                    setApprovedTools((prev) => {
                        const next = new Set(prev)
                        next.delete(toolName)
                        return next
                    })
                }
            } catch (err) {
                setToolsError(errText(err))
            } finally {
                setApprovalBusyTool(null)
            }
        },
        [selectedChatId, userId]
    )

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

    const send = useCallback(
        async (opts?: { question?: string; pendingAnswer?: string; pendingQuestionId?: string; clearComposer?: boolean }) => {
            const q = String(opts?.question ?? input).trim()
            const activePending = pendingUserQuestion
            const pendingAnswer = String(opts?.pendingAnswer ?? (activePending ? q : "")).trim()
            const optimisticUserText = pendingAnswer || q
            if (!optimisticUserText || sending || !selectedChatId) return

            setSending(true)
            setError(null)
            setLastToolEvents([])
            if (opts?.clearComposer !== false) {
                setInput("")
            }
            setMessages((prev) => [...prev, { role: "user", content: optimisticUserText, ts: new Date().toISOString() }])

            try {
                let effectiveQuestion = q || pendingAnswer
                const repoPath = (project?.repo_path || "").trim()
                let localRepoContext: string | undefined
                if (!activePending && isBrowserLocalRepoPath(repoPath)) {
                    if (!hasLocalRepoSnapshot(projectId)) {
                        await restoreLocalRepoSession(projectId)
                    }
                    if (!hasLocalRepoSnapshot(projectId)) {
                        throw new Error(
                            "This project uses a browser-local repository. Open Project Settings and pick the local repo folder on this device first."
                        )
                    }
                    localRepoContext = buildFrontendLocalRepoContext(projectId, effectiveQuestion, branch) || undefined

                    if (asksForDocumentationGeneration(effectiveQuestion)) {
                        await maybeAutoGenerateDocsFromQuestion(effectiveQuestion)
                        effectiveQuestion = `${effectiveQuestion}\n\nNote: documentation has already been generated in the browser-local repository for this branch.`
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
                        llm_profile_id: selectedLlmProfileId || null,
                        pending_question_id: activePending ? opts?.pendingQuestionId || activePending.id : null,
                        pending_answer: activePending ? pendingAnswer : null,
                    }),
                })

                if (res.answer?.trim()) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            role: "assistant",
                            content: res.answer || "",
                            ts: new Date().toISOString(),
                            meta: { sources: res.sources || [], grounded: res.grounded ?? undefined },
                        },
                    ])
                }
                setLastToolEvents(res.tool_events || [])
                setChatMemory((res.memory_summary as ChatMemorySummary) || null)
                setPendingUserQuestion((res.pending_user_question as PendingUserQuestion) || null)
                if (activePending) {
                    setPendingAnswerInput("")
                }

                await loadMessages(selectedChatId)
                await loadChats(branch, selectedChatId)
            } catch (err) {
                setError(errText(err))
            } finally {
                setSending(false)
            }
        },
        [
            branch,
            input,
            loadChats,
            loadMessages,
            maybeAutoGenerateDocsFromQuestion,
            pendingUserQuestion,
            project?.repo_path,
            projectId,
            selectedChatId,
            selectedLlmProfileId,
            sending,
            userId,
        ]
    )

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
            const ancestors = docAncestorFolders(path)
            if (ancestors.length) {
                setExpandedDocFolders((prev) => {
                    const next = new Set(prev)
                    for (const folder of ancestors) next.add(folder)
                    return Array.from(next)
                })
            }
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

    const toggleDocFolder = useCallback((folderPath: string) => {
        setExpandedDocFolders((prev) => {
            const next = new Set(prev)
            if (next.has(folderPath)) {
                next.delete(folderPath)
            } else {
                next.add(folderPath)
            }
            return Array.from(next)
        })
    }, [])

    const renderDocTreeNodes = useCallback(
        (nodes: DocTreeNode[], depth = 0) =>
            nodes.map((node) => {
                if (node.kind === "folder") {
                    const isOpen = expandedDocFolders.includes(node.path)
                    return (
                        <Fragment key={node.path}>
                            <ListItemButton
                                onClick={() => toggleDocFolder(node.path)}
                                sx={{ pl: 1 + depth * 1.6 }}
                            >
                                {isOpen ? (
                                    <ExpandMoreRounded fontSize="small" color="action" />
                                ) : (
                                    <ChevronRightRounded fontSize="small" color="action" />
                                )}
                                <FolderRounded fontSize="small" color="action" sx={{ ml: 0.35, mr: 0.8 }} />
                                <ListItemText
                                    primary={node.name}
                                    primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
                                />
                            </ListItemButton>
                            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                                <List dense disablePadding>
                                    {renderDocTreeNodes(node.children || [], depth + 1)}
                                </List>
                            </Collapse>
                        </Fragment>
                    )
                }

                const file = node.file
                if (!file) return null
                const selected = selectedDocPath === file.path
                return (
                    <ListItemButton
                        key={file.path}
                        selected={selected}
                        onClick={() => void loadDocumentationFile(file.path)}
                        sx={{ pl: 3.4 + depth * 1.6 }}
                    >
                        <DescriptionOutlined fontSize="small" color={selected ? "primary" : "action"} sx={{ mr: 0.9 }} />
                        <ListItemText
                            primary={node.name}
                            secondary={file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : undefined}
                            primaryTypographyProps={{ noWrap: true }}
                            secondaryTypographyProps={{ noWrap: true }}
                        />
                    </ListItemButton>
                )
            }),
        [expandedDocFolders, loadDocumentationFile, selectedDocPath, toggleDocFolder]
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
                setExpandedDocFolders((prev) => {
                    const next = new Set(prev)
                    if (!next.size) {
                        for (const f of files) {
                            const ancestors = docAncestorFolders(f.path)
                            if (ancestors[0]) next.add(ancestors[0])
                        }
                    }
                    if (target) {
                        for (const ancestor of docAncestorFolders(target)) next.add(ancestor)
                    }
                    return Array.from(next)
                })
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

    const handleAnswerSourceClick = useCallback(
        async (src: ChatAnswerSource) => {
            const rawUrl = String(src.url || "").trim()
            if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
                window.open(rawUrl, "_blank", "noopener,noreferrer")
                return
            }

            const path = String(src.path || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "")
            if (isDocumentationPath(path)) {
                setDocsOpen(true)
                await loadDocumentationList(path)
            }
        },
        [loadDocumentationList]
    )

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
                        Branch: {branch} ·{" "}
                        {selectedLlmProfile
                            ? `${selectedLlmProfile.name} (${selectedLlmProfile.provider.toUpperCase()} · ${selectedLlmProfile.model})`
                            : `${(project?.llm_provider || "default LLM").toUpperCase()}${project?.llm_model ? ` · ${project.llm_model}` : ""}`}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
                        <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 360 } }}>
                            <InputLabel id="chat-llm-profile-label">Chat LLM Profile</InputLabel>
                            <Select
                                labelId="chat-llm-profile-label"
                                label="Chat LLM Profile"
                                value={selectedLlmProfileId}
                                onChange={(e) => {
                                    const next = e.target.value
                                    setSelectedLlmProfileId(next)
                                    if (selectedChatId) {
                                        void saveChatLlmProfile(selectedChatId, next)
                                    }
                                }}
                                disabled={savingLlmProfile || !selectedChatId}
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
                    <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<BuildRounded />}
                            onClick={() => void openToolDialog()}
                            disabled={!selectedChatId}
                        >
                            Tools ({enabledToolCount})
                        </Button>
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
                        {memoryHasItems && (
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={sessionMemoryOpen ? <VisibilityOffRounded /> : <VisibilityRounded />}
                                onClick={() => setSessionMemoryOpen((v) => !v)}
                            >
                                {sessionMemoryOpen ? "Hide Memory" : "Show Memory"}
                            </Button>
                        )}
                    </Stack>
                </Paper>

                {error && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    </Box>
                )}
                {!!lastToolEvents?.length && !toolEventsDismissed && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Paper variant="outlined" sx={{ p: 1.2 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                    TOOL EXECUTION
                                </Typography>
                                <IconButton size="small" onClick={() => setToolEventsDismissed(true)}>
                                    <CloseRounded fontSize="small" />
                                </IconButton>
                            </Stack>
                            <Stack spacing={0.45} sx={{ mt: 0.8 }}>
                                {lastToolEvents.map((ev, idx) => (
                                    <Typography key={`${ev.tool}-${idx}`} variant="body2" color={ev.ok ? "success.main" : "warning.main"}>
                                        {ev.ok ? "OK" : "ERR"} · {ev.tool} · {ev.duration_ms} ms
                                        {ev.cached ? " · cached" : ""}
                                        {ev.attempts && ev.attempts > 1 ? ` · attempts:${ev.attempts}` : ""}
                                        {ev.error?.code ? ` · ${ev.error.code}` : ""}
                                        {ev.error?.message ? ` · ${ev.error.message}` : ""}
                                    </Typography>
                                ))}
                            </Stack>
                        </Paper>
                    </Box>
                )}
                {docsNotice && !docsOpen && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="success" onClose={() => setDocsNotice(null)}>
                            {docsNotice}
                        </Alert>
                    </Box>
                )}
                {memoryHasItems && sessionMemoryOpen && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Paper variant="outlined" sx={{ p: { xs: 1.2, md: 1.5 }, maxWidth: 980, mx: "auto" }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="overline" color="primary" sx={{ letterSpacing: "0.12em" }}>
                                    Session Memory
                                </Typography>
                                <IconButton size="small" onClick={() => setSessionMemoryOpen(false)}>
                                    <CloseRounded fontSize="small" />
                                </IconButton>
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
                )}

                <ChatMessagesPane
                    booting={booting}
                    loadingMessages={loadingMessages}
                    sending={sending}
                    messages={messages}
                    expandedSourceMessages={expandedSourceMessages}
                    onToggleSourceList={toggleSourceList}
                    onSourceClick={handleAnswerSourceClick}
                    scrollRef={scrollRef}
                />

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
                        {pendingUserQuestion && (
                            <Paper variant="outlined" sx={{ p: 1.2, bgcolor: "background.default" }}>
                                <Stack spacing={1}>
                                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                        ASSISTANT NEEDS INPUT
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {pendingUserQuestion.question}
                                    </Typography>
                                    {pendingUserQuestion.answer_mode === "single_choice" ? (
                                        <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                                            {(pendingUserQuestion.options || []).map((option, idx) => (
                                                <Button
                                                    key={`${option}-${idx}`}
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() =>
                                                        void send({
                                                            question: option,
                                                            pendingAnswer: option,
                                                            pendingQuestionId: pendingUserQuestion.id,
                                                            clearComposer: false,
                                                        })
                                                    }
                                                    disabled={sending || !selectedChatId}
                                                >
                                                    {option}
                                                </Button>
                                            ))}
                                        </Stack>
                                    ) : (
                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                            <TextField
                                                size="small"
                                                value={pendingAnswerInput}
                                                onChange={(e) => setPendingAnswerInput(e.target.value)}
                                                placeholder="Type your answer for the assistant"
                                                fullWidth
                                                disabled={sending || !selectedChatId}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && !e.shiftKey) {
                                                        e.preventDefault()
                                                        void send({
                                                            question: pendingAnswerInput,
                                                            pendingAnswer: pendingAnswerInput,
                                                            pendingQuestionId: pendingUserQuestion.id,
                                                            clearComposer: false,
                                                        })
                                                    }
                                                }}
                                            />
                                            <Button
                                                variant="contained"
                                                onClick={() =>
                                                    void send({
                                                        question: pendingAnswerInput,
                                                        pendingAnswer: pendingAnswerInput,
                                                        pendingQuestionId: pendingUserQuestion.id,
                                                        clearComposer: false,
                                                    })
                                                }
                                                disabled={sending || !pendingAnswerInput.trim() || !selectedChatId}
                                            >
                                                Submit Answer
                                            </Button>
                                        </Stack>
                                    )}
                                </Stack>
                            </Paper>
                        )}

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
                            placeholder={
                                pendingUserQuestion
                                    ? "Reply to the pending assistant question (Enter to send)"
                                    : "Ask a project question (Enter to send, Shift+Enter for newline)"
                            }
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

                <ChatToolsDialog
                    open={toolsOpen}
                    chatId={selectedChatId}
                    toolsLoading={toolsLoading}
                    toolsError={toolsError}
                    toolsSaving={toolsSaving}
                    toolReadOnlyOnly={toolReadOnlyOnly}
                    toolCatalog={toolCatalog}
                    toolEnabledSet={toolEnabledSet}
                    approvedTools={approvedTools}
                    approvalBusyTool={approvalBusyTool}
                    onClose={() => setToolsOpen(false)}
                    onErrorClose={() => setToolsError(null)}
                    onToggleReadOnlyOnly={setToolReadOnlyOnly}
                    onToggleToolEnabled={toggleToolEnabled}
                    onSetToolApproval={setToolApproval}
                    onSave={saveChatToolPolicy}
                />

                <DocumentationDialog
                    open={docsOpen}
                    branch={branch}
                    docsGenerating={docsGenerating}
                    docsLoading={docsLoading}
                    docContentLoading={docContentLoading}
                    docsError={docsError}
                    docsNotice={docsNotice}
                    docsFilesCount={docsFiles.length}
                    selectedDocPath={selectedDocPath}
                    selectedDocContent={selectedDocContent}
                    docTreeNodes={renderDocTreeNodes(docsTree)}
                    onClose={() => setDocsOpen(false)}
                    onRegenerate={() => generateDocumentation()}
                    onDocsErrorClose={() => setDocsError(null)}
                    onDocsNoticeClose={() => setDocsNotice(null)}
                />
            </Stack>
        </ProjectDrawerLayout>
    )
}
