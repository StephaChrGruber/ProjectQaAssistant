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
    Divider,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"
import PathPickerDialog from "@/components/PathPickerDialog"

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

type ConnectorDoc = {
    id?: string
    type: "confluence" | "jira" | "github"
    isEnabled: boolean
    config: Record<string, unknown>
}

type ConnectorsResponse = ConnectorDoc[]

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

type GitForm = {
    isEnabled: boolean
    owner: string
    repo: string
    branch: string
    token: string
    paths: string
}

type ConfluenceForm = {
    isEnabled: boolean
    baseUrl: string
    spaceKey: string
    email: string
    apiToken: string
}

type JiraForm = {
    isEnabled: boolean
    baseUrl: string
    email: string
    apiToken: string
    jql: string
}

type LlmProviderOption = {
    value: string
    label: string
    defaultBaseUrl: string
    requiresApiKey: boolean
}

type LlmOptionsResponse = {
    providers: LlmProviderOption[]
    ollama_models: string[]
    openai_models: string[]
    discovery_error?: string | null
}

const FALLBACK_OLLAMA_MODELS = ["llama3.2:3b", "llama3.1:8b", "mistral:7b", "qwen2.5:7b"]
const FALLBACK_OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"]

const DEFAULT_PROVIDER_OPTIONS: LlmProviderOption[] = [
    {
        value: "ollama",
        label: "Ollama (local)",
        defaultBaseUrl: "http://ollama:11434/v1",
        requiresApiKey: false,
    },
    {
        value: "openai",
        label: "ChatGPT / OpenAI API",
        defaultBaseUrl: "https://api.openai.com/v1",
        requiresApiKey: true,
    },
]

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

function asStr(v: unknown): string {
    return typeof v === "string" ? v : ""
}

function csvToList(v: string): string[] {
    return v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
}

function getConnector(connectors: ConnectorDoc[], type: ConnectorDoc["type"]): ConnectorDoc | undefined {
    return connectors.find((c) => c.type === type)
}

function emptyGit(branch = "main"): GitForm {
    return { isEnabled: true, owner: "", repo: "", branch, token: "", paths: "" }
}

function emptyConfluence(): ConfluenceForm {
    return { isEnabled: false, baseUrl: "", spaceKey: "", email: "", apiToken: "" }
}

