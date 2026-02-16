"use client"

import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    Chip,
    Container,
    Divider,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    InputLabel,
    LinearProgress,
    MenuItem,
    Paper,
    Select,
    Stack,
    Step,
    StepButton,
    Stepper,
    Switch,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material"
import AddRounded from "@mui/icons-material/AddRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import DeleteForeverRounded from "@mui/icons-material/DeleteForeverRounded"
import { backendJson } from "@/lib/backend"

type MeUser = {
    id?: string
    email?: string
    displayName?: string
    isGlobalAdmin?: boolean
}

type MeResponse = {
    user?: MeUser
}

type ConnectorDoc = {
    id?: string
    type: "confluence" | "jira" | "github"
    isEnabled: boolean
    config: Record<string, unknown>
}

type AdminProject = {
    id: string
    key: string
    name: string
    description?: string
    repo_path?: string
    default_branch?: string
    llm_provider?: string
    llm_base_url?: string
    llm_model?: string
    llm_api_key?: string
    connectors?: ConnectorDoc[]
}

type ProjectForm = {
    key: string
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

const CREATE_STEPS = ["Project", "LLM", "Sources", "Review"] as const
const FALLBACK_OLLAMA_MODELS = ["llama3.2:3b", "llama3.1:8b", "mistral:7b", "qwen2.5:7b"]
const FALLBACK_OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"]

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

type DeleteProjectResponse = {
    projectId: string
    projectKey?: string
    deleted?: Record<string, number>
    chroma?: {
        path?: string
        deleted?: boolean
        error?: string | null
    }
}

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

function emptyProjectForm(): ProjectForm {
    return {
        key: "",
        name: "",
        description: "",
        repo_path: "",
        default_branch: "main",
        llm_provider: "ollama",
        llm_base_url: "http://ollama:11434/v1",
        llm_model: "llama3.2:3b",
        llm_api_key: "ollama",
    }
}

function emptyGit(): GitForm {
    return { isEnabled: true, owner: "", repo: "", branch: "main", token: "", paths: "" }
}

function emptyConfluence(): ConfluenceForm {
    return { isEnabled: false, baseUrl: "", spaceKey: "", email: "", apiToken: "" }
}

function emptyJira(): JiraForm {
    return { isEnabled: false, baseUrl: "", email: "", apiToken: "", jql: "" }
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

function csvToList(v: string): string[] {
    return v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
}

function asStr(v: unknown): string {
    return typeof v === "string" ? v : ""
}

function getConnector(project: AdminProject | undefined, type: ConnectorDoc["type"]): ConnectorDoc | undefined {
    return project?.connectors?.find((c) => c.type === type)
}

function connectorPayloads(git: GitForm, confluence: ConfluenceForm, jira: JiraForm) {
    return {
        git: {
            isEnabled: git.isEnabled,
            config: {
                owner: git.owner.trim(),
                repo: git.repo.trim(),
                branch: git.branch.trim() || "main",
                token: git.token.trim(),
                paths: csvToList(git.paths),
            },
        },
        confluence: {
            isEnabled: confluence.isEnabled,
            config: {
                baseUrl: confluence.baseUrl.trim(),
                spaceKey: confluence.spaceKey.trim(),
                email: confluence.email.trim(),
                apiToken: confluence.apiToken.trim(),
            },
        },
        jira: {
            isEnabled: jira.isEnabled,
            config: {
                baseUrl: jira.baseUrl.trim(),
                email: jira.email.trim(),
                apiToken: jira.apiToken.trim(),
                jql: jira.jql.trim(),
            },
        },
    }
}

export default function AdminPage() {
    const theme = useTheme()
    const compactWizard = useMediaQuery(theme.breakpoints.down("sm"))

    const [me, setMe] = useState<MeUser | null>(null)
    const [projects, setProjects] = useState<AdminProject[]>([])
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const [wizardStep, setWizardStep] = useState(0)
    const [ingestOnCreate, setIngestOnCreate] = useState(false)
    const [llmOptions, setLlmOptions] = useState<LlmOptionsResponse | null>(null)
    const [loadingLlmOptions, setLoadingLlmOptions] = useState(false)
    const [llmOptionsError, setLlmOptionsError] = useState<string | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleteConfirmKey, setDeleteConfirmKey] = useState("")

    const [createForm, setCreateForm] = useState<ProjectForm>(emptyProjectForm())
    const [createGitForm, setCreateGitForm] = useState<GitForm>(emptyGit())
    const [createConfluenceForm, setCreateConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [createJiraForm, setCreateJiraForm] = useState<JiraForm>(emptyJira())

    const [editForm, setEditForm] = useState<ProjectForm>(emptyProjectForm())
    const [gitForm, setGitForm] = useState<GitForm>(emptyGit())
    const [confluenceForm, setConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [jiraForm, setJiraForm] = useState<JiraForm>(emptyJira())

    const selectedProject = useMemo(
        () => projects.find((p) => p.id === selectedProjectId),
        [projects, selectedProjectId]
    )

    const basicsValid = useMemo(
        () => Boolean(createForm.key.trim() && createForm.name.trim()),
        [createForm.key, createForm.name]
    )

    const llmValid = useMemo(
        () => Boolean(createForm.llm_provider.trim() && createForm.llm_model.trim()),
        [createForm.llm_provider, createForm.llm_model]
    )

    const stepStatus = useMemo(
        () => [true, basicsValid, basicsValid && llmValid, basicsValid && llmValid],
        [basicsValid, llmValid]
    )

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

    const createModelOptions = useMemo(
        () => modelOptionsForProvider(createForm.llm_provider, createForm.llm_model),
        [createForm.llm_provider, createForm.llm_model, llmOptions]
    )

    const editModelOptions = useMemo(
        () => modelOptionsForProvider(editForm.llm_provider, editForm.llm_model),
        [editForm.llm_provider, editForm.llm_model, llmOptions]
    )

    async function refreshProjects(preferredProjectId?: string) {
        const all = await backendJson<AdminProject[]>("/api/admin/projects")
        setProjects(all)
        setSelectedProjectId((prev) => {
            if (preferredProjectId && all.some((p) => p.id === preferredProjectId)) return preferredProjectId
            if (prev && all.some((p) => p.id === prev)) return prev
            return all[0]?.id || null
        })
    }

    async function putConnector(
        projectId: string,
        type: "git" | "confluence" | "jira",
        payload: Record<string, unknown>
    ) {
        await backendJson(`/api/admin/projects/${projectId}/connectors/${type}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        })
    }

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

    function applyProviderChange(
        setForm: Dispatch<SetStateAction<ProjectForm>>,
        nextProvider: string
    ) {
        setForm((prev) => {
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

    useEffect(() => {
        let cancelled = false

        async function boot() {
            setLoading(true)
            setError(null)
            try {
                const meRes = await backendJson<MeResponse>("/api/me")
                if (cancelled) return
                setMe(meRes.user || null)
                await Promise.all([refreshProjects(), loadLlmOptions()])
            } catch (err) {
                if (!cancelled) setError(errText(err))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void boot()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        const p = selectedProject
        if (!p) {
            setEditForm(emptyProjectForm())
            setGitForm(emptyGit())
            setConfluenceForm(emptyConfluence())
            setJiraForm(emptyJira())
            return
        }

        setEditForm({
            key: p.key || "",
            name: p.name || "",
            description: p.description || "",
            repo_path: p.repo_path || "",
            default_branch: p.default_branch || "main",
            llm_provider: p.llm_provider || "ollama",
            llm_base_url: p.llm_base_url || defaultBaseUrlForProvider(p.llm_provider || "ollama"),
            llm_model: p.llm_model || modelOptionsForProvider(p.llm_provider || "ollama")[0] || "",
            llm_api_key: p.llm_api_key || ((p.llm_provider || "ollama") === "ollama" ? "ollama" : ""),
        })

        const g = getConnector(p, "github")
        const c = getConnector(p, "confluence")
        const j = getConnector(p, "jira")

        setGitForm({
            isEnabled: g?.isEnabled ?? true,
            owner: asStr(g?.config?.owner),
            repo: asStr(g?.config?.repo),
            branch: asStr(g?.config?.branch) || p.default_branch || "main",
            token: asStr(g?.config?.token),
            paths: Array.isArray(g?.config?.paths) ? (g?.config?.paths as string[]).join(", ") : "",
        })

        setConfluenceForm({
            isEnabled: c?.isEnabled ?? false,
            baseUrl: asStr(c?.config?.baseUrl),
            spaceKey: asStr(c?.config?.spaceKey),
            email: asStr(c?.config?.email),
            apiToken: asStr(c?.config?.apiToken),
        })

        setJiraForm({
            isEnabled: j?.isEnabled ?? false,
            baseUrl: asStr(j?.config?.baseUrl),
            email: asStr(j?.config?.email),
            apiToken: asStr(j?.config?.apiToken),
            jql: asStr(j?.config?.jql),
        })
    }, [selectedProject, llmOptions])

    function resetCreateWorkflow() {
        setCreateForm(emptyProjectForm())
        setCreateGitForm(emptyGit())
        setCreateConfluenceForm(emptyConfluence())
        setCreateJiraForm(emptyJira())
        setWizardStep(0)
        setIngestOnCreate(false)
    }

    function canOpenStep(target: number): boolean {
        if (target <= 0) return true
        if (target === 1) return basicsValid
        if (target === 2) return basicsValid && llmValid
        return basicsValid && llmValid
    }

    async function createProjectFromWizard() {
        if (!basicsValid || !llmValid) {
            setError("Please complete project and LLM details before creating the project.")
            return
        }

        setBusy(true)
        setError(null)
        setNotice(null)

        try {
            const created = await backendJson<AdminProject>("/api/admin/projects", {
                method: "POST",
                body: JSON.stringify({
                    key: createForm.key.trim(),
                    name: createForm.name.trim(),
                    description: createForm.description.trim() || null,
                    repo_path: createForm.repo_path.trim() || null,
                    default_branch: createForm.default_branch.trim() || "main",
                    llm_provider: createForm.llm_provider || null,
                    llm_base_url: createForm.llm_base_url.trim() || null,
                    llm_model: createForm.llm_model.trim() || null,
                    llm_api_key: createForm.llm_api_key.trim() || null,
                }),
            })

            const payloads = connectorPayloads(createGitForm, createConfluenceForm, createJiraForm)
            await Promise.all([
                putConnector(created.id, "git", payloads.git),
                putConnector(created.id, "confluence", payloads.confluence),
                putConnector(created.id, "jira", payloads.jira),
            ])

            if (ingestOnCreate) {
                await backendJson(`/api/admin/projects/${created.id}/ingest`, { method: "POST" })
            }

            await refreshProjects(created.id)
            resetCreateWorkflow()

            setNotice(
                ingestOnCreate
                    ? `Project ${created.key} created, sources configured, and ingestion started.`
                    : `Project ${created.key} created and sources configured.`
            )
        } catch (err) {
            setError(errText(err))
        } finally {
            setBusy(false)
        }
    }

    async function onSaveProject(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!selectedProjectId) return

        setBusy(true)
        setError(null)
        setNotice(null)

        try {
            await backendJson<AdminProject>(`/api/admin/projects/${selectedProjectId}`, {
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
            await refreshProjects(selectedProjectId)
            setNotice("Project settings saved.")
        } catch (err) {
            setError(errText(err))
        } finally {
            setBusy(false)
        }
    }

    async function saveConnector(type: "git" | "confluence" | "jira") {
        if (!selectedProjectId) return

        setBusy(true)
        setError(null)
        setNotice(null)

        try {
            const payloads = connectorPayloads(gitForm, confluenceForm, jiraForm)

            if (type === "git") {
                await putConnector(selectedProjectId, "git", payloads.git)
            }
            if (type === "confluence") {
                await putConnector(selectedProjectId, "confluence", payloads.confluence)
            }
            if (type === "jira") {
                await putConnector(selectedProjectId, "jira", payloads.jira)
            }

            await refreshProjects(selectedProjectId)
            setNotice(`${type.toUpperCase()} connector saved.`)
        } catch (err) {
            setError(errText(err))
        } finally {
            setBusy(false)
        }
    }

    async function runIngest(projectId: string) {
        setBusy(true)
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
            setBusy(false)
        }
    }

    async function deleteSelectedProject() {
        if (!selectedProject || !selectedProjectId) return
        const expectedKey = selectedProject.key.trim()
        if (deleteConfirmKey.trim() !== expectedKey) {
            setError(`Type "${expectedKey}" to confirm deletion.`)
            return
        }

        setBusy(true)
        setError(null)
        setNotice(null)

        try {
            const out = await backendJson<DeleteProjectResponse>(`/api/admin/projects/${selectedProjectId}`, {
                method: "DELETE",
            })
            await refreshProjects()
            setDeleteDialogOpen(false)
            setDeleteConfirmKey("")

            const deletedChats = out.deleted?.chats || 0
            const deletedChunks = out.deleted?.chunks || 0
            const chromaMsg = out.chroma?.deleted ? " Chroma index removed." : ""
            const chromaWarn = out.chroma?.error ? ` Chroma cleanup warning: ${out.chroma.error}` : ""
            setNotice(
                `Project ${out.projectKey || expectedKey} deleted. Chats removed: ${deletedChats}, chunks removed: ${deletedChunks}.${chromaMsg}${chromaWarn}`
            )
        } catch (err) {
            setError(errText(err))
        } finally {
            setBusy(false)
        }
    }

    if (loading) {
        return (
            <Box sx={{ minHeight: "100vh", py: 8 }}>
                <Container maxWidth="md">
                    <Paper variant="outlined" sx={{ p: 3 }}>
                        <Typography variant="h6">Loading admin workspace...</Typography>
                    </Paper>
                </Container>
            </Box>
        )
    }

    if (!me?.isGlobalAdmin) {
        return (
            <Box sx={{ minHeight: "100vh", py: 8 }}>
                <Container maxWidth="md">
                    <Paper variant="outlined" sx={{ p: 4 }}>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            Admin access required
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                            This page needs global admin privileges. Switch to an admin identity or enable dev admin mode.
                        </Typography>
                        <Button component={Link} href="/projects" variant="contained" sx={{ mt: 3 }}>
                            Back to projects
                        </Button>
                    </Paper>
                </Container>
            </Box>
        )
    }

    return (
        <Box sx={{ minHeight: "100vh", py: { xs: 2, md: 3 } }}>
            <Container maxWidth="xl">
                <Stack spacing={{ xs: 2, md: 2.5 }}>
                    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
                        <Stack
                            direction={{ xs: "column", md: "row" }}
                            spacing={2}
                            alignItems={{ xs: "flex-start", md: "center" }}
                            justifyContent="space-between"
                        >
                            <Box>
                                <Typography variant="overline" color="primary.light" sx={{ letterSpacing: "0.14em" }}>
                                    Admin Workflow
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5, fontSize: { xs: "1.6rem", md: "2.1rem" } }}>
                                    Project + Source Configuration
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                    Create projects, configure Git/Confluence/Jira sources, choose model provider, and run
                                    ingestion.
                                </Typography>
                            </Box>

                            <Button
                                component={Link}
                                href="/projects"
                                variant="outlined"
                                startIcon={<ArrowBackRounded />}
                            >
                                Back to projects
                            </Button>
                        </Stack>
                    </Paper>

                    {busy && <LinearProgress />}
                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="success">{notice}</Alert>}

                    <Box
                        sx={{
                            display: "grid",
                            gap: 2.5,
                            gridTemplateColumns: {
                                xs: "1fr",
                                xl: "minmax(360px, 420px) minmax(0, 1fr)",
                            },
                        }}
                    >
                        <Card variant="outlined">
                            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                <Stack spacing={{ xs: 2, md: 2.5 }}>
                                    <Box>
                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                            New Project Wizard
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                            Click through each step to set up project metadata, model config, and sources.
                                        </Typography>
                                    </Box>

                                    <Stepper
                                        nonLinear
                                        activeStep={wizardStep}
                                        alternativeLabel={!compactWizard}
                                        orientation={compactWizard ? "vertical" : "horizontal"}
                                        sx={{
                                            "& .MuiStepLabel-label": {
                                                fontSize: { xs: "0.8rem", sm: "0.9rem" },
                                            },
                                        }}
                                    >
                                        {CREATE_STEPS.map((label, index) => (
                                            <Step key={label} completed={index < wizardStep && stepStatus[index]}>
                                                <StepButton
                                                    color="inherit"
                                                    onClick={() => {
                                                        if (canOpenStep(index)) {
                                                            setWizardStep(index)
                                                        }
                                                    }}
                                                    disabled={!canOpenStep(index)}
                                                >
                                                    {label}
                                                </StepButton>
                                            </Step>
                                        ))}
                                    </Stepper>

                                    {wizardStep === 0 && (
                                        <Stack spacing={1.5}>
                                            <TextField
                                                label="Project Key"
                                                value={createForm.key}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value }))}
                                                placeholder="qa-assist"
                                                required
                                                fullWidth
                                                size="small"
                                            />
                                            <TextField
                                                label="Project Name"
                                                value={createForm.name}
                                                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                                                placeholder="QA Assistant"
                                                required
                                                fullWidth
                                                size="small"
                                            />
                                            <TextField
                                                label="Description"
                                                value={createForm.description}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, description: e.target.value }))
                                                }
                                                multiline
                                                minRows={3}
                                                fullWidth
                                                size="small"
                                            />
                                            <TextField
                                                label="Local Repo Path"
                                                value={createForm.repo_path}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, repo_path: e.target.value }))
                                                }
                                                placeholder="/workspace/repo"
                                                fullWidth
                                                size="small"
                                            />
                                            <TextField
                                                label="Default Branch"
                                                value={createForm.default_branch}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, default_branch: e.target.value }))
                                                }
                                                placeholder="main"
                                                fullWidth
                                                size="small"
                                            />
                                        </Stack>
                                    )}

                                    {wizardStep === 1 && (
                                        <Stack spacing={1.5}>
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-provider-label">Provider</InputLabel>
                                                <Select
                                                    labelId="create-llm-provider-label"
                                                    value={createForm.llm_provider}
                                                    label="Provider"
                                                    onChange={(e) => applyProviderChange(setCreateForm, e.target.value)}
                                                >
                                                    {providerOptions.map((option) => (
                                                        <MenuItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>

                                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                                <Typography variant="caption" color="text.secondary">
                                                    {createForm.llm_provider === "ollama"
                                                        ? "Choose from discovered local Ollama models."
                                                        : "Use ChatGPT model IDs through OpenAI-compatible API."}
                                                </Typography>
                                                <Button
                                                    variant="text"
                                                    size="small"
                                                    onClick={() => void loadLlmOptions()}
                                                    disabled={loadingLlmOptions}
                                                >
                                                    {loadingLlmOptions ? "Refreshing..." : "Refresh models"}
                                                </Button>
                                            </Stack>

                                            {llmOptionsError && (
                                                <Alert severity="warning">
                                                    Model discovery warning: {llmOptionsError}
                                                </Alert>
                                            )}

                                            <TextField
                                                label="Base URL"
                                                value={createForm.llm_base_url}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, llm_base_url: e.target.value }))
                                                }
                                                placeholder={defaultBaseUrlForProvider(createForm.llm_provider)}
                                                fullWidth
                                                size="small"
                                            />

                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-model-label">Model</InputLabel>
                                                <Select
                                                    labelId="create-llm-model-label"
                                                    label="Model"
                                                    value={createForm.llm_model}
                                                    onChange={(e) =>
                                                        setCreateForm((f) => ({ ...f, llm_model: e.target.value }))
                                                    }
                                                >
                                                    {createModelOptions.map((model) => (
                                                        <MenuItem key={model} value={model}>
                                                            {model}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>

                                            <TextField
                                                label="Custom Model ID (optional)"
                                                value={createForm.llm_model}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, llm_model: e.target.value }))
                                                }
                                                placeholder="e.g. llama3.2:3b or gpt-4o-mini"
                                                fullWidth
                                                size="small"
                                                helperText="You can type any OpenAI-compatible model ID."
                                            />

                                            <TextField
                                                label="API Key"
                                                value={createForm.llm_api_key}
                                                onChange={(e) =>
                                                    setCreateForm((f) => ({ ...f, llm_api_key: e.target.value }))
                                                }
                                                placeholder={createForm.llm_provider === "openai" ? "sk-..." : "ollama"}
                                                fullWidth
                                                size="small"
                                                helperText={
                                                    createForm.llm_provider === "openai"
                                                        ? "Required for ChatGPT API."
                                                        : "For local Ollama this can stay as 'ollama'."
                                                }
                                            />
                                        </Stack>
                                    )}

                                    {wizardStep === 2 && (
                                        <Stack spacing={1.5}>
                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1.2}>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={createGitForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setCreateGitForm((f) => ({
                                                                        ...f,
                                                                        isEnabled: e.target.checked,
                                                                    }))
                                                                }
                                                            />
                                                        }
                                                        label="Enable Git source"
                                                    />
                                                    <TextField
                                                        label="Owner"
                                                        value={createGitForm.owner}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, owner: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Repository"
                                                        value={createGitForm.repo}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, repo: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createGitForm.branch}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, branch: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Token"
                                                        value={createGitForm.token}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, token: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={createGitForm.paths}
                                                        onChange={(e) =>
                                                            setCreateGitForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        size="small"
                                                    />
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1.2}>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={createConfluenceForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setCreateConfluenceForm((f) => ({
                                                                        ...f,
                                                                        isEnabled: e.target.checked,
                                                                    }))
                                                                }
                                                            />
                                                        }
                                                        label="Enable Confluence source"
                                                    />
                                                    <TextField
                                                        label="Base URL"
                                                        value={createConfluenceForm.baseUrl}
                                                        onChange={(e) =>
                                                            setCreateConfluenceForm((f) => ({
                                                                ...f,
                                                                baseUrl: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="https://your-domain.atlassian.net/wiki"
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Space Key"
                                                        value={createConfluenceForm.spaceKey}
                                                        onChange={(e) =>
                                                            setCreateConfluenceForm((f) => ({
                                                                ...f,
                                                                spaceKey: e.target.value,
                                                            }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Email"
                                                        value={createConfluenceForm.email}
                                                        onChange={(e) =>
                                                            setCreateConfluenceForm((f) => ({ ...f, email: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="API Token"
                                                        value={createConfluenceForm.apiToken}
                                                        onChange={(e) =>
                                                            setCreateConfluenceForm((f) => ({
                                                                ...f,
                                                                apiToken: e.target.value,
                                                            }))
                                                        }
                                                        size="small"
                                                    />
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1.2}>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={createJiraForm.isEnabled}
                                                                onChange={(e) =>
                                                                    setCreateJiraForm((f) => ({
                                                                        ...f,
                                                                        isEnabled: e.target.checked,
                                                                    }))
                                                                }
                                                            />
                                                        }
                                                        label="Enable Jira source"
                                                    />
                                                    <TextField
                                                        label="Base URL"
                                                        value={createJiraForm.baseUrl}
                                                        onChange={(e) =>
                                                            setCreateJiraForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                        }
                                                        placeholder="https://your-domain.atlassian.net"
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Email"
                                                        value={createJiraForm.email}
                                                        onChange={(e) =>
                                                            setCreateJiraForm((f) => ({ ...f, email: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="API Token"
                                                        value={createJiraForm.apiToken}
                                                        onChange={(e) =>
                                                            setCreateJiraForm((f) => ({ ...f, apiToken: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="JQL"
                                                        value={createJiraForm.jql}
                                                        onChange={(e) =>
                                                            setCreateJiraForm((f) => ({ ...f, jql: e.target.value }))
                                                        }
                                                        placeholder="project = CORE ORDER BY updated DESC"
                                                        size="small"
                                                    />
                                                </Stack>
                                            </Paper>
                                        </Stack>
                                    )}

                                    {wizardStep === 3 && (
                                        <Stack spacing={1.5}>
                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">Project</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createForm.name || "(no name)"} · {createForm.key || "(no key)"}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Branch: {createForm.default_branch || "main"}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Repo path: {createForm.repo_path || "not set"}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">LLM</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createForm.llm_provider.toUpperCase()} · {createForm.llm_model || "n/a"}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                                                        {createForm.llm_base_url || "backend default"}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                                <Chip
                                                    label={`Git: ${createGitForm.isEnabled ? "enabled" : "disabled"}`}
                                                    color={createGitForm.isEnabled ? "primary" : "default"}
                                                    variant={createGitForm.isEnabled ? "filled" : "outlined"}
                                                />
                                                <Chip
                                                    label={`Confluence: ${createConfluenceForm.isEnabled ? "enabled" : "disabled"}`}
                                                    color={createConfluenceForm.isEnabled ? "primary" : "default"}
                                                    variant={createConfluenceForm.isEnabled ? "filled" : "outlined"}
                                                />
                                                <Chip
                                                    label={`Jira: ${createJiraForm.isEnabled ? "enabled" : "disabled"}`}
                                                    color={createJiraForm.isEnabled ? "primary" : "default"}
                                                    variant={createJiraForm.isEnabled ? "filled" : "outlined"}
                                                />
                                            </Stack>

                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={ingestOnCreate}
                                                        onChange={(e) => setIngestOnCreate(e.target.checked)}
                                                    />
                                                }
                                                label="Run ingestion immediately after create"
                                            />
                                        </Stack>
                                    )}

                                    <Divider />

                                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between">
                                        <Button
                                            variant="text"
                                            disabled={wizardStep === 0 || busy}
                                            onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
                                            sx={{ width: { xs: "100%", sm: "auto" } }}
                                        >
                                            Back
                                        </Button>

                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                                            {wizardStep < CREATE_STEPS.length - 1 ? (
                                                <Button
                                                    variant="contained"
                                                    onClick={() => {
                                                        if (!canOpenStep(wizardStep + 1)) {
                                                            if (wizardStep === 0) {
                                                                setError("Please enter at least project key and name.")
                                                            } else if (wizardStep === 1) {
                                                                setError("Please set provider and model before continuing.")
                                                            }
                                                            return
                                                        }
                                                        setError(null)
                                                        setWizardStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1))
                                                    }}
                                                    disabled={busy}
                                                    sx={{ width: { xs: "100%", sm: "auto" } }}
                                                >
                                                    Next
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="contained"
                                                    startIcon={<AddRounded />}
                                                    onClick={() => void createProjectFromWizard()}
                                                    disabled={busy || !basicsValid || !llmValid}
                                                    sx={{ width: { xs: "100%", sm: "auto" } }}
                                                >
                                                    Create Project
                                                </Button>
                                            )}

                                            <Button
                                                variant="outlined"
                                                onClick={resetCreateWorkflow}
                                                disabled={busy}
                                                sx={{ width: { xs: "100%", sm: "auto" } }}
                                            >
                                                Reset
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </Stack>
                            </CardContent>
                        </Card>

                        <Card variant="outlined">
                            <CardContent sx={{ p: { xs: 1.5, md: 2.5 } }}>
                                <Stack spacing={2}>
                                    <Stack
                                        direction={{ xs: "column", sm: "row" }}
                                        spacing={1.5}
                                        alignItems={{ xs: "stretch", sm: "center" }}
                                    >
                                        <Box>
                                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                                Existing Project Setup
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Update project metadata, connectors, and run ingestion.
                                            </Typography>
                                        </Box>

                                        <FormControl size="small" sx={{ ml: { sm: "auto" }, minWidth: { xs: "100%", sm: 280 } }}>
                                            <InputLabel id="selected-project-label">Project</InputLabel>
                                            <Select
                                                labelId="selected-project-label"
                                                label="Project"
                                                value={selectedProjectId || ""}
                                                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                                            >
                                                {projects.map((p) => (
                                                    <MenuItem key={p.id} value={p.id}>
                                                        {p.name} ({p.key})
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <Button
                                            variant="outlined"
                                            color="error"
                                            startIcon={<DeleteForeverRounded />}
                                            disabled={!selectedProject || busy}
                                            onClick={() => {
                                                setDeleteConfirmKey("")
                                                setDeleteDialogOpen(true)
                                            }}
                                            sx={{ width: { xs: "100%", sm: "auto" } }}
                                        >
                                            Delete Project
                                        </Button>
                                    </Stack>

                                    {!selectedProject && <Alert severity="info">No project selected.</Alert>}

                                    {selectedProject && (
                                        <Stack spacing={2}>
                                            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                                                    Project Settings
                                                </Typography>

                                                <Box
                                                    component="form"
                                                    onSubmit={onSaveProject}
                                                    sx={{
                                                        display: "grid",
                                                        gap: 1.5,
                                                        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                                                    }}
                                                >
                                                    <TextField label="Key" value={editForm.key} disabled size="small" fullWidth />
                                                    <TextField
                                                        label="Name"
                                                        value={editForm.name}
                                                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                                        size="small"
                                                        fullWidth
                                                    />
                                                    <TextField
                                                        label="Description"
                                                        value={editForm.description}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, description: e.target.value }))
                                                        }
                                                        size="small"
                                                        multiline
                                                        minRows={3}
                                                        fullWidth
                                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                                    />
                                                    <TextField
                                                        label="Local Repo Path"
                                                        value={editForm.repo_path}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, repo_path: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                                    />
                                                    <TextField
                                                        label="Default Branch"
                                                        value={editForm.default_branch}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, default_branch: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                    />
                                                    <FormControl size="small" fullWidth>
                                                        <InputLabel id="edit-llm-provider-label">LLM Provider</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-provider-label"
                                                            label="LLM Provider"
                                                            value={editForm.llm_provider}
                                                            onChange={(e) => applyProviderChange(setEditForm, e.target.value)}
                                                        >
                                                            {providerOptions.map((option) => (
                                                                <MenuItem key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                    <TextField
                                                        label="LLM Base URL"
                                                        value={editForm.llm_base_url}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, llm_base_url: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                                    />
                                                    <FormControl size="small" fullWidth>
                                                        <InputLabel id="edit-llm-model-label">LLM Model</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-model-label"
                                                            label="LLM Model"
                                                            value={editForm.llm_model}
                                                            onChange={(e) =>
                                                                setEditForm((f) => ({ ...f, llm_model: e.target.value }))
                                                            }
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
                                                        size="small"
                                                        fullWidth
                                                        helperText="Override with any compatible model ID."
                                                    />
                                                    <TextField
                                                        label="LLM API Key"
                                                        value={editForm.llm_api_key}
                                                        onChange={(e) =>
                                                            setEditForm((f) => ({ ...f, llm_api_key: e.target.value }))
                                                        }
                                                        size="small"
                                                        fullWidth
                                                        helperText={
                                                            editForm.llm_provider === "openai"
                                                                ? "Required for ChatGPT API."
                                                                : "Usually 'ollama' for local models."
                                                        }
                                                    />

                                                    <Box sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                                        <Button
                                                            type="submit"
                                                            variant="contained"
                                                            startIcon={<SaveRounded />}
                                                            disabled={busy}
                                                        >
                                                            Save Project Settings
                                                        </Button>
                                                    </Box>
                                                </Box>
                                            </Paper>

                                            <Box
                                                sx={{
                                                    display: "grid",
                                                    gap: 1.5,
                                                    gridTemplateColumns: {
                                                        xs: "1fr",
                                                        lg: "repeat(3, minmax(0, 1fr))",
                                                    },
                                                }}
                                            >
                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Git Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={gitForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setGitForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Owner"
                                                            value={gitForm.owner}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, owner: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repo"
                                                            value={gitForm.repo}
                                                            onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={gitForm.branch}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Token"
                                                            value={gitForm.token}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, token: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={gitForm.paths}
                                                            onChange={(e) =>
                                                                setGitForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("git")}
                                                            disabled={busy}
                                                        >
                                                            Save Git
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Confluence Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={confluenceForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setConfluenceForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Base URL"
                                                            value={confluenceForm.baseUrl}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({
                                                                    ...f,
                                                                    baseUrl: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="https://your-domain.atlassian.net/wiki"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Space Key"
                                                            value={confluenceForm.spaceKey}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({
                                                                    ...f,
                                                                    spaceKey: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Email"
                                                            value={confluenceForm.email}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({ ...f, email: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Token"
                                                            value={confluenceForm.apiToken}
                                                            onChange={(e) =>
                                                                setConfluenceForm((f) => ({
                                                                    ...f,
                                                                    apiToken: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("confluence")}
                                                            disabled={busy}
                                                        >
                                                            Save Confluence
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Jira Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={jiraForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setJiraForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Base URL"
                                                            value={jiraForm.baseUrl}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                            }
                                                            placeholder="https://your-domain.atlassian.net"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Email"
                                                            value={jiraForm.email}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, email: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Token"
                                                            value={jiraForm.apiToken}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, apiToken: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="JQL"
                                                            value={jiraForm.jql}
                                                            onChange={(e) =>
                                                                setJiraForm((f) => ({ ...f, jql: e.target.value }))
                                                            }
                                                            placeholder="project = CORE ORDER BY updated DESC"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("jira")}
                                                            disabled={busy}
                                                        >
                                                            Save Jira
                                                        </Button>
                                                    </Stack>
                                                </Paper>
                                            </Box>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                <Stack
                                                    direction={{ xs: "column", sm: "row" }}
                                                    spacing={1.5}
                                                    alignItems={{ xs: "flex-start", sm: "center" }}
                                                    justifyContent="space-between"
                                                >
                                                    <Box>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Ingestion
                                                        </Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            Pull configured source data and refresh the retrieval index.
                                                        </Typography>
                                                    </Box>

                                                    <Stack direction="row" spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                                                        <Button
                                                            variant="outlined"
                                                            startIcon={<RefreshRounded />}
                                                            onClick={() => void refreshProjects(selectedProject.id)}
                                                            disabled={busy}
                                                            sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                                                        >
                                                            Refresh
                                                        </Button>
                                                        <Button
                                                            variant="contained"
                                                            color="success"
                                                            startIcon={<CloudUploadRounded />}
                                                            onClick={() => void runIngest(selectedProject.id)}
                                                            disabled={busy}
                                                            sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                                                        >
                                                            Run Ingestion
                                                        </Button>
                                                    </Stack>
                                                </Stack>
                                            </Paper>
                                        </Stack>
                                    )}
                                </Stack>
                            </CardContent>
                        </Card>
                    </Box>
                </Stack>

                <Dialog
                    open={deleteDialogOpen}
                    onClose={() => {
                        if (!busy) setDeleteDialogOpen(false)
                    }}
                    fullWidth
                    maxWidth="sm"
                >
                    <DialogTitle>Delete Project</DialogTitle>
                    <DialogContent>
                        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                            <Alert severity="warning">
                                This removes the project configuration, connectors, chats, and indexed data.
                            </Alert>
                            <Typography variant="body2" color="text.secondary">
                                Type <strong>{selectedProject?.key || ""}</strong> to confirm deletion.
                            </Typography>
                            <TextField
                                label="Project Key Confirmation"
                                value={deleteConfirmKey}
                                onChange={(e) => setDeleteConfirmKey(e.target.value)}
                                autoFocus
                                fullWidth
                                disabled={busy}
                            />
                        </Stack>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            onClick={() => setDeleteDialogOpen(false)}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="error"
                            variant="contained"
                            startIcon={<DeleteForeverRounded />}
                            disabled={busy || !selectedProject || deleteConfirmKey.trim() !== (selectedProject?.key || "")}
                            onClick={() => void deleteSelectedProject()}
                        >
                            Delete Project
                        </Button>
                    </DialogActions>
                </Dialog>
            </Container>
        </Box>
    )
}
