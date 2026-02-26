"use client"

export const dynamic = "force-dynamic"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import dynamicImport from "next/dynamic"
import {
    Alert,
    Badge,
    Box,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    FormControl,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Tooltip,
    Typography,
    Button,
} from "@mui/material"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import BuildRounded from "@mui/icons-material/BuildRounded"
import FolderRounded from "@mui/icons-material/FolderRounded"
import FilterAltRounded from "@mui/icons-material/FilterAltRounded"
import NotificationsRounded from "@mui/icons-material/NotificationsRounded"
import SettingsRounded from "@mui/icons-material/SettingsRounded"
import AdminPanelSettingsRounded from "@mui/icons-material/AdminPanelSettingsRounded"
import DescriptionRounded from "@mui/icons-material/DescriptionRounded"
import AssignmentTurnedInRounded from "@mui/icons-material/AssignmentTurnedInRounded"
import CodeRounded from "@mui/icons-material/CodeRounded"
import AutoModeRounded from "@mui/icons-material/AutoModeRounded"
import PushPinRounded from "@mui/icons-material/PushPinRounded"
import PushPinOutlined from "@mui/icons-material/PushPinOutlined"
import LinkIcon from "@mui/icons-material/Link"
import FolderRoundedIcon from "@mui/icons-material/FolderRounded"
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import { backendJson } from "@/lib/backend"
import { requestOpenGlobalNotifications } from "@/features/notifications/events"
import { ChatComposer } from "@/features/chat/ChatComposer"
import type {
    AskAgentResponse,
    BranchesResponse,
    ChatTaskItem,
    ChatTasksResponse,
    ChatToolApprovalsResponse,
    ChatToolPolicy,
    ChatToolPolicyResponse,
    DocTreeNode,
    DocumentationFileEntry,
    DocumentationFileResponse,
    DocumentationListResponse,
    GenerateDocsResponse,
    GlobalChatBootstrapResponse,
    GlobalChatContext,
    GlobalChatMessage,
    GlobalChatMessagesResponse,
    LlmProfileDoc,
    MeResponse,
    PendingUserQuestion,
    ProjectDoc,
    ToolCatalogItem,
    ToolCatalogResponse,
} from "@/features/chat/types"
import {
    buildDocTree,
    docAncestorFolders,
    enabledToolsFromPolicy,
    isDocumentationPath,
    sourceDisplayText,
    splitChartBlocks,
} from "@/features/chat/utils"
import {
    buildLocalRepoDocumentationContext,
    ensureLocalRepoWritePermission,
    hasLocalRepoSnapshot,
    hasLocalRepoWriteCapability,
    isBrowserLocalRepoPath,
    listLocalDocumentationFiles,
    readLocalDocumentationFile,
    restoreLocalRepoSession,
    writeLocalDocumentationFiles,
} from "@/lib/local-repo-bridge"
import { WorkspaceDockLayout } from "@/features/workspace/WorkspaceDockLayout"
import { useLocalToolJobWorker } from "@/features/local-tools/useLocalToolJobWorker"

const LazyMarkdown = dynamicImport(
    () => import("@/features/chat/ChatMarkdownContent").then((m) => m.ChatMarkdownContent),
    { ssr: false }
)

const LazyChart = dynamicImport(
    () => import("@/features/chat/ChatChartBlock").then((m) => m.ChatChartBlock),
    { ssr: false }
)

const ChatToolsDialog = dynamicImport(
    () => import("@/features/chat/ChatToolsDialog").then((m) => m.ChatToolsDialog),
    { ssr: false }
)
const ChatTasksDialog = dynamicImport(
    () => import("@/features/chat/ChatTasksDialog").then((m) => m.ChatTasksDialog),
    { ssr: false }
)
const DocumentationDialog = dynamicImport(
    () => import("@/features/chat/DocumentationDialog").then((m) => m.DocumentationDialog),
    { ssr: false }
)
const WorkspaceShell = dynamicImport(
    () => import("@/features/workspace/WorkspaceShell").then((m) => m.WorkspaceShell),
    { ssr: false }
)

function keyOf(projectId: string, branch: string): string {
    return `${projectId}::${branch || "main"}`
}

function parseErr(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err || "Unknown error")
}

function equalStringArrays(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

function equalDraftPreviews(
    a: Array<{ path: string; preview: string }>,
    b: Array<{ path: string; preview: string }>
): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i]?.path !== b[i]?.path) return false
        if (a[i]?.preview !== b[i]?.preview) return false
    }
    return true
}

function isUrl(value: string): boolean {
    return /^https?:\/\//i.test(value.trim())
}

function FloatingIsland({
    position,
    children,
}: {
    position: { top?: number; right?: number; bottom?: number; left?: number }
    children: React.ReactNode
}) {
    return (
        <Paper
            variant="outlined"
            sx={{
                position: "fixed",
                zIndex: 15,
                ...position,
                borderRadius: 99,
                px: 0.5,
                py: 0.4,
                backdropFilter: "blur(14px)",
                backgroundColor: "rgba(255,255,255,0.75)",
                borderColor: "rgba(15,23,42,0.12)",
                boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
            }}
        >
            <Stack direction="row" spacing={0.25}>
                {children}
            </Stack>
        </Paper>
    )
}