function emptyJira(): JiraForm {
    return { isEnabled: false, baseUrl: "", email: "", apiToken: "", jql: "" }
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
    const [savingProject, setSavingProject] = useState(false)
    const [savingConnector, setSavingConnector] = useState(false)
    const [ingesting, setIngesting] = useState(false)

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

    const [gitForm, setGitForm] = useState<GitForm>(emptyGit())
    const [confluenceForm, setConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [jiraForm, setJiraForm] = useState<JiraForm>(emptyJira())

    const [llmOptions, setLlmOptions] = useState<LlmOptionsResponse | null>(null)
    const [loadingLlmOptions, setLoadingLlmOptions] = useState(false)
    const [llmOptionsError, setLlmOptionsError] = useState<string | null>(null)
    const [pathPickerOpen, setPathPickerOpen] = useState(false)

    const projectLabel = useMemo(
        () => project?.name || project?.key || projectId,
        [project?.name, project?.key, projectId]
    )
    const userId = useMemo(() => me?.email || "dev@local", [me])

    const providerOptions = useMemo(
        () => (llmOptions?.providers?.length ? llmOptions.providers : DEFAULT_PROVIDER_OPTIONS),
        [llmOptions]
    )

    function defaultBaseUrlForProvider(provider: string): string {
        const found = providerOptions.find((item) => item.value === provider)
        if (found?.defaultBaseUrl) return found.defaultBaseUrl
        return provider === "openai" ? "https://api.openai.com/v1" : "http://ollama:11434/v1"
    }

    function defaultModelsForProvider(provider: string): string[] {
        if (provider === "openai") {
            return llmOptions?.openai_models?.length ? llmOptions.openai_models : FALLBACK_OPENAI_MODELS
        }
        return llmOptions?.ollama_models?.length ? llmOptions.ollama_models : FALLBACK_OLLAMA_MODELS
    }

    function modelOptionsForProvider(provider: string, current?: string): string[] {
        const opts = [...defaultModelsForProvider(provider)]
        if (current?.trim() && !opts.includes(current.trim())) {
            opts.unshift(current.trim())
        }
        return Array.from(new Set(opts))
    }

    const editModelOptions = useMemo(
        () => modelOptionsForProvider(editForm.llm_provider, editForm.llm_model),
        [editForm.llm_provider, editForm.llm_model, llmOptions]
    )

    function applyProviderChange(nextProvider: string) {
        setEditForm((prev) => {
            const oldProvider = prev.llm_provider || "ollama"
            const oldDefaultBase = defaultBaseUrlForProvider(oldProvider)
            const nextDefaultBase = defaultBaseUrlForProvider(nextProvider)
            const nextBaseUrl =
                !prev.llm_base_url.trim() || prev.llm_base_url.trim() === oldDefaultBase
                    ? nextDefaultBase
                    : prev.llm_base_url

            const nextModelOptions = modelOptionsForProvider(nextProvider, prev.llm_model)
            const nextModel =
                prev.llm_model && nextModelOptions.includes(prev.llm_model)
                    ? prev.llm_model
                    : (nextModelOptions[0] || "")

            let nextApiKey = prev.llm_api_key
            if (nextProvider === "openai" && nextApiKey.trim() === "ollama") {
                nextApiKey = ""
            } else if (nextProvider === "ollama" && !nextApiKey.trim()) {
                nextApiKey = "ollama"
            }

            return {
                ...prev,
                llm_provider: nextProvider,
                llm_base_url: nextBaseUrl,
                llm_model: nextModel,
                llm_api_key: nextApiKey,
            }
        })
    }

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

    async function loadLlmOptions() {
        setLoadingLlmOptions(true)
        try {
            const options = await backendJson<LlmOptionsResponse>("/api/admin/llm/options")
            setLlmOptions(options)
            setLlmOptionsError(options.discovery_error || null)
        } catch (err) {
            setLlmOptions(null)
            setLlmOptionsError(errText(err))
        } finally {
            setLoadingLlmOptions(false)
        }
    }

    async function loadConnectors(defaultBranch: string) {
        const connectors = await backendJson<ConnectorsResponse>(`/api/admin/projects/${projectId}/connectors`)
        const git = getConnector(connectors, "github")
        const confluence = getConnector(connectors, "confluence")
        const jira = getConnector(connectors, "jira")

        setGitForm({
            isEnabled: git?.isEnabled ?? true,
            owner: asStr(git?.config?.owner),
            repo: asStr(git?.config?.repo),
            branch: asStr(git?.config?.branch) || defaultBranch,
            token: asStr(git?.config?.token),
            paths: Array.isArray(git?.config?.paths) ? (git?.config?.paths as string[]).join(", ") : "",
        })
        setConfluenceForm({
            isEnabled: confluence?.isEnabled ?? false,
            baseUrl: asStr(confluence?.config?.baseUrl),
            spaceKey: asStr(confluence?.config?.spaceKey),
            email: asStr(confluence?.config?.email),
            apiToken: asStr(confluence?.config?.apiToken),
        })
        setJiraForm({
            isEnabled: jira?.isEnabled ?? false,
            baseUrl: asStr(jira?.config?.baseUrl),
            email: asStr(jira?.config?.email),
            apiToken: asStr(jira?.config?.apiToken),
            jql: asStr(jira?.config?.jql),
        })
    }

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

                const provider = projectRes.llm_provider || "ollama"
                const defaultBase = defaultBaseUrlForProvider(provider)
                const defaultModel = modelOptionsForProvider(provider, projectRes.llm_model)[0] || ""
                setEditForm({
                    name: projectRes.name || "",
                    description: projectRes.description || "",
                    repo_path: projectRes.repo_path || "",
                    default_branch: projectRes.default_branch || "main",
                    llm_provider: provider,
                    llm_base_url: projectRes.llm_base_url || defaultBase,
                    llm_model: projectRes.llm_model || defaultModel,
                    llm_api_key: projectRes.llm_api_key || (provider === "ollama" ? "ollama" : ""),
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

                if (meRes.user?.isGlobalAdmin) {
                    await Promise.all([
                        loadLlmOptions(),
                        loadConnectors(projectRes.default_branch || "main"),
                    ])
                }
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
        setSavingProject(true)
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
            setSavingProject(false)
        }
    }

    async function saveConnector(type: "git" | "confluence" | "jira") {
        if (!me?.isGlobalAdmin) return
        setSavingConnector(true)
        setError(null)
        setNotice(null)
        try {
            if (type === "git") {
                await backendJson(`/api/admin/projects/${projectId}/connectors/git`, {
                    method: "PUT",
                    body: JSON.stringify({
                        isEnabled: gitForm.isEnabled,
                        config: {
                            owner: gitForm.owner.trim(),
                            repo: gitForm.repo.trim(),
                            branch: gitForm.branch.trim() || "main",
                            token: gitForm.token.trim(),
                            paths: csvToList(gitForm.paths),
                        },
                    }),
                })
            } else if (type === "confluence") {
                await backendJson(`/api/admin/projects/${projectId}/connectors/confluence`, {
                    method: "PUT",
                    body: JSON.stringify({
                        isEnabled: confluenceForm.isEnabled,
                        config: {
                            baseUrl: confluenceForm.baseUrl.trim(),
                            spaceKey: confluenceForm.spaceKey.trim(),
                            email: confluenceForm.email.trim(),
                            apiToken: confluenceForm.apiToken.trim(),
                        },
                    }),
                })
            } else {
                await backendJson(`/api/admin/projects/${projectId}/connectors/jira`, {
                    method: "PUT",
                    body: JSON.stringify({
                        isEnabled: jiraForm.isEnabled,
                        config: {
                            baseUrl: jiraForm.baseUrl.trim(),
                            email: jiraForm.email.trim(),
                            apiToken: jiraForm.apiToken.trim(),
                            jql: jiraForm.jql.trim(),
                        },
                    }),
                })
            }
            setNotice(`${type.toUpperCase()} connector saved.`)
        } catch (err) {
            setError(errText(err))
        } finally {
            setSavingConnector(false)
        }
    }

    async function runIngest() {
        if (!me?.isGlobalAdmin) return
        setIngesting(true)
        setError(null)
        setNotice(null)
        try {
            const out = await backendJson<{ totalDocs?: number; totalChunks?: number; errors?: Record<string, string> }>(
                `/api/admin/projects/${projectId}/ingest`,
                { method: "POST" }
            )
            const errCount = Object.keys(out.errors || {}).length
            setNotice(
                `Ingestion finished. Docs: ${out.totalDocs || 0}, chunks: ${out.totalChunks || 0}, source errors: ${errCount}.`
            )
        } catch (err) {
            setError(errText(err))
        } finally {
            setIngesting(false)
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
                                Review and configure this project's assistant behavior.
                            </Typography>
                        </CardContent>
                    </Card>

                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="success">{notice}</Alert>}

                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                Project Snapshot
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
                                <DetailCard title="LLM Provider" value={project?.llm_provider || "default"} />
                                <DetailCard title="LLM Model" value={project?.llm_model || "backend default"} />
                                <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                    <DetailCard title="LLM Base URL" value={project?.llm_base_url || "backend default"} />
                                </Box>
                                <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                    <DetailCard title="LLM API Key" value={maskSecret(project?.llm_api_key)} />
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>

                    {!me?.isGlobalAdmin && (
                        <Card variant="outlined">
                            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                    Sources
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                    Source connectors are managed by a global admin.
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
                                    <Button component={Link} href="/admin" variant="outlined" endIcon={<OpenInNewRounded />}>
                                        Open Admin Workflow
                                    </Button>
                                </Stack>
                            </CardContent>
                        </Card>
                    )}

                    {me?.isGlobalAdmin && (
                        <>
                            <Card variant="outlined">
                                <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                        Edit Project Settings
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                                        Includes the same project + LLM configuration fields as admin workflow.
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
                                        <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                            <Button variant="outlined" onClick={() => setPathPickerOpen(true)}>
                                                Browse Path
                                            </Button>
                                        </Box>

                                        <FormControl fullWidth size="small">
                                            <InputLabel id="project-settings-llm-provider">LLM Provider</InputLabel>
                                            <Select
                                                labelId="project-settings-llm-provider"
                                                label="LLM Provider"
                                                value={editForm.llm_provider}
                                                onChange={(e) => applyProviderChange(e.target.value)}
                                            >
                                                {providerOptions.map((option) => (
                                                    <MenuItem key={option.value} value={option.value}>
                                                        {option.label}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <FormControl fullWidth size="small">
                                            <InputLabel id="project-settings-llm-model">LLM Model</InputLabel>
                                            <Select
                                                labelId="project-settings-llm-model"
                                                label="LLM Model"
                                                value={editForm.llm_model}
                                                onChange={(e) => setEditForm((f) => ({ ...f, llm_model: e.target.value }))}
                                            >
                                                {editModelOptions.map((model) => (
                                                    <MenuItem key={model} value={model}>
                                                        {model}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <TextField
                                            label="Custom Model ID (optional)"
                                            value={editForm.llm_model}
                                            onChange={(e) => setEditForm((f) => ({ ...f, llm_model: e.target.value }))}
                                            fullWidth
                                            helperText="Override with any OpenAI-compatible model ID."
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
                                            helperText={
                                                editForm.llm_provider === "openai"
                                                    ? "Required for ChatGPT API."
                                                    : "Usually 'ollama' for local models."
                                            }
                                        />
                                    </Box>

                                    <Stack direction="row" spacing={1} sx={{ mt: 1.6 }}>
                                        <Button
                                            variant="contained"
                                            startIcon={<SaveRounded />}
                                            onClick={() => void onSaveProjectSettings()}
                                            disabled={savingProject || savingConnector || ingesting}
                                        >
                                            Save Project
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            startIcon={<RefreshRounded />}
                                            onClick={() => void loadLlmOptions()}
                                            disabled={loadingLlmOptions || savingProject || savingConnector || ingesting}
                                        >
                                            {loadingLlmOptions ? "Refreshing Models..." : "Refresh Models"}
                                        </Button>
                                    </Stack>

                                    {llmOptionsError && (
                                        <Alert severity="warning" sx={{ mt: 1.3 }}>
                                            Model discovery warning: {llmOptionsError}
                                        </Alert>
                                    )}
                                </CardContent>
                            </Card>

                            <Card variant="outlined">
                                <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                        Source Connectors
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
                                        Configure Git, Confluence, and Jira connectors directly here.
                                    </Typography>

                                    <Box
                                        sx={{
                                            mt: 1.5,
                                            display: "grid",
                                            gap: 1.2,
                                            gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0,1fr))" },
                                        }}
                                    >
                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Git Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={gitForm.isEnabled}
                                                                onChange={(e) => setGitForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Owner"
                                                        value={gitForm.owner}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, owner: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Repo"
                                                        value={gitForm.repo}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={gitForm.branch}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, branch: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Token"
                                                        value={gitForm.token}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, token: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={gitForm.paths}
                                                        onChange={(e) => setGitForm((f) => ({ ...f, paths: e.target.value }))}
                                                        placeholder="src, docs"
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("git")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Git
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Confluence Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={confluenceForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setConfluenceForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                                                }
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Base URL"
                                                        value={confluenceForm.baseUrl}
                                                        onChange={(e) =>
                                                            setConfluenceForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                        }
                                                        placeholder="https://your-domain.atlassian.net/wiki"
                                                    />
                                                    <TextField
                                                        label="Space Key"
                                                        value={confluenceForm.spaceKey}
                                                        onChange={(e) =>
                                                            setConfluenceForm((f) => ({ ...f, spaceKey: e.target.value }))
                                                        }
                                                    />
                                                    <TextField
                                                        label="Email"
                                                        value={confluenceForm.email}
                                                        onChange={(e) => setConfluenceForm((f) => ({ ...f, email: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="API Token"
                                                        value={confluenceForm.apiToken}
                                                        onChange={(e) =>
                                                            setConfluenceForm((f) => ({ ...f, apiToken: e.target.value }))
                                                        }
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("confluence")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Confluence
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>

                                        <Card variant="outlined">
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Stack spacing={1.1}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                        Jira Source
                                                    </Typography>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={jiraForm.isEnabled}
                                                                onChange={(e) => setJiraForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                                            />
                                                        }
                                                        label="Enabled"
                                                    />
                                                    <TextField
                                                        label="Base URL"
                                                        value={jiraForm.baseUrl}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))}
                                                        placeholder="https://your-domain.atlassian.net"
                                                    />
                                                    <TextField
                                                        label="Email"
                                                        value={jiraForm.email}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, email: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="API Token"
                                                        value={jiraForm.apiToken}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, apiToken: e.target.value }))}
                                                    />
                                                    <TextField
                                                        label="JQL"
                                                        value={jiraForm.jql}
                                                        onChange={(e) => setJiraForm((f) => ({ ...f, jql: e.target.value }))}
                                                        placeholder="project = CORE ORDER BY updated DESC"
                                                    />
                                                    <Button
                                                        variant="outlined"
                                                        onClick={() => void saveConnector("jira")}
                                                        disabled={savingConnector || savingProject || ingesting}
                                                    >
                                                        Save Jira
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>
                                    </Box>

                                    <Divider sx={{ my: 1.5 }} />

                                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                                        <Typography variant="body2" color="text.secondary">
                                            After changing sources, run ingestion to refresh indexed context.
                                        </Typography>
                                        <Button
                                            variant="contained"
                                            color="success"
                                            startIcon={<CloudUploadRounded />}
                                            onClick={() => void runIngest()}
                                            disabled={ingesting || savingConnector || savingProject}
                                        >
                                            Run Ingestion
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </Stack>

                <PathPickerDialog
                    open={pathPickerOpen}
                    title="Pick Repository Folder"
                    initialPath={editForm.repo_path}
                    onClose={() => setPathPickerOpen(false)}
                    onPick={(path) => {
                        setEditForm((f) => ({ ...f, repo_path: path }))
                        setPathPickerOpen(false)
                    }}
                />
            </Box>
        </ProjectDrawerLayout>
    )
}
