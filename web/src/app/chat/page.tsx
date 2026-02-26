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
import DragIndicatorRounded from "@mui/icons-material/DragIndicatorRounded"
import AccountTreeRounded from "@mui/icons-material/AccountTreeRounded"
import { backendJson } from "@/lib/backend"
import { requestOpenGlobalNotifications } from "@/features/notifications/events"
import { ChatComposer } from "@/features/chat/ChatComposer"
import type {
    AskAgentResponse,
    BranchesResponse,
    ChatCodeArtifact,
    ChatCodeArtifactsExtractResponse,
    ChatCodeArtifactsPromoteResponse,
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
    AskAgentStreamEvent,
    GlobalChatBootstrapResponse,
    GlobalChatContext,
    GlobalChatMessage,
    GlobalChatMessagesResponse,
    LlmProfileDoc,
    MeResponse,
    PendingUserQuestion,
    ProjectDoc,
    ThinkingTrace,
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
import AppDialogTitle from "@/components/AppDialogTitle"
import { ThinkingTracePanel } from "@/features/chat/ThinkingTracePanel"

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

function parseContextKey(contextKey: string | null | undefined): { projectId: string; branch: string } | null {
    const raw = String(contextKey || "").trim()
    if (!raw) return null
    const parts = raw.split("::")
    if (parts.length < 2) return null
    const projectId = String(parts[0] || "").trim()
    const branch = String(parts.slice(1).join("::") || "main").trim() || "main"
    if (!projectId) return null
    return { projectId, branch }
}

const LAST_CONTEXT_STORAGE_KEY = "pqa.chat.last_context"

function parseStoredContext(
    raw: string | null | undefined
): { projectId: string; branch: string } | null {
    const text = String(raw || "").trim()
    if (!text) return null
    try {
        const parsed = JSON.parse(text) as { project_id?: string; branch?: string } | null
        const projectId = String(parsed?.project_id || "").trim()
        const branch = String(parsed?.branch || "main").trim() || "main"
        if (projectId) return { projectId, branch }
    } catch {
        // Fallback: legacy "project::branch" key format.
    }
    return parseContextKey(text)
}

type ProjectsResponseFlexible = ProjectDoc[] | { items?: ProjectDoc[]; projects?: ProjectDoc[] } | null | undefined

function normalizeProjectsResponse(input: ProjectsResponseFlexible): ProjectDoc[] {
    const rows: unknown[] = Array.isArray(input)
        ? input
        : Array.isArray(input?.items)
          ? input.items
          : Array.isArray(input?.projects)
            ? input.projects
            : []
    const seen = new Set<string>()
    const out: ProjectDoc[] = []
    for (const row of rows) {
        if (!row || typeof row !== "object") continue
        const project = row as ProjectDoc
        const id = String(project._id || "").trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({ ...project, _id: id })
    }
    return out
}

function parseErr(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err || "Unknown error")
}

function parseNdjsonChunk(buffer: string): { events: AskAgentStreamEvent[]; rest: string } {
    const lines = buffer.split("\n")
    const rest = lines.pop() || ""
    const events: AskAgentStreamEvent[] = []
    for (const line of lines) {
        const raw = line.trim()
        if (!raw) continue
        try {
            const parsed = JSON.parse(raw) as AskAgentStreamEvent
            if (parsed && typeof parsed === "object") events.push(parsed)
        } catch {
            // Ignore malformed stream line; final fallback request handles completeness.
        }
    }
    return { events, rest }
}