export default function GlobalChatPage() {
    const router = useRouter()
    const scrollRef = useRef<HTMLDivElement | null>(null)

    const [booting, setBooting] = useState(true)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [userId, setUserId] = useState("dev@local")
    const [isAdmin, setIsAdmin] = useState(false)
    const [chatId, setChatId] = useState<string | null>(null)
    const [messages, setMessages] = useState<GlobalChatMessage[]>([])
    const [contexts, setContexts] = useState<GlobalChatContext[]>([])
    const [projects, setProjects] = useState<ProjectDoc[]>([])
    const [branches, setBranches] = useState<string[]>(["main"])
    const [selectedProjectId, setSelectedProjectId] = useState("")
    const [selectedBranch, setSelectedBranch] = useState("main")
    const [contextConfirmed, setContextConfirmed] = useState(false)
    const [activeOnly, setActiveOnly] = useState(false)
    const [contextDialogOpen, setContextDialogOpen] = useState(false)
    const [unreadNotifications, setUnreadNotifications] = useState(0)
    const [llmProfiles, setLlmProfiles] = useState<LlmProfileDoc[]>([])
    const [selectedLlmProfileId, setSelectedLlmProfileId] = useState("")
    const [input, setInput] = useState("")
    const [pendingUserQuestion, setPendingUserQuestion] = useState<PendingUserQuestion | null>(null)
    const [pendingAnswerInput, setPendingAnswerInput] = useState("")
    const [toolsOpen, setToolsOpen] = useState(false)
    const [toolsLoading, setToolsLoading] = useState(false)
    const [toolsSaving, setToolsSaving] = useState(false)
    const [toolsError, setToolsError] = useState<string | null>(null)
    const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([])
    const [chatToolPolicy, setChatToolPolicy] = useState<ChatToolPolicy | null>(null)
    const [toolEnabledSet, setToolEnabledSet] = useState<Set<string>>(new Set())
    const [toolReadOnlyOnly, setToolReadOnlyOnly] = useState(false)
    const [toolDryRun, setToolDryRun] = useState(false)
    const [requireApprovalForWriteTools, setRequireApprovalForWriteTools] = useState(false)
    const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set())
    const [approvalBusyTool, setApprovalBusyTool] = useState<string | null>(null)
    const [tasksOpen, setTasksOpen] = useState(false)
    const [tasksLoading, setTasksLoading] = useState(false)
    const [tasksSaving, setTasksSaving] = useState(false)
    const [tasksError, setTasksError] = useState<string | null>(null)
    const [tasks, setTasks] = useState<ChatTaskItem[]>([])
    const [docsOpen, setDocsOpen] = useState(false)
    const [docsLoading, setDocsLoading] = useState(false)
    const [docsGenerating, setDocsGenerating] = useState(false)
    const [docContentLoading, setDocContentLoading] = useState(false)
    const [docsError, setDocsError] = useState<string | null>(null)
    const [docsNotice, setDocsNotice] = useState<string | null>(null)
    const [docsFiles, setDocsFiles] = useState<DocumentationFileEntry[]>([])
    const [expandedDocFolders, setExpandedDocFolders] = useState<string[]>([])
    const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null)
    const [selectedDocContent, setSelectedDocContent] = useState("")
    const [workspaceOpen, setWorkspaceOpen] = useState(false)
    const [workspaceDockWidth, setWorkspaceDockWidth] = useState(620)
    const [workspaceRequestedPath, setWorkspaceRequestedPath] = useState<string | null>(null)
    const [workspaceRequestedAction, setWorkspaceRequestedAction] = useState<"suggest" | "apply-last" | null>(null)
    const [workspaceRequestedPatchContent, setWorkspaceRequestedPatchContent] = useState<string | null>(null)
    const [workspaceRequestedPatchFallbackPath, setWorkspaceRequestedPatchFallbackPath] = useState<string | null>(null)
    const [workspaceRequestedPatchAutoApply, setWorkspaceRequestedPatchAutoApply] = useState(false)
    const [workspaceOpenTabs, setWorkspaceOpenTabs] = useState<string[]>([])
    const [workspaceDirtyPaths, setWorkspaceDirtyPaths] = useState<string[]>([])
    const [workspaceActivePath, setWorkspaceActivePath] = useState<string | null>(null)
    const [workspaceActivePreview, setWorkspaceActivePreview] = useState<string | null>(null)
    const [workspaceDraftPreviews, setWorkspaceDraftPreviews] = useState<Array<{ path: string; preview: string }>>([])
    const [workspaceCursor, setWorkspaceCursor] = useState<{ line: number; column: number } | null>(null)

    const activeContextKey = useMemo(() => {
        if (!selectedProjectId) return ""
        return keyOf(selectedProjectId, selectedBranch || "main")
    }, [selectedBranch, selectedProjectId])

    const refreshMessages = useCallback(
        async (opts?: { mode?: "mixed" | "active"; projectId?: string; branch?: string }) => {
            if (!chatId) return
            const mode = opts?.mode || "mixed"
            const projectId = opts?.projectId || selectedProjectId
            const branch = opts?.branch || selectedBranch || "main"
            const contextKey = projectId ? keyOf(projectId, branch) : ""
            if (!contextKey) return
            setLoadingMessages(true)
            try {
                const params = new URLSearchParams({
                    chat_id: chatId,
                    mode,
                    project_id: projectId,
                    branch,
                    limit: "240",
                })
                const res = await backendJson<GlobalChatMessagesResponse>(`/api/chat/global/messages?${params.toString()}`)
                setMessages(Array.isArray(res.items) ? res.items : [])
            } catch (e) {
                setError(parseErr(e))
            } finally {
                setLoadingMessages(false)
            }
        },
        [chatId, selectedBranch, selectedProjectId]
    )

    const refreshContextConfig = useCallback(async () => {
        if (!chatId || !activeContextKey) return
        try {
            const params = new URLSearchParams({
                chat_id: chatId,
                context_key: activeContextKey,
                user: userId,
            })
            const out = await backendJson<{ config?: { llm_profile_id?: string | null } }>(
                `/api/chat/global/context-config?${params.toString()}`
            )
            setSelectedLlmProfileId(String(out?.config?.llm_profile_id || ""))
        } catch {
            setSelectedLlmProfileId("")
        }
    }, [activeContextKey, chatId, userId])

    const refreshBootstrap = useCallback(
        async (opts?: { projectId?: string; branch?: string }) => {
            const pid = opts?.projectId || selectedProjectId
            const br = opts?.branch || selectedBranch || "main"
            if (!pid) return
            const params = new URLSearchParams({
                user: userId,
                project_id: pid,
                branch: br,
            })
            const boot = await backendJson<GlobalChatBootstrapResponse>(`/api/chat/global/bootstrap?${params.toString()}`)
            setChatId(String(boot.chat_id || ""))
            setContexts(Array.isArray(boot.contexts) ? boot.contexts : [])
            setUnreadNotifications(Math.max(0, Number(boot.unread_notifications || 0)))
        },
        [selectedBranch, selectedProjectId, userId]
    )

    const selectContext = useCallback(
        async (projectId: string, branch: string) => {
            if (!chatId) return
            const body = {
                chat_id: chatId,
                project_id: projectId,
                branch,
                user: userId,
            }
            await backendJson<{ active_context_key: string }>("/api/chat/global/context/select", {
                method: "POST",
                body: JSON.stringify(body),
            })
            setSelectedProjectId(projectId)
            setSelectedBranch(branch)
            router.replace(`/chat?project_id=${encodeURIComponent(projectId)}&branch=${encodeURIComponent(branch)}`)
            await Promise.all([
                refreshBootstrap({ projectId, branch }),
                refreshMessages({ mode: activeOnly ? "active" : "mixed", projectId, branch }),
            ])
            await refreshContextConfig()
            setContextConfirmed(true)
        },
        [activeOnly, chatId, refreshBootstrap, refreshContextConfig, refreshMessages, router, userId]
    )

    useEffect(() => {
        let cancelled = false
        async function init() {
            setBooting(true)
            setError(null)
            try {
                const params = new URLSearchParams(window.location.search)
                const initialProject = params.get("project_id")
                const initialBranch = params.get("branch")
                const [me, projectsRes, profilesRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<{ items?: ProjectDoc[]; projects?: ProjectDoc[] }>("/api/projects"),
                    backendJson<{ items?: LlmProfileDoc[]; profiles?: LlmProfileDoc[] }>("/api/llm/profiles"),
                ])
                const user = String(me?.user?.email || me?.user?.id || "dev@local").trim().toLowerCase()
                const admin = Boolean(me?.user?.isGlobalAdmin)
                const list = (projectsRes.items || projectsRes.projects || []).filter(Boolean)
                const selectedProject = initialProject || list[0]?._id || ""
                const selectedBr = initialBranch || list.find((p) => p._id === selectedProject)?.default_branch || "main"
                if (cancelled) return
                setUserId(user)
                setIsAdmin(admin)
                setProjects(list)
                setSelectedProjectId(selectedProject)
                setSelectedBranch(selectedBr)
                setContextConfirmed(Boolean(initialProject))
                setLlmProfiles((profilesRes.items || profilesRes.profiles || []).filter(Boolean))
                if (selectedProject) {
                    const branchesRes = await backendJson<BranchesResponse>(
                        `/api/projects/${encodeURIComponent(selectedProject)}/branches`
                    )
                    if (cancelled) return
                    setBranches(Array.isArray(branchesRes.branches) && branchesRes.branches.length > 0 ? branchesRes.branches : ["main"])
                    const params = new URLSearchParams({
                        user,
                        project_id: selectedProject,
                        branch: selectedBr,
                    })
                    const boot = await backendJson<GlobalChatBootstrapResponse>(`/api/chat/global/bootstrap?${params.toString()}`)
                    if (cancelled) return
                    setChatId(String(boot.chat_id || ""))
                    setContexts(Array.isArray(boot.contexts) ? boot.contexts : [])
                    setUnreadNotifications(Math.max(0, Number(boot.unread_notifications || 0)))
                }
            } catch (e) {
                if (!cancelled) setError(parseErr(e))
            } finally {
                if (!cancelled) setBooting(false)
            }
        }
        void init()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (!chatId || !selectedProjectId) return
        void refreshMessages({ mode: activeOnly ? "active" : "mixed" })
        void refreshContextConfig()
    }, [activeOnly, chatId, refreshContextConfig, refreshMessages, selectedProjectId])

    useEffect(() => {
        if (!selectedProjectId) return
        let cancelled = false
        async function loadBranches() {
            try {
                const res = await backendJson<BranchesResponse>(`/api/projects/${encodeURIComponent(selectedProjectId)}/branches`)
                if (cancelled) return
                const next = Array.isArray(res.branches) && res.branches.length > 0 ? res.branches : ["main"]
                setBranches(next)
                if (!next.includes(selectedBranch)) {
                    setSelectedBranch(next[0] || "main")
                }
            } catch {
                if (!cancelled) setBranches(["main"])
            }
        }
        void loadBranches()
        return () => {
            cancelled = true
        }
    }, [selectedBranch, selectedProjectId])

    useEffect(() => {
        if (!scrollRef.current) return
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }, [messages.length])

    const sendQuestion = useCallback(
        async (question: string, pendingQuestionId?: string) => {
            const trimmed = question.trim()
            if (!trimmed || !chatId || !selectedProjectId || !selectedBranch) return
            setSending(true)
            setError(null)
            const nowIso = new Date().toISOString()
            const optimisticUser: GlobalChatMessage = {
                role: "user",
                content: trimmed,
                ts: nowIso,
                context_key: activeContextKey,
                project_id: selectedProjectId,
                branch: selectedBranch,
                is_active_context: true,
                compact_hint: false,
            }
            setMessages((prev) => [...prev, optimisticUser])
            setInput("")
            try {
                const res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                    method: "POST",
                    body: JSON.stringify({
                        project_id: selectedProjectId,
                        branch: selectedBranch,
                        user: userId,
                        chat_id: chatId,
                        context_key: activeContextKey,
                        include_pinned_memory: true,
                        history_mode: "active_plus_pinned",
                        question: trimmed,
                        pending_question_id: pendingQuestionId || null,
                        workspace_context: workspaceOpen
                            ? {
                                  active_path: workspaceActivePath,
                                  open_tabs: workspaceOpenTabs,
                                  dirty_paths: workspaceDirtyPaths,
                                  active_preview: workspaceActivePreview,
                                  draft_previews: workspaceDraftPreviews,
                                  cursor: workspaceCursor,
                              }
                            : undefined,
                    }),
                })
                const assistant: GlobalChatMessage = {
                    role: "assistant",
                    content: String(res.answer || ""),
                    ts: new Date().toISOString(),
                    context_key: activeContextKey,
                    project_id: selectedProjectId,
                    branch: selectedBranch,
                    is_active_context: true,
                    compact_hint: false,
                    meta: {
                        sources: res.sources || [],
                        grounded: res.grounded,
                    },
                }
                setMessages((prev) => [...prev, assistant])
                setPendingUserQuestion(res.pending_user_question || null)
                await refreshBootstrap()
                if (!activeOnly) {
                    await refreshMessages({ mode: "mixed" })
                }
            } catch (e) {
                setError(parseErr(e))
            } finally {
                setSending(false)
            }
        },
        [
            activeContextKey,
            activeOnly,
            chatId,
            refreshBootstrap,
            refreshMessages,
            selectedBranch,
            selectedProjectId,
            userId,
            workspaceActivePath,
            workspaceActivePreview,
            workspaceCursor,
            workspaceDirtyPaths,
            workspaceDraftPreviews,
            workspaceOpen,
            workspaceOpenTabs,
        ]
    )

    const submitPendingAnswer = useCallback(
        async (answer: string, pendingQuestionId: string) => {
            const trimmed = answer.trim()
            if (!trimmed || !chatId || !selectedProjectId) return
            await sendQuestion(trimmed, pendingQuestionId)
            setPendingAnswerInput("")
        },
        [chatId, selectedProjectId, sendQuestion]
    )

    const visibleMessages = useMemo(() => {
        if (!activeOnly) return messages
        return messages.filter((m) => (m.context_key || "") === activeContextKey)
    }, [activeContextKey, activeOnly, messages])

    const onPinToggle = useCallback(
        async (message: GlobalChatMessage) => {
            if (!chatId || !message.id) return
            try {
                await backendJson(`/api/chat/global/pins/${encodeURIComponent(message.id)}?chat_id=${encodeURIComponent(chatId)}`, {
                    method: "POST",
                    body: JSON.stringify({ pin: !message.is_pinned }),
                })
                setMessages((prev) =>
                    prev.map((row) => (row.id === message.id ? { ...row, is_pinned: !row.is_pinned } : row))
                )
            } catch (e) {
                setError(parseErr(e))
            }
        },
        [chatId]
    )

    const projectNameById = useMemo(() => {
        const out = new Map<string, string>()
        for (const p of projects) {
            out.set(String(p._id), String(p.name || p.key || p._id))
        }
        return out
    }, [projects])

    const selectedProjectLabel = projectNameById.get(selectedProjectId) || selectedProjectId || "Select project"
    const selectedProject = useMemo(
        () => projects.find((p) => String(p._id) === String(selectedProjectId)) || null,
        [projects, selectedProjectId]
    )
    const browserLocalRepoMode = useMemo(
        () => isBrowserLocalRepoPath(String(selectedProject?.repo_path || "")),
        [selectedProject?.repo_path]
    )
    const docTree = useMemo(() => buildDocTree(docsFiles), [docsFiles])

    const handleWorkspaceRequestHandled = useCallback(() => {
        setWorkspaceRequestedPath(null)
        setWorkspaceRequestedAction(null)
        setWorkspaceRequestedPatchContent(null)
        setWorkspaceRequestedPatchFallbackPath(null)
        setWorkspaceRequestedPatchAutoApply(false)
    }, [])

    const handleWorkspaceContextChange = useCallback(
        (state: {
            activePath: string | null
            openTabs: string[]
            dirtyPaths: string[]
            activePreview: string | null
            draftPreviews: Array<{ path: string; preview: string }>
            cursor: { line: number; column: number } | null
        }) => {
            setWorkspaceActivePath((prev) => (prev === state.activePath ? prev : state.activePath))
            setWorkspaceOpenTabs((prev) => (equalStringArrays(prev, state.openTabs) ? prev : state.openTabs))
            setWorkspaceDirtyPaths((prev) => (equalStringArrays(prev, state.dirtyPaths) ? prev : state.dirtyPaths))
            setWorkspaceActivePreview((prev) => (prev === (state.activePreview || null) ? prev : (state.activePreview || null)))
            setWorkspaceDraftPreviews((prev) => (equalDraftPreviews(prev, state.draftPreviews) ? prev : state.draftPreviews))
            setWorkspaceCursor((prev) =>
                prev?.line === state.cursor?.line && prev?.column === state.cursor?.column ? prev : state.cursor
            )
        },
        []
    )

    useLocalToolJobWorker({
        claimIdPrefix: `global-chat-${selectedProjectId || "none"}`,
        buildClaimPayload: () => ({
            projectId: selectedProjectId,
            user: userId,
        }),
    })

    const loadChatToolConfig = useCallback(async () => {
        if (!chatId || !selectedProjectId) return
        setToolsLoading(true)
        setToolsError(null)
        try {
            const [catalogRes, policyRes, approvalsRes] = await Promise.all([
                backendJson<ToolCatalogResponse>(
                    `/api/tools/catalog/availability?project_id=${encodeURIComponent(selectedProjectId)}&branch=${encodeURIComponent(selectedBranch || "main")}&chat_id=${encodeURIComponent(chatId)}&user=${encodeURIComponent(userId)}`
                ),
                backendJson<ChatToolPolicyResponse>(
                    `/api/chats/${encodeURIComponent(chatId)}/tool-policy?context_key=${encodeURIComponent(activeContextKey)}&project_id=${encodeURIComponent(selectedProjectId)}&branch=${encodeURIComponent(selectedBranch || "main")}`
                ),
                backendJson<ChatToolApprovalsResponse>(
                    `/api/chats/${encodeURIComponent(chatId)}/tool-approvals?user=${encodeURIComponent(userId)}&context_key=${encodeURIComponent(activeContextKey)}&project_id=${encodeURIComponent(selectedProjectId)}&branch=${encodeURIComponent(selectedBranch || "main")}`
                ),
            ])
            const catalog = (catalogRes.tools || []).filter((tool) => !!tool.name)
            const policy = (policyRes.tool_policy || {}) as ChatToolPolicy
            const enabled = enabledToolsFromPolicy(catalog, policy)
            const approved = new Set((approvalsRes.items || []).map((row) => String(row.toolName || "").trim()).filter(Boolean))
            setToolCatalog(catalog)
            setChatToolPolicy(policy)
            setToolEnabledSet(enabled)
            setToolReadOnlyOnly(Boolean(policy.read_only_only))
            setToolDryRun(Boolean(policy.dry_run))
            setRequireApprovalForWriteTools(Boolean(policy.require_approval_for_write_tools))
            setApprovedTools(approved)
        } catch (err) {
            setToolsError(parseErr(err))
        } finally {
            setToolsLoading(false)
        }
    }, [activeContextKey, chatId, selectedBranch, selectedProjectId, userId])

    const saveChatToolPolicy = useCallback(async () => {
        if (!chatId || !selectedProjectId) return
        setToolsSaving(true)
        setToolsError(null)
        try {
            const enabledNames = Array.from(toolEnabledSet).sort()
            const allNames = toolCatalog.map((tool) => tool.name)
            const blockedNames = allNames.filter((name) => !toolEnabledSet.has(name)).sort()
            await backendJson<ChatToolPolicyResponse>(`/api/chats/${encodeURIComponent(chatId)}/tool-policy`, {
                method: "PUT",
                body: JSON.stringify({
                    context_key: activeContextKey,
                    project_id: selectedProjectId,
                    branch: selectedBranch || "main",
                    strict_allowlist: true,
                    allowed_tools: enabledNames,
                    blocked_tools: blockedNames,
                    read_only_only: toolReadOnlyOnly,
                    dry_run: toolDryRun,
                    require_approval_for_write_tools: requireApprovalForWriteTools,
                }),
            })
            await loadChatToolConfig()
            setToolsOpen(false)
        } catch (err) {
            setToolsError(parseErr(err))
        } finally {
            setToolsSaving(false)
        }
    }, [
        activeContextKey,
        chatId,
        loadChatToolConfig,
        requireApprovalForWriteTools,
        selectedBranch,
        selectedProjectId,
        toolCatalog,
        toolDryRun,
        toolEnabledSet,
        toolReadOnlyOnly,
    ])

    const setToolApproval = useCallback(
        async (toolName: string, approve: boolean) => {
            if (!chatId || !selectedProjectId) return
            const target = String(toolName || "").trim()
            if (!target) return
            setApprovalBusyTool(target)
            setToolsError(null)
            try {
                if (approve) {
                    await backendJson(`/api/chats/${encodeURIComponent(chatId)}/tool-approvals`, {
                        method: "POST",
                        body: JSON.stringify({
                            user: userId,
                            tool_name: target,
                            ttl_minutes: 60,
                            context_key: activeContextKey,
                            project_id: selectedProjectId,
                            branch: selectedBranch || "main",
                        }),
                    })
                } else {
                    await backendJson(
                        `/api/chats/${encodeURIComponent(chatId)}/tool-approvals/${encodeURIComponent(target)}?user=${encodeURIComponent(userId)}&context_key=${encodeURIComponent(activeContextKey)}&project_id=${encodeURIComponent(selectedProjectId)}&branch=${encodeURIComponent(selectedBranch || "main")}`,
                        {
                            method: "DELETE",
                        }
                    )
                }
                await loadChatToolConfig()
            } catch (err) {
                setToolsError(parseErr(err))
            } finally {
                setApprovalBusyTool(null)
            }
        },
        [activeContextKey, chatId, loadChatToolConfig, selectedBranch, selectedProjectId, userId]
    )

    const loadTasks = useCallback(async () => {
        if (!chatId || !selectedProjectId) return
        setTasksLoading(true)
        setTasksError(null)
        try {
            const out = await backendJson<ChatTasksResponse>(
                `/api/chats/${encodeURIComponent(chatId)}/tasks?user=${encodeURIComponent(userId)}&context_key=${encodeURIComponent(activeContextKey)}&project_id=${encodeURIComponent(selectedProjectId)}&branch=${encodeURIComponent(selectedBranch || "main")}`
            )
            setTasks((out.items || []).filter((item) => item && item.id))
        } catch (err) {
            setTasksError(parseErr(err))
        } finally {
            setTasksLoading(false)
        }
    }, [activeContextKey, chatId, selectedBranch, selectedProjectId, userId])

    const createTask = useCallback(
        async (inputTask: { title: string; details: string; assignee: string; due_date: string }) => {
            if (!chatId || !selectedProjectId) return
            setTasksSaving(true)
            setTasksError(null)
            try {
                await backendJson(`/api/chats/${encodeURIComponent(chatId)}/tasks?user=${encodeURIComponent(userId)}`, {
                    method: "POST",
                    body: JSON.stringify({
                        title: inputTask.title,
                        details: inputTask.details,
                        assignee: inputTask.assignee || null,
                        due_date: inputTask.due_date || null,
                        context_key: activeContextKey,
                        project_id: selectedProjectId,
                        branch: selectedBranch || "main",
                    }),
                })
                await loadTasks()
            } catch (err) {
                setTasksError(parseErr(err))
            } finally {
                setTasksSaving(false)
            }
        },
        [activeContextKey, chatId, loadTasks, selectedBranch, selectedProjectId, userId]
    )

    const updateTask = useCallback(
        async (
            taskId: string,
            patch: { title?: string; details?: string; assignee?: string | null; due_date?: string | null; status?: string }
        ) => {
            if (!chatId || !selectedProjectId) return
            setTasksSaving(true)
            setTasksError(null)
            try {
                await backendJson(
                    `/api/chats/${encodeURIComponent(chatId)}/tasks/${encodeURIComponent(taskId)}?user=${encodeURIComponent(userId)}`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            ...patch,
                            context_key: activeContextKey,
                            project_id: selectedProjectId,
                            branch: selectedBranch || "main",
                        }),
                    }
                )
                await loadTasks()
            } catch (err) {
                setTasksError(parseErr(err))
            } finally {
                setTasksSaving(false)
            }
        },
        [activeContextKey, chatId, loadTasks, selectedBranch, selectedProjectId, userId]
    )

    const loadDocumentationFile = useCallback(
        async (path: string) => {
            if (!selectedProjectId) return
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
                    const content = readLocalDocumentationFile(selectedProjectId, path)
                    if (content == null) {
                        throw new Error(`Documentation file not found in local repo: ${path}`)
                    }
                    setSelectedDocPath(path)
                    setSelectedDocContent(content)
                } else {
                    const doc = await backendJson<DocumentationFileResponse>(
                        `/api/projects/${encodeURIComponent(selectedProjectId)}/documentation/file?branch=${encodeURIComponent(selectedBranch || "main")}&path=${encodeURIComponent(path)}`
                    )
                    setSelectedDocPath(doc.path || path)
                    setSelectedDocContent(doc.content || "")
                }
            } catch (err) {
                setDocsError(parseErr(err))
            } finally {
                setDocContentLoading(false)
            }
        },
        [browserLocalRepoMode, selectedBranch, selectedProjectId]
    )

    const loadDocumentationList = useCallback(
        async (preferredPath?: string | null) => {
            if (!selectedProjectId) return
            setDocsLoading(true)
            setDocsError(null)
            try {
                const files = browserLocalRepoMode
                    ? listLocalDocumentationFiles(selectedProjectId)
                    : (
                          (await backendJson<DocumentationListResponse>(
                              `/api/projects/${encodeURIComponent(selectedProjectId)}/documentation?branch=${encodeURIComponent(selectedBranch || "main")}`
                          )).files || []
                      )
                          .filter((file) => !!file.path)
                          .sort((a, b) => a.path.localeCompare(b.path))
                setDocsFiles(files)
                const target = (preferredPath && files.find((file) => file.path === preferredPath)?.path) || files[0]?.path || null
                setSelectedDocPath(target)
                setExpandedDocFolders((prev) => {
                    const next = new Set(prev)
                    if (!next.size) {
                        for (const file of files) {
                            const ancestors = docAncestorFolders(file.path)
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
                setDocsError(parseErr(err))
            } finally {
                setDocsLoading(false)
            }
        },
        [browserLocalRepoMode, loadDocumentationFile, selectedBranch, selectedProjectId]
    )

    const generateDocumentation = useCallback(async () => {
        if (!selectedProjectId) return
        setDocsGenerating(true)
        setDocsError(null)
        setDocsNotice(null)
        try {
            if (browserLocalRepoMode) {
                if (!hasLocalRepoSnapshot(selectedProjectId)) {
                    await restoreLocalRepoSession(selectedProjectId)
                }
                if (!hasLocalRepoSnapshot(selectedProjectId)) {
                    throw new Error("Browser-local repository is not indexed in this session.")
                }
                if (!hasLocalRepoWriteCapability(selectedProjectId)) {
                    await restoreLocalRepoSession(selectedProjectId)
                }
                if (!hasLocalRepoWriteCapability(selectedProjectId)) {
                    throw new Error("Local repository write access is not available.")
                }
                const allowed = await ensureLocalRepoWritePermission(selectedProjectId)
                if (!allowed) {
                    throw new Error("Write permission to local repository folder was denied.")
                }
                const localContext = buildLocalRepoDocumentationContext(selectedProjectId, selectedBranch || "main")
                if (!localContext) {
                    throw new Error("Could not build local repository context for documentation generation.")
                }
                const out = await backendJson<GenerateDocsResponse>(
                    `/api/projects/${encodeURIComponent(selectedProjectId)}/documentation/generate-local`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            branch: selectedBranch || "main",
                            local_repo_root: localContext.repo_root,
                            local_repo_file_paths: localContext.file_paths,
                            local_repo_context: localContext.context,
                        }),
                    }
                )
                const generated = out.files || []
                const writeRes = await writeLocalDocumentationFiles(selectedProjectId, generated)
                const mode = out.mode || "generated"
                const count = writeRes.written.length
                const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
                setDocsNotice(
                    `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for local repo branch ${out.branch || selectedBranch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
                )
            } else {
                const out = await backendJson<GenerateDocsResponse>(
                    `/api/projects/${encodeURIComponent(selectedProjectId)}/documentation/generate`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            branch: selectedBranch || "main",
                        }),
                    }
                )
                const mode = out.mode || "generated"
                const count = out.files_written?.length || 0
                const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
                setDocsNotice(
                    `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for branch ${out.branch || selectedBranch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
                )
            }
            await loadDocumentationList()
        } catch (err) {
            setDocsError(parseErr(err))
        } finally {
            setDocsGenerating(false)
        }
    }, [browserLocalRepoMode, loadDocumentationList, selectedBranch, selectedProjectId])

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

    const openInWorkspaceFromMessage = useCallback((fallbackPath?: string | null) => {
        const path = String(fallbackPath || "").trim().replace(/^\.?\//, "")
        if (path) {
            setWorkspaceRequestedPath(path)
            setWorkspaceRequestedAction(null)
        }
        setWorkspaceOpen(true)
    }, [])

    const reviewMessagePatch = useCallback((_messageKey: string, message: string, fallbackPath?: string | null) => {
        const raw = String(message || "").trim()
        if (!raw) return
        setWorkspaceRequestedPatchContent(raw)
        setWorkspaceRequestedPatchFallbackPath(String(fallbackPath || "").trim() || null)
        setWorkspaceRequestedPatchAutoApply(false)
        setWorkspaceOpen(true)
    }, [])

    const applyMessagePatchFromBubble = useCallback((_messageKey: string, message: string, fallbackPath?: string | null) => {
        const raw = String(message || "").trim()
        if (!raw) return
        setWorkspaceRequestedPatchContent(raw)
        setWorkspaceRequestedPatchFallbackPath(String(fallbackPath || "").trim() || null)
        setWorkspaceRequestedPatchAutoApply(true)
        setWorkspaceOpen(true)
    }, [])

    const handleAnswerSourceClick = useCallback(
        async (src: { url?: string; source?: string; path?: string }) => {
            const rawUrl = String(src.url || src.source || "").trim()
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

    const renderDocTreeNodes = useCallback(
        (nodes: DocTreeNode[], depth = 0): React.ReactNode =>
            nodes.map((node) => {
                if (node.kind === "folder") {
                    const isOpen = expandedDocFolders.includes(node.path)
                    return (
                        <Fragment key={node.path}>
                            <ListItemButton onClick={() => toggleDocFolder(node.path)} sx={{ pl: 1 + depth * 1.6 }}>
                                {isOpen ? (
                                    <ExpandMoreRounded fontSize="small" color="action" />
                                ) : (
                                    <ChevronRightRounded fontSize="small" color="action" />
                                )}
                                <FolderRoundedIcon fontSize="small" color="action" sx={{ ml: 0.35, mr: 0.8 }} />
                                <ListItemText primary={node.name} primaryTypographyProps={{ noWrap: true, fontWeight: 600 }} />
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

    return (
        <Box sx={{ minHeight: "100vh", px: { xs: 1.2, md: 2.4 }, py: { xs: 1, md: 1.5 } }}>
            <FloatingIsland position={{ top: 12, left: 14 }}>
                <Tooltip title="Context (project/branch/LLM)" enterTouchDelay={0}>
                    <IconButton size="small" onClick={() => setContextDialogOpen(true)}>
                        <FolderRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title={activeOnly ? "Show all contexts" : "Show active context only"} enterTouchDelay={0}>
                    <IconButton size="small" color={activeOnly ? "primary" : "default"} onClick={() => setActiveOnly((v) => !v)}>
                        <FilterAltRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
            </FloatingIsland>

            <FloatingIsland position={{ top: 12, right: 14 }}>
                <Tooltip title="Tools">
                    <IconButton
                        size="small"
                        onClick={async () => {
                            if (!chatId || !selectedProjectId) return
                            setToolsOpen(true)
                            await loadChatToolConfig()
                        }}
                    >
                        <BuildRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Tasks">
                    <IconButton
                        size="small"
                        onClick={async () => {
                            if (!chatId || !selectedProjectId) return
                            setTasksOpen(true)
                            await loadTasks()
                        }}
                    >
                        <AssignmentTurnedInRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Docs">
                    <IconButton
                        size="small"
                        onClick={async () => {
                            if (!selectedProjectId) return
                            setDocsOpen(true)
                            await loadDocumentationList(selectedDocPath)
                        }}
                    >
                        <DescriptionRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Workspace">
                    <IconButton size="small" onClick={() => setWorkspaceOpen(true)}>
                        <CodeRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
            </FloatingIsland>

            <FloatingIsland position={{ bottom: 16, right: 14 }}>
                <Tooltip title="Notifications">
                    <IconButton size="small" onClick={requestOpenGlobalNotifications}>
                        <Badge color="error" badgeContent={unreadNotifications > 99 ? "99+" : unreadNotifications} invisible={unreadNotifications <= 0}>
                            <NotificationsRounded fontSize="small" />
                        </Badge>
                    </IconButton>
                </Tooltip>
                <Tooltip title="Automations">
                    <IconButton
                        size="small"
                        onClick={() =>
                            selectedProjectId && router.push(`/projects/${encodeURIComponent(selectedProjectId)}/automations`)
                        }
                    >
                        <AutoModeRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Project settings">
                    <IconButton
                        size="small"
                        onClick={() =>
                            selectedProjectId && router.push(`/projects/${encodeURIComponent(selectedProjectId)}/settings`)
                        }
                    >
                        <SettingsRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                {isAdmin && (
                    <Tooltip title="Admin">
                        <IconButton size="small" onClick={() => router.push("/admin")}>
                            <AdminPanelSettingsRounded fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
            </FloatingIsland>

            <Dialog open={contextDialogOpen} onClose={() => setContextDialogOpen(false)} fullWidth maxWidth="sm">
                <DialogContent>
                    <Stack spacing={1.2} sx={{ pt: 0.5 }}>
                        <Typography variant="subtitle2">Active Context</Typography>
                        <FormControl size="small" fullWidth>
                            <InputLabel id="ctx-project-label">Project</InputLabel>
                            <Select
                                labelId="ctx-project-label"
                                label="Project"
                                value={selectedProjectId}
                                onChange={(e) => {
                                    setSelectedProjectId(String(e.target.value || ""))
                                    setContextConfirmed(false)
                                }}
                            >
                                {projects.map((p) => (
                                    <MenuItem key={p._id} value={p._id}>
                                        {p.name || p.key || p._id}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl size="small" fullWidth>
                            <InputLabel id="ctx-branch-label">Branch</InputLabel>
                            <Select
                                labelId="ctx-branch-label"
                                label="Branch"
                                value={selectedBranch}
                                onChange={(e) => {
                                    setSelectedBranch(String(e.target.value || "main"))
                                    setContextConfirmed(false)
                                }}
                            >
                                {branches.map((b) => (
                                    <MenuItem key={b} value={b}>
                                        {b}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl size="small" fullWidth>
                            <InputLabel id="ctx-llm-label">LLM profile</InputLabel>
                            <Select
                                labelId="ctx-llm-label"
                                label="LLM profile"
                                value={selectedLlmProfileId}
                                onChange={(e) => setSelectedLlmProfileId(String(e.target.value || ""))}
                            >
                                <MenuItem value="">Project default</MenuItem>
                                {llmProfiles.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.name} · {p.provider.toUpperCase()} · {p.model}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch checked={activeOnly} onChange={(_, v) => setActiveOnly(v)} />
                            <Typography variant="body2">Show active context only</Typography>
                        </Stack>
                        {contexts.length > 0 && (
                            <Stack spacing={0.5}>
                                <Typography variant="caption" color="text.secondary">
                                    Recent contexts
                                </Typography>
                                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                                    {contexts.slice(0, 14).map((ctx) => (
                                        <Chip
                                            key={ctx.context_key}
                                            size="small"
                                            label={`${projectNameById.get(String(ctx.project_id || "")) || ctx.project_id} · ${ctx.branch || "main"}`}
                                            onClick={() => {
                                                const pid = String(ctx.project_id || "").trim()
                                                const br = String(ctx.branch || "main").trim()
                                                if (!pid) return
                                                void selectContext(pid, br)
                                                setContextDialogOpen(false)
                                            }}
                                        />
                                    ))}
                                </Stack>
                            </Stack>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setContextDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        startIcon={<AutoFixHighRounded />}
                        disabled={!selectedProjectId}
                        onClick={async () => {
                            try {
                                if (!chatId) return
                                await backendJson("/api/chat/global/context-config", {
                                    method: "PUT",
                                    body: JSON.stringify({
                                        chat_id: chatId,
                                        user: userId,
                                        project_id: selectedProjectId,
                                        branch: selectedBranch,
                                        llm_profile_id: selectedLlmProfileId || null,
                                    }),
                                })
                                await selectContext(selectedProjectId, selectedBranch || "main")
                                setContextDialogOpen(false)
                            } catch (e) {
                                setError(parseErr(e))
                            }
                        }}
                    >
                        Apply Context
                    </Button>
                </DialogActions>
            </Dialog>

            <WorkspaceDockLayout
                open={workspaceOpen}
                width={workspaceDockWidth}
                onWidthChange={setWorkspaceDockWidth}
                left={
                    <Paper
                        variant="outlined"
                        sx={{
                            mx: "auto",
                            mt: { xs: 5.3, md: 5.8 },
                            maxWidth: "100%",
                            minHeight: "calc(100vh - 88px)",
                            display: "flex",
                            flexDirection: "column",
                            borderRadius: 2.6,
                            backgroundColor: "rgba(255,255,255,0.72)",
                            backdropFilter: "blur(14px)",
                            borderColor: "rgba(15,23,42,0.12)",
                            overflow: "hidden",
                        }}
                    >
                        <Box sx={{ px: { xs: 1.1, md: 1.4 }, py: 0.8, borderBottom: "1px solid", borderColor: "divider" }}>
                            <Stack direction="row" spacing={0.8} alignItems="center" useFlexGap flexWrap="wrap">
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    Global Chat
                                </Typography>
                                <Chip size="small" label={selectedProjectLabel} />
                                <Chip size="small" variant="outlined" label={selectedBranch || "main"} />
                                {activeOnly && <Chip size="small" color="primary" label="Active-only" />}
                                {!contextConfirmed && (
                                    <Chip size="small" color="warning" label="Select context before sending" />
                                )}
                            </Stack>
                        </Box>

                        {error && (
                            <Alert severity="error" onClose={() => setError(null)} sx={{ m: 1.1 }}>
                                {error}
                            </Alert>
                        )}

                        <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 0.8, md: 1.5 }, py: 1.1 }}>
                            <Stack spacing={0.85} sx={{ maxWidth: 960, mx: "auto" }}>
                                {booting && (
                                    <Typography variant="body2" color="text.secondary">
                                        Loading global conversation...
                                    </Typography>
                                )}
                                {!booting && !loadingMessages && visibleMessages.length === 0 && (
                                    <Typography variant="body2" color="text.secondary">
                                        Select a context and ask a question to start.
                                    </Typography>
                                )}
                                {visibleMessages.map((message, idx) => {
                            const isUser = message.role === "user"
                            const messageContextKey = String(message.context_key || "")
                            const isActive = messageContextKey === activeContextKey
                            const compact = !isActive
                            const contextProject = String(message.project_id || "")
                            const contextBranch = String(message.branch || "main")
                            const contextLabel = `${projectNameById.get(contextProject) || contextProject || "Unknown"} · ${contextBranch}`
                            const sources = message.role === "assistant" ? (message.meta?.sources || []) : []
                            return (
                                <Box
                                    key={`${message.id || idx}-${message.ts || idx}`}
                                    sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}
                                >
                                    <Paper
                                        variant="outlined"
                                        onClick={() => {
                                            if (!compact || !contextProject) return
                                            void selectContext(contextProject, contextBranch)
                                        }}
                                        sx={{
                                            maxWidth: { xs: "98%", sm: "94%" },
                                            px: compact ? 1.0 : 1.35,
                                            py: compact ? 0.52 : 0.86,
                                            borderRadius: 1.8,
                                            borderColor: compact
                                                ? "rgba(148,163,184,0.35)"
                                                : isUser
                                                ? "rgba(34,197,94,0.28)"
                                                : "rgba(15,23,42,0.13)",
                                            bgcolor: compact
                                                ? "rgba(255,255,255,0.42)"
                                                : isUser
                                                ? "rgba(34,197,94,0.12)"
                                                : "rgba(255,255,255,0.68)",
                                            opacity: compact ? 0.78 : 1,
                                            maxHeight: compact ? 66 : "none",
                                            overflow: "hidden",
                                            cursor: compact ? "pointer" : "default",
                                            transition: "all 140ms ease",
                                        }}
                                    >
                                        <Stack spacing={0.45}>
                                            <Stack direction="row" spacing={0.45} alignItems="center" useFlexGap flexWrap="wrap">
                                                <Chip size="small" label={contextLabel} variant={isActive ? "filled" : "outlined"} />
                                                {!isActive && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        Inactive context
                                                    </Typography>
                                                )}
                                                <Box sx={{ ml: "auto", display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                                                    {message.id && (
                                                        <Tooltip title={message.is_pinned ? "Unpin" : "Pin as global memory"}>
                                                            <IconButton size="small" onClick={() => void onPinToggle(message)}>
                                                                {message.is_pinned ? (
                                                                    <PushPinRounded fontSize="inherit" />
                                                                ) : (
                                                                    <PushPinOutlined fontSize="inherit" />
                                                                )}
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                            </Stack>

                                            {compact ? (
                                                <Typography variant="body2" color="text.secondary" noWrap>
                                                    {String(message.content || "").replace(/\s+/g, " ").trim() || "(empty)"}
                                                </Typography>
                                            ) : (
                                                splitChartBlocks(message.content || "").map((part, partIdx) =>
                                                    part.type === "chart" ? (
                                                        <LazyChart key={`${idx}-chart-${partIdx}`} value={part.value} />
                                                    ) : (
                                                        <LazyMarkdown key={`${idx}-md-${partIdx}`} value={part.value} isUser={isUser} />
                                                    )
                                                )
                                            )}

                                            {!compact && !isUser && sources.length > 0 && (
                                                <Stack spacing={0.25}>
                                                    <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            onClick={() =>
                                                                openInWorkspaceFromMessage(
                                                                    sources.find((src) => Boolean(String(src.path || "").trim()))?.path || null
                                                                )
                                                            }
                                                        >
                                                            Open in Workspace
                                                        </Button>
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            onClick={() =>
                                                                reviewMessagePatch(
                                                                    `${message.id || idx}`,
                                                                    message.content || "",
                                                                    sources.find((src) => Boolean(String(src.path || "").trim()))?.path || null
                                                                )
                                                            }
                                                        >
                                                            Review Patch
                                                        </Button>
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            onClick={() =>
                                                                applyMessagePatchFromBubble(
                                                                    `${message.id || idx}`,
                                                                    message.content || "",
                                                                    sources.find((src) => Boolean(String(src.path || "").trim()))?.path || null
                                                                )
                                                            }
                                                        >
                                                            Apply Selected
                                                        </Button>
                                                    </Stack>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Sources
                                                    </Typography>
                                                    <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap">
                                                        {sources.slice(0, 8).map((src, srcIdx) => {
                                                            const label = sourceDisplayText(src)
                                                            const url = String(src.url || src.source || "")
                                                            return (
                                                                <Chip
                                                                    key={`${label}-${srcIdx}`}
                                                                    size="small"
                                                                    icon={<LinkIcon sx={{ fontSize: 13 }} />}
                                                                    label={label}
                                                                    clickable={Boolean(url || src.path)}
                                                                    onClick={() => void handleAnswerSourceClick(src)}
                                                                />
                                                            )
                                                        })}
                                                    </Stack>
                                                </Stack>
                                            )}
                                        </Stack>
                                    </Paper>
                                </Box>
                            )
                                })}
                            </Stack>
                        </Box>

                        <ChatComposer
                            pendingUserQuestion={pendingUserQuestion}
                            pendingAnswerInput={pendingAnswerInput}
                            input={input}
                            sending={sending}
                            hasSelectedChat={Boolean(chatId && selectedProjectId && contextConfirmed)}
                            onInputChange={setInput}
                            onPendingAnswerInputChange={setPendingAnswerInput}
                            onSend={(override) => void sendQuestion(String(override ?? input))}
                            onClear={() => setInput("")}
                            onSubmitPendingAnswer={(answer, questionId) => void submitPendingAnswer(answer, questionId)}
                        />
                    </Paper>
                }
                right={
                    <WorkspaceShell
                        open={workspaceOpen}
                        docked
                        projectId={selectedProjectId}
                        projectLabel={selectedProjectLabel}
                        branch={selectedBranch || "main"}
                        chatId={chatId}
                        userId={userId}
                        requestOpenPath={workspaceRequestedPath}
                        requestAction={workspaceRequestedAction}
                        requestPatchContent={workspaceRequestedPatchContent}
                        requestPatchFallbackPath={workspaceRequestedPatchFallbackPath}
                        requestPatchAutoApply={workspaceRequestedPatchAutoApply}
                        onRequestHandled={handleWorkspaceRequestHandled}
                        onContextChange={handleWorkspaceContextChange}
                        onClose={() => setWorkspaceOpen(false)}
                    />
                }
            />

            <ChatToolsDialog
                open={toolsOpen}
                chatId={chatId}
                toolsLoading={toolsLoading}
                toolsError={toolsError}
                toolsSaving={toolsSaving}
                toolReadOnlyOnly={toolReadOnlyOnly}
                toolDryRun={toolDryRun}
                requireApprovalForWriteTools={requireApprovalForWriteTools}
                toolCatalog={toolCatalog}
                toolEnabledSet={toolEnabledSet}
                approvedTools={approvedTools}
                approvalBusyTool={approvalBusyTool}
                onClose={() => setToolsOpen(false)}
                onErrorClose={() => setToolsError(null)}
                onToggleReadOnlyOnly={setToolReadOnlyOnly}
                onToggleDryRun={setToolDryRun}
                onToggleRequireApprovalForWriteTools={setRequireApprovalForWriteTools}
                onToggleToolEnabled={(toolName) =>
                    setToolEnabledSet((prev) => {
                        const next = new Set(prev)
                        if (next.has(toolName)) {
                            next.delete(toolName)
                        } else {
                            next.add(toolName)
                        }
                        return next
                    })
                }
                onSetToolApproval={setToolApproval}
                onSave={saveChatToolPolicy}
            />

            <ChatTasksDialog
                open={tasksOpen}
                loading={tasksLoading}
                saving={tasksSaving}
                error={tasksError}
                tasks={tasks}
                onClose={() => setTasksOpen(false)}
                onRefresh={loadTasks}
                onCreate={createTask}
                onUpdateTask={updateTask}
            />

            <DocumentationDialog
                open={docsOpen}
                branch={selectedBranch || "main"}
                docsGenerating={docsGenerating}
                docsLoading={docsLoading}
                docContentLoading={docContentLoading}
                docsError={docsError}
                docsNotice={docsNotice}
                docsFilesCount={docsFiles.length}
                selectedDocPath={selectedDocPath}
                selectedDocContent={selectedDocContent}
                docTreeNodes={renderDocTreeNodes(docTree)}
                onClose={() => setDocsOpen(false)}
                onRegenerate={generateDocumentation}
                onDocsErrorClose={() => setDocsError(null)}
                onDocsNoticeClose={() => setDocsNotice(null)}
            />
        </Box>
    )
}
