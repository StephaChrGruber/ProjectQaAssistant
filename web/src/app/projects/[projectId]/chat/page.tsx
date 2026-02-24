"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import {
    Alert,
    Box,
    Collapse,
    Dialog,
    DialogContent,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Stack,
    Typography,
} from "@mui/material"
import FolderRounded from "@mui/icons-material/FolderRounded"
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import { backendJson } from "@/lib/backend"
import {
    ProjectDrawerLayout,
    type DrawerChat,
    type DrawerChatGroup,
    type DrawerUser,
} from "@/components/ProjectDrawerLayout"
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
import { ChatMessagesPane } from "@/features/chat/ChatMessagesPane"
import { ChatHeaderBar } from "@/features/chat/ChatHeaderBar"
import { ChatToolEventsBanner } from "@/features/chat/ChatToolEventsBanner"
import { ChatComposer } from "@/features/chat/ChatComposer"
import { NewChatDialog } from "@/features/chat/NewChatDialog"
import { useLocalToolJobWorker } from "@/features/local-tools/useLocalToolJobWorker"
import AppDialogTitle from "@/components/AppDialogTitle"
import type {
    AskAgentResponse,
    BranchesResponse,
    ChatAnswerSource,
    ChatLlmProfileResponse,
    ChatTaskItem,
    ChatTasksResponse,
    ChatTaskState,
    ChatMemoryStateResponse,
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

const ChatToolsDialog = dynamic(
    () => import("@/features/chat/ChatToolsDialog").then((m) => m.ChatToolsDialog),
    { ssr: false }
)

const ChatTasksDialog = dynamic(
    () => import("@/features/chat/ChatTasksDialog").then((m) => m.ChatTasksDialog),
    { ssr: false }
)

const DocumentationDialog = dynamic(
    () => import("@/features/chat/DocumentationDialog").then((m) => m.DocumentationDialog),
    { ssr: false }
)

const ChatSessionMemoryPanel = dynamic(
    () => import("@/features/chat/ChatSessionMemoryPanel").then((m) => m.ChatSessionMemoryPanel),
    { ssr: false }
)

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

    const [projects, setProjects] = useState<ProjectDoc[]>([])
    const [chatGroups, setChatGroups] = useState<DrawerChatGroup[]>([])
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
    const [tasksOpen, setTasksOpen] = useState(false)
    const [tasksLoading, setTasksLoading] = useState(false)
    const [tasksSaving, setTasksSaving] = useState(false)
    const [tasksError, setTasksError] = useState<string | null>(null)
    const [tasks, setTasks] = useState<ChatTaskItem[]>([])
    const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([])
    const [chatToolPolicy, setChatToolPolicy] = useState<ChatToolPolicy | null>(null)
    const [toolEnabledSet, setToolEnabledSet] = useState<Set<string>>(new Set())
    const [toolReadOnlyOnly, setToolReadOnlyOnly] = useState(false)
    const [toolDryRun, setToolDryRun] = useState(false)
    const [requireApprovalForWriteTools, setRequireApprovalForWriteTools] = useState(false)
    const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set())
    const [approvalBusyTool, setApprovalBusyTool] = useState<string | null>(null)
    const [llmProfiles, setLlmProfiles] = useState<LlmProfileDoc[]>([])
    const [selectedLlmProfileId, setSelectedLlmProfileId] = useState<string>("")
    const [savingLlmProfile, setSavingLlmProfile] = useState(false)
    const [expandedSourceMessages, setExpandedSourceMessages] = useState<Record<string, boolean>>({})
    const [chatMemory, setChatMemory] = useState<ChatMemorySummary | null>(null)
    const [chatTaskState, setChatTaskState] = useState<ChatTaskState | null>(null)
    const [sessionMemoryOpen, setSessionMemoryOpen] = useState(false)
    const [resettingMemory, setResettingMemory] = useState(false)
    const [savingMemory, setSavingMemory] = useState(false)
    const [pendingUserQuestion, setPendingUserQuestion] = useState<PendingUserQuestion | null>(null)
    const [pendingAnswerInput, setPendingAnswerInput] = useState("")
    const [newChatOpen, setNewChatOpen] = useState(false)
    const [creatingNewChat, setCreatingNewChat] = useState(false)
    const [newChatError, setNewChatError] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)

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
    const projectDefaultLlmProfile = useMemo(
        () => llmProfiles.find((p) => p.id === (project?.llm_profile_id || "")) || null,
        [llmProfiles, project?.llm_profile_id]
    )
    const effectiveLlmProfile = selectedLlmProfile || projectDefaultLlmProfile
    const llmSummary = useMemo(() => {
        if (effectiveLlmProfile) {
            return `${effectiveLlmProfile.name} (${effectiveLlmProfile.provider.toUpperCase()} · ${effectiveLlmProfile.model})`
        }
        return `${(project?.llm_provider || "default LLM").toUpperCase()}${project?.llm_model ? ` · ${project.llm_model}` : ""}`
    }, [effectiveLlmProfile, project?.llm_model, project?.llm_provider])
    const projectDefaultLlmLabel = useMemo(() => {
        if (projectDefaultLlmProfile) {
            return `${projectDefaultLlmProfile.name} (${projectDefaultLlmProfile.provider.toUpperCase()} · ${projectDefaultLlmProfile.model})`
        }
        if (project?.llm_model || project?.llm_provider) {
            return `${(project?.llm_provider || "default LLM").toUpperCase()}${project?.llm_model ? ` · ${project.llm_model}` : ""}`
        }
        return "Not configured"
    }, [project?.llm_model, project?.llm_provider, projectDefaultLlmProfile])
    const newChatProjectOptions = useMemo(() => {
        return (projects || []).map((p) => ({
            id: p._id,
            label: p.name || p.key || p._id,
            defaultBranch: p.default_branch || "main",
        }))
    }, [projects])
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
        if (!tasksError) return
        const timer = window.setTimeout(() => setTasksError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [tasksError])

    useEffect(() => {
        if (!newChatError) return
        const timer = window.setTimeout(() => setNewChatError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [newChatError])

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

    const loadChatMemoryState = useCallback(async (chatId: string, forceRefresh = false) => {
        const refreshQuery = forceRefresh ? "&refresh=1" : ""
        const out = await backendJson<ChatMemoryStateResponse>(
            `/api/chats/${encodeURIComponent(chatId)}/memory?user=${encodeURIComponent(userId)}${refreshQuery}`
        )
        setChatMemory((out.memory_summary as ChatMemorySummary) || null)
        setChatTaskState((out.task_state as ChatTaskState) || null)
    }, [userId])

    const resetChatMemory = useCallback(async () => {
        const chatId = selectedChatIdRef.current
        if (!chatId) return
        setResettingMemory(true)
        setError(null)
        try {
            const out = await backendJson<ChatMemoryStateResponse>(
                `/api/chats/${encodeURIComponent(chatId)}/memory/reset?user=${encodeURIComponent(userId)}`,
                { method: "POST" }
            )
            setChatMemory((out.memory_summary as ChatMemorySummary) || null)
            setChatTaskState((out.task_state as ChatTaskState) || null)
        } catch (err) {
            setError(errText(err))
        } finally {
            setResettingMemory(false)
        }
    }, [userId])

    const saveChatMemory = useCallback(async (next: ChatMemorySummary) => {
        const chatId = selectedChatIdRef.current
        if (!chatId) return
        setSavingMemory(true)
        setError(null)
        try {
            const out = await backendJson<ChatMemoryStateResponse>(
                `/api/chats/${encodeURIComponent(chatId)}/memory?user=${encodeURIComponent(userId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        decisions: next.decisions || [],
                        open_questions: next.open_questions || [],
                        next_steps: next.next_steps || [],
                        goals: next.goals || [],
                        constraints: next.constraints || [],
                        blockers: next.blockers || [],
                        assumptions: next.assumptions || [],
                        knowledge: next.knowledge || [],
                    }),
                }
            )
            setChatMemory((out.memory_summary as ChatMemorySummary) || next)
            setChatTaskState((out.task_state as ChatTaskState) || null)
        } catch (err) {
            setError(errText(err))
        } finally {
            setSavingMemory(false)
        }
    }, [userId])

    const loadChats = useCallback(
        async (activeBranch: string, preferredChatId?: string | null) => {
            setLoadingChats(true)
            try {
                const allProjects = await backendJson<ProjectDoc[]>("/api/projects")
                const projectRows = (allProjects || []).filter((p) => p && p._id)
                setProjects(projectRows)

                const groups = await Promise.all(
                    projectRows.map(async (row) => {
                        try {
                            const docs = await backendJson<DrawerChat[]>(
                                `/api/projects/${encodeURIComponent(row._id)}/chats?limit=100&user=${encodeURIComponent(userId)}`
                            )
                            return {
                                projectId: row._id,
                                projectLabel: row.name || row.key || row._id,
                                chats: dedupeChatsById(docs || []),
                            } satisfies DrawerChatGroup
                        } catch {
                            return {
                                projectId: row._id,
                                projectLabel: row.name || row.key || row._id,
                                chats: [],
                            } satisfies DrawerChatGroup
                        }
                    })
                )

                let currentGroup = groups.find((g) => g.projectId === projectId)
                if (!currentGroup) {
                    currentGroup = {
                        projectId,
                        projectLabel,
                        chats: [],
                    }
                    groups.unshift(currentGroup)
                }

                let currentChats = dedupeChatsById(currentGroup.chats || [])
                const current = preferredChatId || selectedChatIdRef.current
                if (current && !currentChats.some((c) => c.chat_id === current)) {
                    await ensureChat(current, activeBranch)
                    const now = new Date().toISOString()
                    currentChats = dedupeChatsById([
                        {
                            chat_id: current,
                            title: `${projectLabel} / ${activeBranch}`,
                            project_id: projectId,
                            branch: activeBranch,
                            updated_at: now,
                            created_at: now,
                        },
                        ...currentChats,
                    ])
                }

                if (!currentChats.length) {
                    const fallback = preferredChatId || `${projectId}::${activeBranch}::${userId}`
                    await ensureChat(fallback, activeBranch)
                    const now = new Date().toISOString()
                    currentChats = [
                        {
                            chat_id: fallback,
                            title: `${projectLabel} / ${activeBranch}`,
                            project_id: projectId,
                            branch: activeBranch,
                            updated_at: now,
                            created_at: now,
                        },
                    ]
                }

                const nextGroups = groups.map((group) =>
                    group.projectId === projectId
                        ? {
                              ...group,
                              chats: currentChats,
                          }
                        : group
                )
                setChatGroups(nextGroups)
                setChats(currentChats)

                const next =
                    (current && currentChats.some((c) => c.chat_id === current) && current) || currentChats[0]?.chat_id || null
                setSelectedChatId(next)
                return next
            } finally {
                setLoadingChats(false)
            }
        },
        [ensureChat, projectId, projectLabel, userId]
    )

    const touchChatLocally = useCallback(
        (chatId: string, previewText: string) => {
            const nowIso = new Date().toISOString()
            const preview = previewText.trim().slice(0, 120)
            setChats((prev) => {
                const next = [...(prev || [])]
                const idx = next.findIndex((c) => c.chat_id === chatId)
                if (idx >= 0) {
                    const current = next[idx]
                    const updated: DrawerChat = {
                        ...current,
                        branch: current.branch || branch,
                        updated_at: nowIso,
                    }
                    if (!(current.title || "").trim() && preview) {
                        updated.title = preview
                    }
                    next.splice(idx, 1)
                    next.unshift(updated)
                    return dedupeChatsById(next)
                }
                next.unshift({
                    chat_id: chatId,
                    title: preview || `${projectLabel} / ${branch}`,
                    branch,
                    updated_at: nowIso,
                    created_at: nowIso,
                })
                return dedupeChatsById(next)
            })
            setChatGroups((prev) =>
                (prev || []).map((group) => {
                    if (group.projectId !== projectId) return group
                    const next = [...(group.chats || [])]
                    const idx = next.findIndex((c) => c.chat_id === chatId)
                    if (idx >= 0) {
                        const current = next[idx]
                        const updated: DrawerChat = {
                            ...current,
                            branch: current.branch || branch,
                            updated_at: nowIso,
                        }
                        if (!(current.title || "").trim() && preview) {
                            updated.title = preview
                        }
                        next.splice(idx, 1)
                        next.unshift(updated)
                        return { ...group, chats: dedupeChatsById(next) }
                    }
                    next.unshift({
                        chat_id: chatId,
                        project_id: projectId,
                        title: preview || `${projectLabel} / ${branch}`,
                        branch,
                        updated_at: nowIso,
                        created_at: nowIso,
                    })
                    return { ...group, chats: dedupeChatsById(next) }
                })
            )
        },
        [branch, projectId, projectLabel]
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
                setToolDryRun(Boolean(policy.dry_run))
                setRequireApprovalForWriteTools(Boolean(policy.require_approval_for_write_tools))
                setApprovedTools(approved)
            } catch (err) {
                setToolsError(errText(err))
            } finally {
                setToolsLoading(false)
            }
        },
        [projectId, userId]
    )

    const loadChatTasks = useCallback(async (chatId: string) => {
        setTasksLoading(true)
        setTasksError(null)
        try {
            const out = await backendJson<ChatTasksResponse>(
                `/api/chats/${encodeURIComponent(chatId)}/tasks?user=${encodeURIComponent(userId)}`
            )
            setTasks((out.items || []).filter((x) => x && x.id))
        } catch (err) {
            setTasksError(errText(err))
        } finally {
            setTasksLoading(false)
        }
    }, [userId])

    const openTasksDialog = useCallback(async () => {
        const chatId = selectedChatIdRef.current
        if (!chatId) return
        setTasksOpen(true)
        await loadChatTasks(chatId)
    }, [loadChatTasks])

    const createChatTask = useCallback(async (input: { title: string; details: string; assignee: string; due_date: string }) => {
        const chatId = selectedChatIdRef.current
        if (!chatId) return
        setTasksSaving(true)
        setTasksError(null)
        try {
            await backendJson(`/api/chats/${encodeURIComponent(chatId)}/tasks?user=${encodeURIComponent(userId)}`, {
                method: "POST",
                body: JSON.stringify({
                    title: input.title,
                    details: input.details,
                    assignee: input.assignee || null,
                    due_date: input.due_date || null,
                }),
            })
            await loadChatTasks(chatId)
        } catch (err) {
            setTasksError(errText(err))
        } finally {
            setTasksSaving(false)
        }
    }, [loadChatTasks, userId])

    const updateChatTask = useCallback(async (
        taskId: string,
        patch: { title?: string; details?: string; assignee?: string | null; due_date?: string | null; status?: string }
    ) => {
        const chatId = selectedChatIdRef.current
        if (!chatId) return
        setTasksSaving(true)
        setTasksError(null)
        try {
            await backendJson(
                `/api/chats/${encodeURIComponent(chatId)}/tasks/${encodeURIComponent(taskId)}?user=${encodeURIComponent(userId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify(patch),
                }
            )
            await loadChatTasks(chatId)
        } catch (err) {
            setTasksError(errText(err))
        } finally {
            setTasksSaving(false)
        }
    }, [loadChatTasks, userId])

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

    const buildLocalToolClaimPayload = useCallback(
        () => ({
            projectId,
            user: userId,
        }),
        [projectId, userId]
    )

    useLocalToolJobWorker({
        claimIdPrefix: `webchat-${projectId}`,
        buildClaimPayload: buildLocalToolClaimPayload,
    })

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
                await Promise.all([loadMessages(chatId), loadChatMemoryState(chatId, true)])
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
    }, [branch, ensureChat, loadChatMemoryState, loadMessages, selectedChatId])

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

    const onSelectChat = useCallback(
        (chat: DrawerChat, chatProjectId: string) => {
            const targetBranch = (chat.branch || branch || "main").trim() || "main"
            const path = buildChatPath(chatProjectId, targetBranch, chat.chat_id)
            saveLastChat({
                projectId: chatProjectId,
                branch: targetBranch,
                chatId: chat.chat_id,
                path,
                ts: Date.now(),
            })

            if (chatProjectId !== projectId) {
                router.push(path)
                return
            }

            setBranch(targetBranch)
            setSelectedChatId(chat.chat_id)
            setMessages([])
        },
        [branch, projectId, router]
    )

    const onNewChat = useCallback(() => {
        setNewChatError(null)
        setNewChatOpen(true)
    }, [])

    const createNewChat = useCallback(
        async (input: { projectId: string; branch: string; llmProfileId: string }) => {
            const targetProjectId = input.projectId
            const targetBranch = (input.branch || "main").trim() || "main"
            const chatId = makeChatId(targetProjectId, targetBranch, userId)
            setCreatingNewChat(true)
            setNewChatError(null)
            try {
                await backendJson<ChatResponse>("/api/chats/ensure", {
                    method: "POST",
                    body: JSON.stringify({
                        chat_id: chatId,
                        project_id: targetProjectId,
                        branch: targetBranch,
                        user: userId,
                        messages: [],
                    }),
                })

                if (input.llmProfileId.trim()) {
                    await backendJson<ChatLlmProfileResponse>(`/api/chats/${encodeURIComponent(chatId)}/llm-profile`, {
                        method: "PUT",
                        body: JSON.stringify({ llm_profile_id: input.llmProfileId.trim() }),
                    })
                }

                const path = buildChatPath(targetProjectId, targetBranch, chatId)
                saveLastChat({
                    projectId: targetProjectId,
                    branch: targetBranch,
                    chatId,
                    path,
                    ts: Date.now(),
                })
                setNewChatOpen(false)
                if (targetProjectId === projectId) {
                    setBranch(targetBranch)
                    setSelectedChatId(chatId)
                    setMessages([])
                    touchChatLocally(chatId, "")
                    await loadChats(targetBranch, chatId)
                }
                router.push(path)
            } catch (err) {
                setNewChatError(errText(err))
            } finally {
                setCreatingNewChat(false)
            }
        },
        [loadChats, projectId, router, touchChatLocally, userId]
    )

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
                dry_run: toolDryRun,
                require_approval_for_write_tools: requireApprovalForWriteTools,
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
    }, [requireApprovalForWriteTools, selectedChatId, toolCatalog, toolDryRun, toolEnabledSet, toolReadOnlyOnly])

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

            const userTs = new Date().toISOString()
            setSending(true)
            setError(null)
            setLastToolEvents([])
            if (opts?.clearComposer !== false) {
                setInput("")
            }
            setMessages((prev) => [...prev, { role: "user", content: optimisticUserText, ts: userTs }])
            touchChatLocally(selectedChatId, optimisticUserText)

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
                    const assistantText = String(res.answer || "").trim()
                    setMessages((prev) => [
                        ...prev,
                        {
                            role: "assistant",
                            content: res.answer || "",
                            ts: new Date().toISOString(),
                            meta: { sources: res.sources || [], grounded: res.grounded ?? undefined },
                        },
                    ])
                    touchChatLocally(selectedChatId, assistantText || optimisticUserText)
                }
                setLastToolEvents(res.tool_events || [])
                setChatMemory((res.memory_summary as ChatMemorySummary) || null)
                setChatTaskState((res.task_state as ChatTaskState) || null)
                setPendingUserQuestion((res.pending_user_question as PendingUserQuestion) || null)
                if (activePending) {
                    setPendingAnswerInput("")
                }
            } catch (err) {
                setError(errText(err))
            } finally {
                setSending(false)
            }
        },
        [
            branch,
            input,
            maybeAutoGenerateDocsFromQuestion,
            pendingUserQuestion,
            project?.repo_path,
            projectId,
            selectedChatId,
            selectedLlmProfileId,
            sending,
            touchChatLocally,
            userId,
        ]
    )

    const clearChat = useCallback(async () => {
        if (!selectedChatId) return
        setError(null)
        try {
            await backendJson(`/api/chats/${encodeURIComponent(selectedChatId)}/clear`, { method: "POST" })
            await Promise.all([loadMessages(selectedChatId), loadChatMemoryState(selectedChatId)])
            await loadChats(branch, selectedChatId)
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, loadChatMemoryState, loadChats, loadMessages, selectedChatId])

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
            chatGroups={chatGroups}
            selectedChatId={selectedChatId}
            onSelectChat={onSelectChat}
            onNewChat={onNewChat}
            onOpenSettings={() => setSettingsOpen(true)}
            user={me}
            loadingChats={loadingChats}
            activeSection="chat"
        >
            <Stack sx={{ minHeight: 0, flex: 1 }}>
                <ChatHeaderBar
                    projectLabel={projectLabel}
                    branch={branch}
                    llmSummary={llmSummary}
                    selectedLlmProfileId={selectedLlmProfileId}
                    projectDefaultLlmLabel={projectDefaultLlmLabel}
                    llmProfiles={llmProfiles}
                    savingLlmProfile={savingLlmProfile}
                    selectedChatId={selectedChatId}
                    enabledToolCount={enabledToolCount}
                    docsGenerating={docsGenerating}
                    booting={booting}
                    memoryHasItems={Boolean(selectedChatId)}
                    sessionMemoryOpen={sessionMemoryOpen}
                    onChangeLlmProfile={(next) => {
                        setSelectedLlmProfileId(next)
                        if (selectedChatId) {
                            void saveChatLlmProfile(selectedChatId, next)
                        }
                    }}
                    onOpenTools={() => void openToolDialog()}
                    onOpenTasks={() => void openTasksDialog()}
                    onOpenDocs={openDocumentationViewer}
                    onGenerateDocs={() => void generateDocumentation()}
                    onToggleSessionMemory={() => setSessionMemoryOpen((v) => !v)}
                />

                {error && (
                    <Box sx={{ px: { xs: 1, md: 2 }, pt: 0.7 }}>
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    </Box>
                )}
                {!!lastToolEvents?.length && !toolEventsDismissed && (
                    <ChatToolEventsBanner
                        events={lastToolEvents}
                        onDismiss={() => setToolEventsDismissed(true)}
                        onOpenTools={() => void openToolDialog()}
                    />
                )}
                {docsNotice && !docsOpen && (
                    <Box sx={{ px: { xs: 1, md: 2 }, pt: 0.7 }}>
                        <Alert severity="success" onClose={() => setDocsNotice(null)}>
                            {docsNotice}
                        </Alert>
                    </Box>
                )}
                {Boolean(selectedChatId) && sessionMemoryOpen && (
                    <ChatSessionMemoryPanel
                        chatMemory={chatMemory}
                        chatTaskState={chatTaskState}
                        onClose={() => setSessionMemoryOpen(false)}
                        onReset={() => void resetChatMemory()}
                        resetting={resettingMemory}
                        onSave={saveChatMemory}
                        saving={savingMemory}
                    />
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

                <ChatComposer
                    pendingUserQuestion={pendingUserQuestion}
                    pendingAnswerInput={pendingAnswerInput}
                    input={input}
                    sending={sending}
                    hasSelectedChat={Boolean(selectedChatId)}
                    onInputChange={setInput}
                    onPendingAnswerInputChange={setPendingAnswerInput}
                    onSend={() => void send()}
                    onClear={() => void clearChat()}
                    onSubmitPendingAnswer={(answer, pendingQuestionId) =>
                        void send({
                            question: answer,
                            pendingAnswer: answer,
                            pendingQuestionId,
                            clearComposer: false,
                        })
                    }
                />

                <ChatToolsDialog
                    open={toolsOpen}
                    chatId={selectedChatId}
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
                    onToggleToolEnabled={toggleToolEnabled}
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
                    onRefresh={async () => {
                        if (selectedChatId) {
                            await loadChatTasks(selectedChatId)
                        }
                    }}
                    onCreate={createChatTask}
                    onUpdateTask={updateChatTask}
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

                <NewChatDialog
                    open={newChatOpen}
                    projects={newChatProjectOptions}
                    llmProfiles={llmProfiles}
                    defaultProjectId={projectId}
                    defaultBranch={branch}
                    busy={creatingNewChat}
                    error={newChatError}
                    onClose={() => setNewChatOpen(false)}
                    onCreate={(input) => {
                        void createNewChat(input)
                    }}
                />

                <Dialog
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    fullWidth
                    maxWidth="xl"
                >
                    <AppDialogTitle title={`${projectLabel} Settings`} onClose={() => setSettingsOpen(false)} />
                    <DialogContent sx={{ p: 0, height: { xs: "76vh", md: "84vh" } }}>
                        <Box
                            component="iframe"
                            title={`${projectLabel} settings`}
                            src={`/projects/${encodeURIComponent(projectId)}/settings?embedded=1&branch=${encodeURIComponent(branch)}`}
                            sx={{
                                border: 0,
                                width: "100%",
                                height: "100%",
                                display: "block",
                                bgcolor: "background.default",
                            }}
                        />
                    </DialogContent>
                </Dialog>
            </Stack>
        </ProjectDrawerLayout>
    )
}