function appendTraceStep(prev: ThinkingTrace | null, payload: Record<string, unknown>, liveTitle?: string): ThinkingTrace {
    const steps = Array.isArray(prev?.steps) ? [...prev.steps] : []
    const rawStatus = String(payload.status || "info").toLowerCase()
    const status: "running" | "ok" | "error" | "info" =
        rawStatus === "ok" || rawStatus === "error" || rawStatus === "running" || rawStatus === "info"
            ? rawStatus
            : "info"
    const step = {
        id: String(payload.id || `step-${steps.length + 1}`),
        kind: String(payload.kind || payload.type || "status"),
        title: String(payload.title || liveTitle || "Thinking"),
        status,
        ts: String(payload.ts || new Date().toISOString()),
        duration_ms: payload.duration_ms == null ? null : Number(payload.duration_ms || 0),
        tool: payload.tool == null ? null : String(payload.tool || ""),
        summary: payload.summary == null ? null : String(payload.summary || ""),
        details: typeof payload.details === "object" && payload.details ? (payload.details as Record<string, unknown>) : {},
    }
    const existingIdx = steps.findIndex((row) => String(row.id || "") === step.id)
    if (existingIdx >= 0) {
        const existing = steps[existingIdx]
        steps[existingIdx] = {
            ...existing,
            ...step,
            details: {
                ...(typeof existing?.details === "object" && existing?.details ? existing.details : {}),
                ...(step.details || {}),
            },
        }
    } else {
        steps.push(step)
    }
    return {
        version: String(prev?.version || "v1"),
        started_at: String(prev?.started_at || new Date().toISOString()),
        finished_at: null,
        total_duration_ms: Number(prev?.total_duration_ms || 0),
        phases: Array.isArray(prev?.phases) ? prev?.phases : [],
        steps,
        summary: (prev?.summary || {}) as Record<string, unknown>,
    }
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

function messageArtifactKey(message: GlobalChatMessage, idx: number): string {
    const id = String(message.id || "").trim()
    if (id) return id
    return `${String(message.role || "message")}:${String(message.ts || idx)}:${idx}`
}

function hasCodeIntent(text: string): boolean {
    const raw = String(text || "")
    if (!raw.trim()) return false
    if (/```[\s\S]*?```/.test(raw)) return true
    if (/^\/(open|suggest|apply-last|diff|promote)\b/im.test(raw)) return true
    if (/(^|\s)(src|app|web|backend|docs|documentation)\/[A-Za-z0-9._/\-]+/.test(raw)) return true
    return false
}

function hasPromotableCodeContent(text: string): boolean {
    const raw = String(text || "")
    if (!raw.trim()) return false
    if (/```[\s\S]*?```/.test(raw)) return true
    if (/^diff --git\s+/m.test(raw)) return true
    if (/^@@\s+[-+0-9, ]+@@/m.test(raw)) return true
    if (/^\s*\{\s*"patch"\s*:/m.test(raw)) return true
    return false
}

function FloatingIsland({
    islandId,
    position,
    children,
}: {
    islandId: string
    position: { top?: number; right?: number; bottom?: number; left?: number }
    children: React.ReactNode
}) {
    const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null)

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(`pqa.chat.island.${islandId}`)
            if (!raw) return
            const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown }
            const x = Number(parsed?.x)
            const y = Number(parsed?.y)
            if (Number.isFinite(x) && Number.isFinite(y)) {
                setOffset({ x, y })
            }
        } catch {
            // ignore invalid stored positions
        }
    }, [islandId])

    useEffect(() => {
        try {
            window.localStorage.setItem(`pqa.chat.island.${islandId}`, JSON.stringify(offset))
        } catch {
            // ignore persistence errors
        }
    }, [islandId, offset])

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseX: offset.x,
            baseY: offset.y,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
    }, [offset.x, offset.y])

    const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        setOffset({
            x: drag.baseX + (event.clientX - drag.startX),
            y: drag.baseY + (event.clientY - drag.startY),
        })
        event.preventDefault()
    }, [])

    const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
    }, [])

    const resetOffset = useCallback(() => setOffset({ x: 0, y: 0 }), [])

    return (
        <Paper
            variant="outlined"
            sx={{
                position: "fixed",
                zIndex: 15,
                ...position,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                borderRadius: 99,
                px: 0.5,
                py: 0.4,
                backdropFilter: "blur(14px)",
                backgroundColor: "rgba(255,255,255,0.75)",
                borderColor: "rgba(15,23,42,0.12)",
                boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
            }}
        >
            <Stack direction="row" spacing={0.25} alignItems="center">
                <Box
                    title="Drag to move (double-click to reset)"
                    onDoubleClick={resetOffset}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        height: 20,
                        color: "text.secondary",
                        borderRight: "1px solid",
                        borderColor: "divider",
                        mr: 0.25,
                        cursor: "grab",
                        userSelect: "none",
                        touchAction: "none",
                    }}
                >
                    <DragIndicatorRounded sx={{ fontSize: 14 }} />
                </Box>
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
    const [automationsOpen, setAutomationsOpen] = useState(false)
    const [projectsOpen, setProjectsOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [adminOpen, setAdminOpen] = useState(false)
    const [workspaceOpenTabs, setWorkspaceOpenTabs] = useState<string[]>([])
    const [workspaceDirtyPaths, setWorkspaceDirtyPaths] = useState<string[]>([])
    const [workspaceActivePath, setWorkspaceActivePath] = useState<string | null>(null)
    const [workspaceActivePreview, setWorkspaceActivePreview] = useState<string | null>(null)
    const [workspaceDraftPreviews, setWorkspaceDraftPreviews] = useState<Array<{ path: string; preview: string }>>([])
    const [workspaceCursor, setWorkspaceCursor] = useState<{ line: number; column: number } | null>(null)
    const [autoOpenWorkspaceOnCodeIntent, setAutoOpenWorkspaceOnCodeIntent] = useState(true)
    const [showThinkingByDefault, setShowThinkingByDefault] = useState(true)
    const [liveThinkingTrace, setLiveThinkingTrace] = useState<ThinkingTrace | null>(null)
    const [thinkingExpandedByMessageKey, setThinkingExpandedByMessageKey] = useState<Record<string, boolean>>({})
    const [artifactsByMessageKey, setArtifactsByMessageKey] = useState<Record<string, ChatCodeArtifact[]>>({})
    const [artifactBusyKey, setArtifactBusyKey] = useState<string | null>(null)

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
            try {
                window.localStorage.setItem(
                    LAST_CONTEXT_STORAGE_KEY,
                    JSON.stringify({ project_id: projectId, branch: branch || "main" })
                )
            } catch {
                // ignore local storage write errors
            }
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
        if (!contextConfirmed || !selectedProjectId) return
        try {
            window.localStorage.setItem(
                LAST_CONTEXT_STORAGE_KEY,
                JSON.stringify({ project_id: selectedProjectId, branch: selectedBranch || "main" })
            )
        } catch {
            // ignore local storage write errors
        }
    }, [contextConfirmed, selectedBranch, selectedProjectId])

    useEffect(() => {
        let cancelled = false
        async function init() {
            setBooting(true)
            setError(null)
            try {
                const params = new URLSearchParams(window.location.search)
                const initialProject = params.get("project_id")
                const initialBranch = params.get("branch")
                const storedContext = parseStoredContext(window.localStorage.getItem(LAST_CONTEXT_STORAGE_KEY))
                const storedProject = storedContext?.projectId || ""
                const storedBranch = storedContext?.branch || "main"
                const [me, projectsRes, profilesRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<ProjectsResponseFlexible>("/api/projects"),
                    backendJson<{ items?: LlmProfileDoc[]; profiles?: LlmProfileDoc[] }>("/api/llm/profiles"),
                ])
                const user = String(me?.user?.email || me?.user?.id || "dev@local").trim().toLowerCase()
                const admin = Boolean(me?.user?.isGlobalAdmin)
                const list = normalizeProjectsResponse(projectsRes)
                const bootParams = new URLSearchParams({ user })
                if (initialProject) {
                    bootParams.set("project_id", initialProject)
                    bootParams.set("branch", initialBranch || "main")
                }
                const boot = await backendJson<GlobalChatBootstrapResponse>(`/api/chat/global/bootstrap?${bootParams.toString()}`)
                const fromBoot = parseContextKey(boot.active_context_key)
                const bootProject = fromBoot?.projectId || ""
                const bootBranch = fromBoot?.branch || "main"
                const selectedProjectCandidate = initialProject || storedProject || bootProject || list[0]?._id || ""
                const selectedProjectExists = list.some((p) => String(p._id) === String(selectedProjectCandidate))
                const selectedProject = selectedProjectExists ? selectedProjectCandidate : list[0]?._id || ""
                const selectedBr =
                    initialBranch ||
                    (selectedProject === storedProject ? storedBranch : "") ||
                    (selectedProject === bootProject ? bootBranch : "") ||
                    list.find((p) => p._id === selectedProject)?.default_branch ||
                    "main"
                const recoveredContext = Boolean(selectedProject && (initialProject || storedProject || bootProject))
                if (cancelled) return
                setUserId(user)
                setIsAdmin(admin)
                setProjects(list)
                setSelectedProjectId(selectedProject)
                setSelectedBranch(selectedBr)
                setContextConfirmed(recoveredContext)
                if (!selectedProject) {
                    setContextDialogOpen(true)
                }
                setLlmProfiles((profilesRes.items || profilesRes.profiles || []).filter(Boolean))
                setChatId(String(boot.chat_id || ""))
                setContexts(Array.isArray(boot.contexts) ? boot.contexts : [])
                setUnreadNotifications(Math.max(0, Number(boot.unread_notifications || 0)))
                if (recoveredContext) {
                    try {
                        await backendJson<{ active_context_key: string }>("/api/chat/global/context/select", {
                            method: "POST",
                            body: JSON.stringify({
                                chat_id: String(boot.chat_id || ""),
                                project_id: selectedProject,
                                branch: selectedBr,
                                user,
                            }),
                        })
                    } catch {
                        // Ignore context sync failures during bootstrap; local selection is still applied.
                    }
                }
                if (selectedProject) {
                    const branchesRes = await backendJson<BranchesResponse>(
                        `/api/projects/${encodeURIComponent(selectedProject)}/branches`
                    )
                    if (cancelled) return
                    setBranches(Array.isArray(branchesRes.branches) && branchesRes.branches.length > 0 ? branchesRes.branches : ["main"])
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
        if (projectsOpen) return
        let cancelled = false
        async function refreshProjectsAfterClose() {
            try {
                const list = normalizeProjectsResponse(await backendJson<ProjectsResponseFlexible>("/api/projects"))
                if (cancelled) return
                setProjects(list)
                if (!selectedProjectId && list[0]?._id) {
                    setSelectedProjectId(list[0]._id)
                    setSelectedBranch(String(list[0].default_branch || "main"))
                    setContextConfirmed(false)
                }
            } catch {
                // Ignore refresh errors.
            }
        }
        void refreshProjectsAfterClose()
        return () => {
            cancelled = true
        }
    }, [projectsOpen, selectedProjectId])

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem("pqa.chat.auto_open_workspace_code_intent")
            if (raw === "0") setAutoOpenWorkspaceOnCodeIntent(false)
            if (raw === "1") setAutoOpenWorkspaceOnCodeIntent(true)
        } catch {
            // ignore local storage read errors
        }
    }, [])

    useEffect(() => {
        try {
            window.localStorage.setItem("pqa.chat.auto_open_workspace_code_intent", autoOpenWorkspaceOnCodeIntent ? "1" : "0")
        } catch {
            // ignore local storage write errors
        }
    }, [autoOpenWorkspaceOnCodeIntent])

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem("pqa.chat.show_thinking")
            if (raw === "0") setShowThinkingByDefault(false)
            if (raw === "1") setShowThinkingByDefault(true)
        } catch {
            // ignore local storage read errors
        }
    }, [])

    useEffect(() => {
        try {
            window.localStorage.setItem("pqa.chat.show_thinking", showThinkingByDefault ? "1" : "0")
        } catch {
            // ignore local storage write errors
        }
    }, [showThinkingByDefault])

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem("pqa.chat.active_only")
            if (raw === "1") setActiveOnly(true)
            if (raw === "0") setActiveOnly(false)
        } catch {
            // ignore local storage read errors
        }
    }, [])

    useEffect(() => {
        try {
            window.localStorage.setItem("pqa.chat.active_only", activeOnly ? "1" : "0")
        } catch {
            // ignore local storage write errors
        }
    }, [activeOnly])

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

    useEffect(() => {
        const previousBodyOverflow = document.body.style.overflow
        const previousHtmlOverflow = document.documentElement.style.overflow
        document.body.style.overflow = "hidden"
        document.documentElement.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = previousBodyOverflow
            document.documentElement.style.overflow = previousHtmlOverflow
        }
    }, [])

    const sendQuestion = useCallback(
        async (question: string, pendingQuestionId?: string) => {
            const trimmed = question.trim()
            if (!trimmed || !chatId || !selectedProjectId || !selectedBranch) return
            const cmdMatch = trimmed.match(/^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/)
            if (cmdMatch) {
                const cmd = String(cmdMatch[1] || "").toLowerCase()
                const arg = String(cmdMatch[2] || "").trim()
                if (cmd === "open" || cmd === "diff") {
                    if (arg) {
                        setWorkspaceRequestedPath(arg.replace(/^\.?\//, ""))
                    }
                    setWorkspaceRequestedAction(null)
                    setWorkspaceRequestedPatchContent(null)
                    setWorkspaceRequestedPatchAutoApply(false)
                    setWorkspaceOpen(true)
                    return
                }
                if (cmd === "suggest") {
                    setWorkspaceRequestedAction("suggest")
                    setWorkspaceRequestedPatchContent(null)
                    setWorkspaceOpen(true)
                    return
                }
                if (cmd === "apply-last") {
                    setWorkspaceRequestedAction("apply-last")
                    setWorkspaceRequestedPatchContent(null)
                    setWorkspaceOpen(true)
                    return
                }
                if (cmd === "promote") {
                    const latestAssistant = [...messages]
                        .reverse()
                        .find((row) => row.role === "assistant" && String(row.context_key || "") === activeContextKey)
                    if (!latestAssistant) {
                        setError("No assistant message in this context is available to promote.")
                        return
                    }
                    const raw = String(latestAssistant.content || "").trim()
                    if (!raw) {
                        setError("The latest assistant response is empty.")
                        return
                    }
                    setWorkspaceRequestedPatchContent(raw)
                    setWorkspaceRequestedPatchFallbackPath(arg || null)
                    setWorkspaceRequestedPatchAutoApply(false)
                    setWorkspaceOpen(true)
                    return
                }
            }
            if (autoOpenWorkspaceOnCodeIntent && hasCodeIntent(trimmed)) {
                setWorkspaceOpen(true)
            }
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
            const requestPayload = {
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
            }
            try {
                let res: AskAgentResponse | null = null
                setLiveThinkingTrace({
                    version: "v1",
                    started_at: new Date().toISOString(),
                    steps: [],
                    phases: [],
                    summary: {},
                })
                try {
                    const streamRes = await fetch("/api/ask_agent/stream", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(requestPayload),
                    })
                    if (!streamRes.ok || !streamRes.body) {
                        throw new Error(`Stream request failed (${streamRes.status})`)
                    }
                    const reader = streamRes.body.getReader()
                    const decoder = new TextDecoder()
                    let buffer = ""
                    let finalPayload: AskAgentResponse | null = null
                    while (true) {
                        const chunk = await reader.read()
                        if (chunk.done) break
                        buffer += decoder.decode(chunk.value, { stream: true })
                        const parsed = parseNdjsonChunk(buffer)
                        buffer = parsed.rest
                        for (const ev of parsed.events) {
                            const payload = (ev.payload || {}) as Record<string, unknown>
                            if (ev.type === "final") {
                                finalPayload = payload as unknown as AskAgentResponse
                                if ((payload as any)?.thinking_trace) {
                                    setLiveThinkingTrace((payload as any).thinking_trace as ThinkingTrace)
                                }
                                continue
                            }
                            if (ev.type === "error") {
                                throw new Error(String((payload as any)?.message || "Streaming request failed"))
                            }
                            if (ev.type === "phase") {
                                setLiveThinkingTrace((prev) =>
                                    appendTraceStep(
                                        prev,
                                        {
                                            id: `phase-${String((payload as any)?.name || "")}-${Date.now()}`,
                                            kind: "phase",
                                            title: `Phase: ${String((payload as any)?.name || "update")}`,
                                            status: String((payload as any)?.status || "info"),
                                            ts: String((payload as any)?.ts || new Date().toISOString()),
                                            details: payload,
                                        },
                                        "Phase update"
                                    )
                                )
                                continue
                            }
                            if (ev.type === "tool_start" || ev.type === "tool_end" || ev.type === "status") {
                                setLiveThinkingTrace((prev) =>
                                    appendTraceStep(
                                        prev,
                                        payload,
                                        ev.type === "tool_start"
                                            ? "Tool started"
                                            : ev.type === "tool_end"
                                              ? "Tool finished"
                                              : "Status"
                                    )
                                )
                            }
                        }
                    }
                    if (!finalPayload) {
                        throw new Error("Missing final stream payload.")
                    }
                    res = finalPayload
                } catch {
                    // Fallback to sync ask endpoint when streaming is unavailable.
                    setLiveThinkingTrace(null)
                    res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                        method: "POST",
                        body: JSON.stringify(requestPayload),
                    })
                }
                if (!res) throw new Error("No response payload.")
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
                        thinking_trace: res.thinking_trace as ThinkingTrace | undefined,
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
                setLiveThinkingTrace(null)
                setSending(false)
            }
        },
        [
            activeContextKey,
            activeOnly,
            autoOpenWorkspaceOnCodeIntent,
            chatId,
            messages,
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
            const byClass = toolCatalog.reduce<Record<string, ToolCatalogItem[]>>((acc, tool) => {
                const key = String(tool.class_key || "custom.uncategorized")
                if (!acc[key]) acc[key] = []
                acc[key].push(tool)
                return acc
            }, {})
            const allowedClasses: string[] = []
            const blockedClasses: string[] = []
            for (const [classKey, tools] of Object.entries(byClass)) {
                if (!tools.length) continue
                const enabledCount = tools.filter((tool) => toolEnabledSet.has(tool.name)).length
                if (enabledCount === 0) blockedClasses.push(classKey)
                if (enabledCount === tools.length) allowedClasses.push(classKey)
            }
            await backendJson<ChatToolPolicyResponse>(`/api/chats/${encodeURIComponent(chatId)}/tool-policy`, {
                method: "PUT",
                body: JSON.stringify({
                    context_key: activeContextKey,
                    project_id: selectedProjectId,
                    branch: selectedBranch || "main",
                    strict_allowlist: true,
                    allowed_tools: enabledNames,
                    allowed_classes: allowedClasses.sort(),
                    blocked_tools: blockedNames,
                    blocked_classes: blockedClasses.sort(),
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

    const extractMessageArtifacts = useCallback(
        async (messageKey: string, message: GlobalChatMessage): Promise<ChatCodeArtifact[]> => {
            if (!selectedProjectId) return []
            const out = await backendJson<ChatCodeArtifactsExtractResponse>(
                `/api/projects/${encodeURIComponent(selectedProjectId)}/workspace/chat-artifacts/extract`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        user: userId,
                        branch: selectedBranch || "main",
                        chat_id: chatId,
                        context_key: message.context_key || activeContextKey || null,
                        message_id: String(message.id || messageKey),
                        content: String(message.content || ""),
                    }),
                }
            )
            const artifacts = Array.isArray(out.artifacts) ? out.artifacts : []
            setArtifactsByMessageKey((prev) => ({ ...prev, [messageKey]: artifacts }))
            return artifacts
        },
        [activeContextKey, chatId, selectedBranch, selectedProjectId, userId]
    )

    const promoteMessageArtifact = useCallback(
        async (messageKey: string, message: GlobalChatMessage, fallbackPath?: string | null, autoApply = false) => {
            if (!selectedProjectId) return
            setArtifactBusyKey(messageKey)
            setError(null)
            try {
                let artifacts = artifactsByMessageKey[messageKey] || []
                if (!artifacts.length) {
                    artifacts = await extractMessageArtifacts(messageKey, message)
                }
                if (!artifacts.length) {
                    throw new Error("No code artifacts were found in this message.")
                }
                const selectedArtifact =
                    artifacts.find((row) => Boolean(String(row.path_hint || "").trim())) ||
                    artifacts.find((row) => String(row.type || "") === "diff") ||
                    artifacts[0]
                const out = await backendJson<ChatCodeArtifactsPromoteResponse>(
                    `/api/projects/${encodeURIComponent(selectedProjectId)}/workspace/chat-artifacts/promote`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            user: userId,
                            branch: selectedBranch || "main",
                            chat_id: chatId,
                            context_key: message.context_key || activeContextKey || null,
                            message_id: String(message.id || messageKey),
                            artifact_id: selectedArtifact.id,
                            fallback_path: String(fallbackPath || selectedArtifact.path_hint || "").trim() || null,
                        }),
                    }
                )
                const patch = out.promotion?.patch
                if (!patch || typeof patch !== "object") {
                    throw new Error("Could not promote the selected artifact to a patch.")
                }
                setWorkspaceRequestedPatchContent(JSON.stringify({ patch }))
                setWorkspaceRequestedPatchFallbackPath(String(fallbackPath || selectedArtifact.path_hint || "").trim() || null)
                setWorkspaceRequestedPatchAutoApply(autoApply)
                setWorkspaceOpen(true)
                if (!autoApply) {
                    setError(null)
                }
            } catch (err) {
                setError(parseErr(err))
            } finally {
                setArtifactBusyKey((current) => (current === messageKey ? null : current))
            }
        },
        [activeContextKey, artifactsByMessageKey, chatId, extractMessageArtifacts, selectedBranch, selectedProjectId, userId]
    )

    const reviewMessagePatch = useCallback(
        (messageKey: string, message: GlobalChatMessage, fallbackPath?: string | null) => {
            void promoteMessageArtifact(messageKey, message, fallbackPath, false)
        },
        [promoteMessageArtifact]
    )

    const applyMessagePatchFromBubble = useCallback(
        (messageKey: string, message: GlobalChatMessage, fallbackPath?: string | null) => {
            void promoteMessageArtifact(messageKey, message, fallbackPath, true)
        },
        [promoteMessageArtifact]
    )

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
        <Box
            sx={{
                minHeight: "100dvh",
                height: "100dvh",
                maxHeight: "100dvh",
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                px: { xs: 0.6, md: 1.2 },
                py: { xs: 0.6, md: 0.9 },
            }}
        >
            <FloatingIsland islandId="context" position={{ top: 12, left: 14 }}>
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

            <FloatingIsland islandId="work" position={{ top: 12, right: 14 }}>
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
                    <IconButton size="small" onClick={() => setWorkspaceOpen((prev) => !prev)}>
                        <CodeRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
            </FloatingIsland>

            <FloatingIsland islandId="utility" position={{ bottom: 16, right: 14 }}>
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
                        onClick={() => selectedProjectId && setAutomationsOpen(true)}
                    >
                        <AutoModeRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Project settings">
                    <IconButton
                        size="small"
                        onClick={() => selectedProjectId && setSettingsOpen(true)}
                    >
                        <SettingsRounded fontSize="small" />
                    </IconButton>
                </Tooltip>
                {isAdmin && (
                    <Tooltip title="Admin">
                        <IconButton size="small" onClick={() => setAdminOpen(true)}>
                            <AdminPanelSettingsRounded fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
            </FloatingIsland>

            <Dialog open={contextDialogOpen} onClose={() => setContextDialogOpen(false)} fullWidth maxWidth="sm">
                <DialogContent>
                    <Stack spacing={1.2} sx={{ pt: 0.5 }}>
                        <Typography variant="subtitle2">Active Context</Typography>
                        {projects.length === 0 && (
                            <Alert
                                severity="info"
                                action={
                                    <Button size="small" onClick={() => setProjectsOpen(true)}>
                                        Open Projects
                                    </Button>
                                }
                            >
                                No projects found. Create one first.
                            </Alert>
                        )}
                        <FormControl size="small" fullWidth>
                            <InputLabel id="ctx-project-label">Project</InputLabel>
                            <Select
                                labelId="ctx-project-label"
                                label="Project"
                                value={selectedProjectId}
                                disabled={projects.length === 0}
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
                                disabled={!selectedProjectId}
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
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch
                                checked={autoOpenWorkspaceOnCodeIntent}
                                onChange={(_, v) => setAutoOpenWorkspaceOnCodeIntent(v)}
                            />
                            <Typography variant="body2">Auto-open workspace on code intent</Typography>
                        </Stack>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch checked={showThinkingByDefault} onChange={(_, v) => setShowThinkingByDefault(v)} />
                            <Typography variant="body2">Show thinking trace in chat</Typography>
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
                            mt: 0,
                            maxWidth: "100%",
                            height: "100%",
                            minHeight: 0,
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
                            <Stack spacing={0.6}>
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
                                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                                    <Chip
                                        size="small"
                                        color={artifactBusyKey ? "warning" : workspaceRequestedPatchContent ? "info" : "success"}
                                        label={artifactBusyKey ? "Promoting code..." : workspaceRequestedPatchContent ? "Patch pending" : "Synced"}
                                    />
                                    {workspaceActivePath && (
                                        <Chip size="small" variant="outlined" label={`File: ${workspaceActivePath}`} />
                                    )}
                                </Stack>
                            </Stack>
                        </Box>

                        {error && (
                            <Alert severity="error" onClose={() => setError(null)} sx={{ m: 1.1 }}>
                                {error}
                            </Alert>
                        )}

                        <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 0.8, md: 1.5 }, py: 1.1 }}>
                            <Stack spacing={0.85}>
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
                            const messageKey = messageArtifactKey(message, idx)
                            const messageContextKey = String(message.context_key || "")
                            const isActive = messageContextKey === activeContextKey
                            const compact = !isActive
                            const contextProject = String(message.project_id || "")
                            const contextBranch = String(message.branch || "main")
                            const contextLabel = `${projectNameById.get(contextProject) || contextProject || "Unknown"} · ${contextBranch}`
                            const branchChipLabel =
                                contextBranch.length > (compact ? 10 : 14)
                                    ? `${contextBranch.slice(0, compact ? 9 : 13)}…`
                                    : contextBranch
                            const sources = message.role === "assistant" ? (message.meta?.sources || []) : []
                            const thinkingTrace = message.role === "assistant" ? (message.meta?.thinking_trace as ThinkingTrace | undefined) : undefined
                            const hasPromotableCode = hasPromotableCodeContent(String(message.content || ""))
                            const artifacts = artifactsByMessageKey[messageKey] || []
                            const fallbackPath =
                                sources.find((src) => Boolean(String(src.path || "").trim()))?.path ||
                                artifacts.find((row) => Boolean(String(row.path_hint || "").trim()))?.path_hint ||
                                null
                            const canOpenInWorkspace = Boolean(String(fallbackPath || "").trim())
                            const canPromoteCode = hasPromotableCode && artifacts.length === 0
                            const canReviewPatch = hasPromotableCode || artifacts.length > 0
                            const canApplyPatch = hasPromotableCode || artifacts.length > 0
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
                                                {!isActive && (
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.62rem" }}>
                                                        Inactive context
                                                    </Typography>
                                                )}
                                                {!isUser && showThinkingByDefault && !!thinkingTrace && (
                                                    <Box sx={{ alignSelf: "flex-start", maxWidth: "min(40%, 180px)", maxHeight: "fit-content" }}>
                                                        <ThinkingTracePanel
                                                            trace={thinkingTrace}
                                                            compact
                                                            expanded={Boolean(thinkingExpandedByMessageKey[messageKey])}
                                                            onToggle={(next) =>
                                                                setThinkingExpandedByMessageKey((prev) => ({ ...prev, [messageKey]: next }))
                                                            }
                                                        />
                                                    </Box>
                                                )}
                                                <Box sx={{ ml: "auto", display: "inline-flex", alignItems: "center", gap: 0.35 }}>
                                                    <Tooltip title={contextLabel}>
                                                        <Chip
                                                            size="small"
                                                            icon={<AccountTreeRounded sx={{ fontSize: compact ? 10 : 11 }} />}
                                                            label={branchChipLabel || "main"}
                                                            variant={isActive ? "filled" : "outlined"}
                                                            sx={{
                                                                height: compact ? 16 : 18,
                                                                "& .MuiChip-label": {
                                                                    px: 0.5,
                                                                    fontSize: compact ? "0.58rem" : "0.62rem",
                                                                    fontWeight: 600,
                                                                },
                                                                "& .MuiChip-icon": {
                                                                    ml: 0.45,
                                                                    mr: -0.15,
                                                                },
                                                            }}
                                                        />
                                                    </Tooltip>
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

                                            {!compact &&
                                                !isUser &&
                                                (sources.length > 0 ||
                                                    canOpenInWorkspace ||
                                                    canPromoteCode ||
                                                    canReviewPatch ||
                                                    canApplyPatch ||
                                                    artifacts.length > 0) && (
                                                <Stack spacing={0.25}>
                                                    {(canOpenInWorkspace || canPromoteCode || canReviewPatch || canApplyPatch) && (
                                                        <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                                                            {canOpenInWorkspace && (
                                                                <Button
                                                                    variant="outlined"
                                                                    size="small"
                                                                    onClick={() => openInWorkspaceFromMessage(fallbackPath)}
                                                                >
                                                                    Open in Workspace
                                                                </Button>
                                                            )}
                                                            {canPromoteCode && (
                                                                <Button
                                                                    variant="outlined"
                                                                    size="small"
                                                                    disabled={artifactBusyKey === messageKey}
                                                                    onClick={() => reviewMessagePatch(messageKey, message, fallbackPath)}
                                                                >
                                                                    Promote Code
                                                                </Button>
                                                            )}
                                                            {canReviewPatch && (
                                                                <Button
                                                                    variant="outlined"
                                                                    size="small"
                                                                    disabled={artifactBusyKey === messageKey}
                                                                    onClick={() => reviewMessagePatch(messageKey, message, fallbackPath)}
                                                                >
                                                                    Review Patch
                                                                </Button>
                                                            )}
                                                            {canApplyPatch && (
                                                                <Button
                                                                    variant="outlined"
                                                                    size="small"
                                                                    disabled={artifactBusyKey === messageKey}
                                                                    onClick={() => applyMessagePatchFromBubble(messageKey, message, fallbackPath)}
                                                                >
                                                                    Apply Selected
                                                                </Button>
                                                            )}
                                                        </Stack>
                                                    )}
                                                    {artifacts.length > 0 && (
                                                        <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap">
                                                            {artifacts.slice(0, 8).map((artifact) => (
                                                                <Chip
                                                                    key={`${messageKey}-${artifact.id}`}
                                                                    size="small"
                                                                    label={`${artifact.type}${artifact.language ? ` · ${artifact.language}` : ""}${artifact.path_hint ? ` · ${artifact.path_hint}` : ""}`}
                                                                />
                                                            ))}
                                                        </Stack>
                                                    )}
                                                    {sources.length > 0 && (
                                                        <>
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
                                                        </>
                                                    )}
                                                </Stack>
                                            )}
                                        </Stack>
                                    </Paper>
                                </Box>
                            )
                                })}
                                {sending && (
                                    <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                                        <Paper
                                            variant="outlined"
                                            sx={{
                                                maxWidth: { xs: "98%", sm: "94%" },
                                                px: 1.2,
                                                py: 0.75,
                                                borderRadius: 1.8,
                                                borderColor: "rgba(15,23,42,0.13)",
                                                bgcolor: "rgba(255,255,255,0.68)",
                                            }}
                                        >
                                            <Stack spacing={0.7}>
                                                <Stack direction="row" spacing={0.8} alignItems="center">
                                                    <CircularProgress size={14} thickness={5} />
                                                    <Typography variant="body2" color="text.secondary">
                                                        Thinking...
                                                    </Typography>
                                                </Stack>
                                                {showThinkingByDefault && !!liveThinkingTrace && (
                                                    <ThinkingTracePanel
                                                        trace={liveThinkingTrace}
                                                        live
                                                        defaultExpanded
                                                        expanded
                                                    />
                                                )}
                                            </Stack>
                                        </Paper>
                                    </Box>
                                )}
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

            <Dialog open={projectsOpen} onClose={() => setProjectsOpen(false)} fullWidth maxWidth="xl">
                <AppDialogTitle title="Projects" onClose={() => setProjectsOpen(false)} />
                <DialogContent sx={{ p: 0, height: { xs: "76vh", md: "84vh" } }}>
                    <Box
                        component="iframe"
                        title="Projects"
                        src="/projects?embedded=1"
                        sx={{ border: 0, width: "100%", height: "100%", display: "block", bgcolor: "background.default" }}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={automationsOpen} onClose={() => setAutomationsOpen(false)} fullWidth maxWidth="xl">
                <AppDialogTitle title="Automations" onClose={() => setAutomationsOpen(false)} />
                <DialogContent sx={{ p: 0, height: { xs: "76vh", md: "84vh" } }}>
                    {selectedProjectId ? (
                        <Box
                            component="iframe"
                            title="Automations"
                            src={`/projects/${encodeURIComponent(selectedProjectId)}/automations?embedded=1&branch=${encodeURIComponent(selectedBranch || "main")}`}
                            sx={{ border: 0, width: "100%", height: "100%", display: "block", bgcolor: "background.default" }}
                        />
                    ) : (
                        <Box sx={{ p: 2 }}>
                            <Alert severity="info">Select a project context first.</Alert>
                        </Box>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="xl">
                <AppDialogTitle title="Project Settings" onClose={() => setSettingsOpen(false)} />
                <DialogContent sx={{ p: 0, height: { xs: "76vh", md: "84vh" } }}>
                    {selectedProjectId ? (
                        <Box
                            component="iframe"
                            title="Project settings"
                            src={`/projects/${encodeURIComponent(selectedProjectId)}/settings?embedded=1&branch=${encodeURIComponent(selectedBranch || "main")}`}
                            sx={{ border: 0, width: "100%", height: "100%", display: "block", bgcolor: "background.default" }}
                        />
                    ) : (
                        <Box sx={{ p: 2 }}>
                            <Alert severity="info">Select a project context first.</Alert>
                        </Box>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={adminOpen} onClose={() => setAdminOpen(false)} fullWidth maxWidth="xl">
                <AppDialogTitle title="Admin" onClose={() => setAdminOpen(false)} />
                <DialogContent sx={{ p: 0, height: { xs: "76vh", md: "84vh" } }}>
                    <Box
                        component="iframe"
                        title="Admin"
                        src="/admin?embedded=1"
                        sx={{ border: 0, width: "100%", height: "100%", display: "block", bgcolor: "background.default" }}
                    />
                </DialogContent>
            </Dialog>
        </Box>
    )
}
