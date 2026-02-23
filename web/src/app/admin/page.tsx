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
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
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
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded"
import { backendJson } from "@/lib/backend"
import PathPickerDialog from "@/components/PathPickerDialog"
import DeleteProjectDialog from "@/features/admin/projects/DeleteProjectDialog"
import LlmProfilesCard from "@/features/admin/projects/LlmProfilesCard"
import {
    isBrowserLocalRepoPath,
    moveLocalRepoSnapshot,
} from "@/lib/local-repo-bridge"
import {
    asStr,
    connectorPayloads,
    CONNECTOR_LABELS,
    CREATE_DRAFT_LOCAL_REPO_KEY,
    CREATE_STEPS,
    DEFAULT_PROVIDER_OPTIONS,
    emptyAzureDevOps,
    emptyBitbucket,
    emptyConfluence,
    emptyGit,
    emptyJira,
    emptyLlmProfileForm,
    emptyLocalConnector,
    emptyProjectForm,
    errText,
    FALLBACK_OLLAMA_MODELS,
    FALLBACK_OPENAI_MODELS,
    getConnector,
    normalizedOpenAiKey,
    repoModeToConnector,
    type AdminProject,
    type AzureDevOpsForm,
    type BitbucketForm,
    type ConfluenceForm,
    type ConnectorDoc,
    type CreateConnectorType,
    type DeleteProjectResponse,
    type GitForm,
    type JiraForm,
    type LlmOptionsResponse,
    type LlmProfileDoc,
    type LlmProfileForm,
    type LlmProviderOption,
    type LocalConnectorForm,
    type MeResponse,
    type MeUser,
    type ProjectForm,
    type RepoSourceMode,
} from "@/features/admin/projects/form-model"

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
    const [createRepoMode, setCreateRepoMode] = useState<RepoSourceMode>("local")
    const [createOptionalConnectors, setCreateOptionalConnectors] = useState<CreateConnectorType[]>([])
    const [llmOptions, setLlmOptions] = useState<LlmOptionsResponse | null>(null)
    const [loadingLlmOptions, setLoadingLlmOptions] = useState(false)
    const [llmOptionsError, setLlmOptionsError] = useState<string | null>(null)
    const [pathPickerTarget, setPathPickerTarget] = useState<"createRepoPath" | "editRepoPath" | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleteConfirmKey, setDeleteConfirmKey] = useState("")

    const [createForm, setCreateForm] = useState<ProjectForm>(emptyProjectForm())
    const [createGitForm, setCreateGitForm] = useState<GitForm>(emptyGit())
    const [createBitbucketForm, setCreateBitbucketForm] = useState<BitbucketForm>(emptyBitbucket())
    const [createAzureDevOpsForm, setCreateAzureDevOpsForm] = useState<AzureDevOpsForm>(emptyAzureDevOps())
    const [createLocalConnectorForm, setCreateLocalConnectorForm] = useState<LocalConnectorForm>(emptyLocalConnector())
    const [createConfluenceForm, setCreateConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [createJiraForm, setCreateJiraForm] = useState<JiraForm>(emptyJira())

    const [editForm, setEditForm] = useState<ProjectForm>(emptyProjectForm())
    const [gitForm, setGitForm] = useState<GitForm>(emptyGit())
    const [bitbucketForm, setBitbucketForm] = useState<BitbucketForm>(emptyBitbucket())
    const [azureDevOpsForm, setAzureDevOpsForm] = useState<AzureDevOpsForm>(emptyAzureDevOps())
    const [localConnectorForm, setLocalConnectorForm] = useState<LocalConnectorForm>(emptyLocalConnector())
    const [confluenceForm, setConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [jiraForm, setJiraForm] = useState<JiraForm>(emptyJira())
    const [llmProfiles, setLlmProfiles] = useState<LlmProfileDoc[]>([])
    const [llmProfileForm, setLlmProfileForm] = useState<LlmProfileForm>(emptyLlmProfileForm())
    const [editingLlmProfileId, setEditingLlmProfileId] = useState<string | null>(null)

    const selectedProject = useMemo(
        () => projects.find((p) => p.id === selectedProjectId),
        [projects, selectedProjectId]
    )

    const primaryRepoConnector = useMemo<CreateConnectorType>(() => repoModeToConnector(createRepoMode), [createRepoMode])

    const createRepoBranch = useMemo(() => {
        if (createRepoMode === "github") return createGitForm.branch.trim() || "main"
        if (createRepoMode === "bitbucket") return createBitbucketForm.branch.trim() || "main"
        if (createRepoMode === "azure_devops") return createAzureDevOpsForm.branch.trim() || "main"
        return createForm.default_branch.trim() || "main"
    }, [createAzureDevOpsForm.branch, createBitbucketForm.branch, createForm.default_branch, createGitForm.branch, createRepoMode])

    const repoValid = useMemo(() => {
        if (createRepoMode === "github") {
            return Boolean(createGitForm.owner.trim() && createGitForm.repo.trim())
        }
        if (createRepoMode === "bitbucket") {
            return Boolean(createBitbucketForm.workspace.trim() && createBitbucketForm.repo.trim())
        }
        if (createRepoMode === "azure_devops") {
            return Boolean(
                createAzureDevOpsForm.organization.trim() &&
                    createAzureDevOpsForm.project.trim() &&
                    createAzureDevOpsForm.repository.trim()
            )
        }
        return Boolean(createForm.repo_path.trim())
    }, [
        createAzureDevOpsForm.organization,
        createAzureDevOpsForm.project,
        createAzureDevOpsForm.repository,
        createBitbucketForm.repo,
        createBitbucketForm.workspace,
        createForm.repo_path,
        createGitForm.owner,
        createGitForm.repo,
        createRepoMode,
    ])

    const projectValid = useMemo(
        () => Boolean(createForm.key.trim() && createForm.name.trim()),
        [createForm.key, createForm.name]
    )

    const llmValid = useMemo(
        () => Boolean(createForm.llm_profile_id.trim() || (createForm.llm_provider.trim() && createForm.llm_model.trim())),
        [createForm.llm_model, createForm.llm_profile_id, createForm.llm_provider]
    )

    const createConnectorChoices = useMemo<CreateConnectorType[]>(
        () => (["github", "bitbucket", "azure_devops", "local", "confluence", "jira"] as CreateConnectorType[]).filter((t) => t !== primaryRepoConnector),
        [primaryRepoConnector]
    )

    const selectedCreateConnectorTypes = useMemo<CreateConnectorType[]>(
        () => [primaryRepoConnector, ...createOptionalConnectors.filter((t) => t !== primaryRepoConnector)],
        [createOptionalConnectors, primaryRepoConnector]
    )

    const stepStatus = useMemo(
        () => [
            repoValid,
            repoValid && projectValid,
            repoValid && projectValid,
            repoValid && projectValid && llmValid,
            repoValid && projectValid && llmValid,
        ],
        [llmValid, projectValid, repoValid]
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

    const llmProfileModelOptions = useMemo(
        () => modelOptionsForProvider(llmProfileForm.provider, llmProfileForm.model),
        [llmProfileForm.model, llmProfileForm.provider, llmOptions]
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

    async function refreshLlmProfiles() {
        const all = await backendJson<LlmProfileDoc[]>("/api/admin/llm/profiles")
        setLlmProfiles((all || []).filter((p) => p && p.id))
    }

    async function putConnector(
        projectId: string,
        type: "git" | "bitbucket" | "azure_devops" | "local" | "confluence" | "jira",
        payload: Record<string, unknown>
    ) {
        await backendJson(`/api/admin/projects/${projectId}/connectors/${type}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        })
    }

    async function loadLlmOptions(opts?: { openaiApiKey?: string; openaiBaseUrl?: string }) {
        setLoadingLlmOptions(true)
        try {
            const params = new URLSearchParams()
            const safeOpenAiKey = normalizedOpenAiKey(opts?.openaiApiKey)
            if (safeOpenAiKey) {
                params.set("openai_api_key", safeOpenAiKey)
            }
            if (opts?.openaiBaseUrl?.trim()) {
                params.set("openai_base_url", opts.openaiBaseUrl.trim())
            }
            const path = params.toString() ? `/api/admin/llm/options?${params.toString()}` : "/api/admin/llm/options"
            const options = await backendJson<LlmOptionsResponse>(path)
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

    function applyProviderChangeToLlmProfile(nextProvider: string) {
        setLlmProfileForm((prev) => {
            const oldProvider = prev.provider || "ollama"
            const oldDefaultBase = defaultBaseUrlForProvider(oldProvider)
            const nextDefaultBase = defaultBaseUrlForProvider(nextProvider)
            const nextBaseUrl =
                !prev.base_url.trim() || prev.base_url.trim() === oldDefaultBase
                    ? nextDefaultBase
                    : prev.base_url

            const nextModelOptions = modelOptionsForProvider(nextProvider, prev.model)
            const nextModel =
                prev.model && nextModelOptions.includes(prev.model)
                    ? prev.model
                    : (nextModelOptions[0] || "")

            let nextApiKey = prev.api_key
            if (nextProvider === "openai" && nextApiKey.trim() === "ollama") {
                nextApiKey = ""
            } else if (nextProvider === "ollama" && !nextApiKey.trim()) {
                nextApiKey = "ollama"
            }

            return {
                ...prev,
                provider: nextProvider,
                base_url: nextBaseUrl,
                model: nextModel,
                api_key: nextApiKey,
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
                await Promise.all([refreshProjects(), loadLlmOptions(), refreshLlmProfiles()])
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
            setBitbucketForm(emptyBitbucket())
            setAzureDevOpsForm(emptyAzureDevOps())
            setLocalConnectorForm(emptyLocalConnector())
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
            llm_profile_id: p.llm_profile_id || "",
        })

        const g = getConnector(p, "github")
        const bb = getConnector(p, "bitbucket")
        const az = getConnector(p, "azure_devops")
        const local = getConnector(p, "local")
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

        setBitbucketForm({
            isEnabled: bb?.isEnabled ?? false,
            workspace: asStr(bb?.config?.workspace),
            repo: asStr(bb?.config?.repo_slug || bb?.config?.repo),
            branch: asStr(bb?.config?.branch) || p.default_branch || "main",
            username: asStr(bb?.config?.username),
            app_password: asStr(bb?.config?.app_password || bb?.config?.appPassword),
            paths: Array.isArray(bb?.config?.paths) ? (bb?.config?.paths as string[]).join(", ") : "",
            base_url: asStr(bb?.config?.base_url || bb?.config?.baseUrl) || "https://api.bitbucket.org/2.0",
        })

        setAzureDevOpsForm({
            isEnabled: az?.isEnabled ?? false,
            organization: asStr(az?.config?.organization || az?.config?.org),
            project: asStr(az?.config?.project),
            repository: asStr(az?.config?.repository || az?.config?.repo),
            branch: asStr(az?.config?.branch) || p.default_branch || "main",
            pat: asStr(az?.config?.pat || az?.config?.token),
            paths: Array.isArray(az?.config?.paths) ? (az?.config?.paths as string[]).join(", ") : "",
            base_url: asStr(az?.config?.base_url || az?.config?.baseUrl) || "https://dev.azure.com",
        })

        setLocalConnectorForm({
            isEnabled: local?.isEnabled ?? false,
            paths: Array.isArray(local?.config?.paths) ? (local?.config?.paths as string[]).join(", ") : "",
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

    useEffect(() => {
        setCreateOptionalConnectors((prev) => prev.filter((t) => t !== primaryRepoConnector))
    }, [primaryRepoConnector])

    function toggleCreateOptionalConnector(type: CreateConnectorType) {
        if (type === primaryRepoConnector) return
        setCreateOptionalConnectors((prev) =>
            prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
        )
    }

    function resetCreateWorkflow() {
        setCreateForm(emptyProjectForm())
        setCreateGitForm(emptyGit())
        setCreateBitbucketForm(emptyBitbucket())
        setCreateAzureDevOpsForm(emptyAzureDevOps())
        setCreateLocalConnectorForm(emptyLocalConnector())
        setCreateConfluenceForm(emptyConfluence())
        setCreateJiraForm(emptyJira())
        setCreateRepoMode("local")
        setCreateOptionalConnectors([])
        setWizardStep(0)
        setIngestOnCreate(false)
    }

    function canOpenStep(target: number): boolean {
        if (target <= 0) return true
        if (target === 1) return repoValid
        if (target === 2) return repoValid && projectValid
        if (target === 3) return repoValid && projectValid
        return repoValid && projectValid && llmValid
    }

    async function createProjectFromWizard() {
        if (!repoValid || !projectValid || !llmValid) {
            setError("Please complete repository, project basics, and LLM setup before creating.")
            return
        }

        const effectiveBranch = createRepoBranch || "main"
        const effectiveRepoPath = createRepoMode === "local" ? createForm.repo_path.trim() : ""
        const selected = new Set<CreateConnectorType>(selectedCreateConnectorTypes)
        const payloads = connectorPayloads(
            { ...createGitForm, isEnabled: selected.has("github"), branch: createGitForm.branch.trim() || effectiveBranch },
            {
                ...createBitbucketForm,
                isEnabled: selected.has("bitbucket"),
                branch: createBitbucketForm.branch.trim() || effectiveBranch,
            },
            {
                ...createAzureDevOpsForm,
                isEnabled: selected.has("azure_devops"),
                branch: createAzureDevOpsForm.branch.trim() || effectiveBranch,
            },
            { ...createLocalConnectorForm, isEnabled: selected.has("local") },
            { ...createConfluenceForm, isEnabled: selected.has("confluence") },
            { ...createJiraForm, isEnabled: selected.has("jira") }
        )

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
                    repo_path: effectiveRepoPath || null,
                    default_branch: effectiveBranch,
                    llm_provider: createForm.llm_provider || null,
                    llm_base_url: createForm.llm_base_url.trim() || null,
                    llm_model: createForm.llm_model.trim() || null,
                    llm_api_key: createForm.llm_api_key.trim() || null,
                    llm_profile_id: createForm.llm_profile_id.trim() || null,
                }),
            })

            if (effectiveRepoPath && isBrowserLocalRepoPath(effectiveRepoPath)) {
                moveLocalRepoSnapshot(CREATE_DRAFT_LOCAL_REPO_KEY, created.id)
            }

            await Promise.all([
                putConnector(created.id, "git", payloads.git),
                putConnector(created.id, "bitbucket", payloads.bitbucket),
                putConnector(created.id, "azure_devops", payloads.azure_devops),
                putConnector(created.id, "local", payloads.local),
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
                    llm_profile_id: editForm.llm_profile_id.trim() || null,
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

    async function saveConnector(type: "git" | "bitbucket" | "azure_devops" | "local" | "confluence" | "jira") {
        if (!selectedProjectId) return

        setBusy(true)
        setError(null)
        setNotice(null)

        try {
            const payloads = connectorPayloads(
                gitForm,
                bitbucketForm,
                azureDevOpsForm,
                localConnectorForm,
                confluenceForm,
                jiraForm
            )

            if (type === "git") {
                await putConnector(selectedProjectId, "git", payloads.git)
            }
            if (type === "bitbucket") {
                await putConnector(selectedProjectId, "bitbucket", payloads.bitbucket)
            }
            if (type === "azure_devops") {
                await putConnector(selectedProjectId, "azure_devops", payloads.azure_devops)
            }
            if (type === "local") {
                await putConnector(selectedProjectId, "local", payloads.local)
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

    async function saveLlmProfile() {
        if (!llmProfileForm.name.trim() || !llmProfileForm.model.trim()) {
            setError("LLM profile needs at least name and model.")
            return
        }
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            const body = JSON.stringify({
                name: llmProfileForm.name.trim(),
                description: llmProfileForm.description.trim() || null,
                provider: llmProfileForm.provider,
                base_url: llmProfileForm.base_url.trim() || null,
                model: llmProfileForm.model.trim(),
                api_key: llmProfileForm.api_key.trim() || null,
                isEnabled: llmProfileForm.isEnabled,
            })
            if (editingLlmProfileId) {
                await backendJson(`/api/admin/llm/profiles/${editingLlmProfileId}`, {
                    method: "PATCH",
                    body,
                })
            } else {
                await backendJson("/api/admin/llm/profiles", {
                    method: "POST",
                    body,
                })
            }
            await refreshLlmProfiles()
            setEditingLlmProfileId(null)
            setLlmProfileForm(emptyLlmProfileForm())
            setNotice("LLM profile saved.")
        } catch (err) {
            setError(errText(err))
        } finally {
            setBusy(false)
        }
    }

    async function deleteLlmProfile(profileId: string) {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            await backendJson(`/api/admin/llm/profiles/${profileId}`, { method: "DELETE" })
            await refreshLlmProfiles()
            if (editingLlmProfileId === profileId) {
                setEditingLlmProfileId(null)
                setLlmProfileForm(emptyLlmProfileForm())
            }
            setNotice("LLM profile deleted.")
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
                                    Create projects, configure GitHub/Bitbucket/Azure DevOps/Local/Confluence/Jira sources,
                                    choose model provider or reusable profile, and run ingestion.
                                </Typography>
                            </Box>

                            <Stack direction="row" spacing={1}>
                                <Button
                                    component={Link}
                                    href="/admin/custom-tools"
                                    variant="contained"
                                    startIcon={<AddRounded />}
                                >
                                    Custom Tools
                                </Button>
                                <Button
                                    component={Link}
                                    href="/projects"
                                    variant="outlined"
                                    startIcon={<ArrowBackRounded />}
                                >
                                    Back to projects
                                </Button>
                            </Stack>
                        </Stack>
                    </Paper>

                    {busy && <LinearProgress />}
                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="success">{notice}</Alert>}

                    <LlmProfilesCard
                        llmProfileForm={llmProfileForm}
                        setLlmProfileForm={setLlmProfileForm}
                        providerOptions={providerOptions}
                        applyProviderChangeToLlmProfile={applyProviderChangeToLlmProfile}
                        loadingLlmOptions={loadingLlmOptions}
                        loadLlmOptions={loadLlmOptions}
                        llmOptionsError={llmOptionsError}
                        llmProfileModelOptions={llmProfileModelOptions}
                        busy={busy}
                        editingLlmProfileId={editingLlmProfileId}
                        llmProfiles={llmProfiles}
                        saveLlmProfile={saveLlmProfile}
                        onSelectProfile={(profile) => {
                            setEditingLlmProfileId(profile.id)
                            setLlmProfileForm({
                                name: profile.name || "",
                                description: profile.description || "",
                                provider: profile.provider || "ollama",
                                base_url: profile.base_url || "",
                                model: profile.model || "",
                                api_key: profile.api_key || "",
                                isEnabled: profile.isEnabled !== false,
                            })
                        }}
                        deleteLlmProfile={deleteLlmProfile}
                        onResetEditing={() => {
                            setEditingLlmProfileId(null)
                            setLlmProfileForm(emptyLlmProfileForm())
                        }}
                    />

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
                                            Start with repository setup, then project info, optional connectors, and finally LLM configuration.
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
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-repo-source-label">Repository Source</InputLabel>
                                                <Select
                                                    labelId="create-repo-source-label"
                                                    label="Repository Source"
                                                    value={createRepoMode}
                                                    onChange={(e) => setCreateRepoMode(e.target.value as RepoSourceMode)}
                                                >
                                                    <MenuItem value="local">Local repository path</MenuItem>
                                                    <MenuItem value="github">GitHub connector</MenuItem>
                                                    <MenuItem value="bitbucket">Bitbucket connector</MenuItem>
                                                    <MenuItem value="azure_devops">Azure DevOps connector</MenuItem>
                                                </Select>
                                            </FormControl>

                                            <Alert severity="info">
                                                Repository comes first. You can add additional connectors in the next step.
                                            </Alert>

                                            {createRepoMode === "local" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Local Repo Path"
                                                        value={createForm.repo_path}
                                                        onChange={(e) =>
                                                            setCreateForm((f) => ({ ...f, repo_path: e.target.value }))
                                                        }
                                                        placeholder="/workspace/repo or browser-local://<project>"
                                                        fullWidth
                                                        size="small"
                                                        InputProps={{
                                                            endAdornment: (
                                                                <InputAdornment position="end">
                                                                    <IconButton
                                                                        edge="end"
                                                                        size="small"
                                                                        onClick={() => setPathPickerTarget("createRepoPath")}
                                                                    >
                                                                        <FolderOpenRounded fontSize="small" />
                                                                    </IconButton>
                                                                </InputAdornment>
                                                            ),
                                                        }}
                                                    />
                                                    <TextField
                                                        label="Branch"
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

                                            {createRepoMode === "github" && (
                                                <Stack spacing={1.2}>
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
                                            )}

                                            {createRepoMode === "bitbucket" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Workspace"
                                                        value={createBitbucketForm.workspace}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Repository Slug"
                                                        value={createBitbucketForm.repo}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createBitbucketForm.branch}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Username"
                                                        value={createBitbucketForm.username}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, username: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="App Password"
                                                        value={createBitbucketForm.app_password}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="API Base URL"
                                                        value={createBitbucketForm.base_url}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                                                        }
                                                        placeholder="https://api.bitbucket.org/2.0"
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={createBitbucketForm.paths}
                                                        onChange={(e) =>
                                                            setCreateBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        size="small"
                                                    />
                                                </Stack>
                                            )}

                                            {createRepoMode === "azure_devops" && (
                                                <Stack spacing={1.2}>
                                                    <TextField
                                                        label="Organization"
                                                        value={createAzureDevOpsForm.organization}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({
                                                                ...f,
                                                                organization: e.target.value,
                                                            }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Project"
                                                        value={createAzureDevOpsForm.project}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Repository"
                                                        value={createAzureDevOpsForm.repository}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({
                                                                ...f,
                                                                repository: e.target.value,
                                                            }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Branch"
                                                        value={createAzureDevOpsForm.branch}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="PAT"
                                                        value={createAzureDevOpsForm.pat}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                                                        }
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="API Base URL"
                                                        value={createAzureDevOpsForm.base_url}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                        }
                                                        placeholder="https://dev.azure.com"
                                                        size="small"
                                                    />
                                                    <TextField
                                                        label="Paths (comma-separated)"
                                                        value={createAzureDevOpsForm.paths}
                                                        onChange={(e) =>
                                                            setCreateAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                                                        }
                                                        placeholder="src, docs"
                                                        size="small"
                                                    />
                                                </Stack>
                                            )}
                                        </Stack>
                                    )}

                                    {wizardStep === 1 && (
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
                                        </Stack>
                                    )}

                                    {wizardStep === 2 && (
                                        <Stack spacing={1.5}>
                                            <Typography variant="body2" color="text.secondary">
                                                Select additional connectors you want to attach to this project. Only selected connectors show configuration fields.
                                            </Typography>
                                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                                {createConnectorChoices.map((type) => {
                                                    const selected = createOptionalConnectors.includes(type)
                                                    return (
                                                        <Chip
                                                            key={type}
                                                            label={CONNECTOR_LABELS[type]}
                                                            clickable
                                                            color={selected ? "primary" : "default"}
                                                            variant={selected ? "filled" : "outlined"}
                                                            onClick={() => toggleCreateOptionalConnector(type)}
                                                        />
                                                    )
                                                })}
                                            </Stack>

                                            {!createOptionalConnectors.length && (
                                                <Alert severity="info">No additional connectors selected.</Alert>
                                            )}

                                            {createOptionalConnectors.includes("github") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">GitHub Connector</Typography>
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
                                            )}

                                            {createOptionalConnectors.includes("bitbucket") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Bitbucket Connector</Typography>
                                                        <TextField
                                                            label="Workspace"
                                                            value={createBitbucketForm.workspace}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository Slug"
                                                            value={createBitbucketForm.repo}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={createBitbucketForm.branch}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Username"
                                                            value={createBitbucketForm.username}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, username: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="App Password"
                                                            value={createBitbucketForm.app_password}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={createBitbucketForm.base_url}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://api.bitbucket.org/2.0"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createBitbucketForm.paths}
                                                            onChange={(e) =>
                                                                setCreateBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("azure_devops") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Azure DevOps Connector</Typography>
                                                        <TextField
                                                            label="Organization"
                                                            value={createAzureDevOpsForm.organization}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({
                                                                    ...f,
                                                                    organization: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Project"
                                                            value={createAzureDevOpsForm.project}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository"
                                                            value={createAzureDevOpsForm.repository}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({
                                                                    ...f,
                                                                    repository: e.target.value,
                                                                }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={createAzureDevOpsForm.branch}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="PAT"
                                                            value={createAzureDevOpsForm.pat}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={createAzureDevOpsForm.base_url}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://dev.azure.com"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createAzureDevOpsForm.paths}
                                                            onChange={(e) =>
                                                                setCreateAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("local") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Local Repository Connector</Typography>
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={createLocalConnectorForm.paths}
                                                            onChange={(e) =>
                                                                setCreateLocalConnectorForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                            helperText="Reads from project local repo_path on backend host."
                                                        />
                                                    </Stack>
                                                </Paper>
                                            )}

                                            {createOptionalConnectors.includes("confluence") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Confluence Connector</Typography>
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
                                            )}

                                            {createOptionalConnectors.includes("jira") && (
                                                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle2">Jira Connector</Typography>
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
                                            )}
                                        </Stack>
                                    )}

                                    {wizardStep === 3 && (
                                        <Stack spacing={1.5}>
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-profile-label">LLM Profile</InputLabel>
                                                <Select
                                                    labelId="create-llm-profile-label"
                                                    value={createForm.llm_profile_id}
                                                    label="LLM Profile"
                                                    onChange={(e) =>
                                                        setCreateForm((f) => ({ ...f, llm_profile_id: e.target.value }))
                                                    }
                                                >
                                                    <MenuItem value="">No profile (custom settings below)</MenuItem>
                                                    {llmProfiles.filter((profile) => profile.isEnabled !== false).map((profile) => (
                                                        <MenuItem key={profile.id} value={profile.id}>
                                                            {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                            <FormControl fullWidth size="small">
                                                <InputLabel id="create-llm-provider-label">Provider</InputLabel>
                                                <Select
                                                    labelId="create-llm-provider-label"
                                                    value={createForm.llm_provider}
                                                    label="Provider"
                                                    onChange={(e) => applyProviderChange(setCreateForm, e.target.value)}
                                                    disabled={Boolean(createForm.llm_profile_id)}
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
                                                    {createForm.llm_profile_id
                                                        ? "Project uses selected reusable LLM profile."
                                                        : createForm.llm_provider === "ollama"
                                                        ? "Choose from discovered local Ollama models."
                                                        : "Use ChatGPT model IDs through OpenAI-compatible API."}
                                                </Typography>
                                                <Button
                                                    variant="text"
                                                    size="small"
                                                    onClick={() =>
                                                        void loadLlmOptions(
                                                            createForm.llm_provider === "openai"
                                                                ? {
                                                                    openaiApiKey: createForm.llm_api_key,
                                                                    openaiBaseUrl: createForm.llm_base_url,
                                                                }
                                                                : undefined
                                                        )
                                                    }
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
                                                disabled={Boolean(createForm.llm_profile_id)}
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
                                                    disabled={Boolean(createForm.llm_profile_id)}
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
                                                disabled={Boolean(createForm.llm_profile_id)}
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
                                                disabled={Boolean(createForm.llm_profile_id)}
                                            />
                                        </Stack>
                                    )}

                                    {wizardStep === 4 && (
                                        <Stack spacing={1.5}>
                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">Repository</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Source: {CONNECTOR_LABELS[primaryRepoConnector]}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Branch: {createRepoBranch || "main"}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createRepoMode === "local"
                                                            ? `Repo path: ${createForm.repo_path || "not set"}`
                                                            : createRepoMode === "github"
                                                            ? `Repository: ${createGitForm.owner || "?"}/${createGitForm.repo || "?"}`
                                                            : createRepoMode === "bitbucket"
                                                            ? `Repository: ${createBitbucketForm.workspace || "?"}/${createBitbucketForm.repo || "?"}`
                                                            : `Repository: ${createAzureDevOpsForm.organization || "?"}/${createAzureDevOpsForm.project || "?"}/${createAzureDevOpsForm.repository || "?"}`}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">Project</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createForm.name || "(no name)"} · {createForm.key || "(no key)"}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 } }}>
                                                <Stack spacing={1}>
                                                    <Typography variant="subtitle2">LLM</Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {createForm.llm_profile_id
                                                            ? `Profile: ${
                                                                llmProfiles.find((p) => p.id === createForm.llm_profile_id)?.name || createForm.llm_profile_id
                                                            }`
                                                            : `${createForm.llm_provider.toUpperCase()} · ${createForm.llm_model || "n/a"}`}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                                                        {createForm.llm_base_url || "backend default"}
                                                    </Typography>
                                                </Stack>
                                            </Paper>

                                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                                {selectedCreateConnectorTypes.map((type) => (
                                                    <Chip key={type} label={CONNECTOR_LABELS[type]} color="primary" variant="filled" />
                                                ))}
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
                                                                setError("Please complete repository setup before continuing.")
                                                            } else if (wizardStep === 1) {
                                                                setError("Please enter project key and name before continuing.")
                                                            } else if (wizardStep === 3) {
                                                                setError("Please choose an LLM profile or set provider and model before continuing.")
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
                                                    disabled={busy || !repoValid || !projectValid || !llmValid}
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
                                                        InputProps={{
                                                            endAdornment: (
                                                                <InputAdornment position="end">
                                                                    <IconButton
                                                                        edge="end"
                                                                        size="small"
                                                                        onClick={() => setPathPickerTarget("editRepoPath")}
                                                                    >
                                                                        <FolderOpenRounded fontSize="small" />
                                                                    </IconButton>
                                                                </InputAdornment>
                                                            ),
                                                        }}
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
                                                    <FormControl size="small" fullWidth sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                                                        <InputLabel id="edit-llm-profile-label">LLM Profile</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-profile-label"
                                                            label="LLM Profile"
                                                            value={editForm.llm_profile_id}
                                                            onChange={(e) =>
                                                                setEditForm((f) => ({ ...f, llm_profile_id: e.target.value }))
                                                            }
                                                        >
                                                            <MenuItem value="">No profile (custom settings below)</MenuItem>
                                                            {llmProfiles.filter((profile) => profile.isEnabled !== false).map((profile) => (
                                                                <MenuItem key={profile.id} value={profile.id}>
                                                                    {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                                                </MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                    <FormControl size="small" fullWidth>
                                                        <InputLabel id="edit-llm-provider-label">LLM Provider</InputLabel>
                                                        <Select
                                                            labelId="edit-llm-provider-label"
                                                            label="LLM Provider"
                                                            value={editForm.llm_provider}
                                                            onChange={(e) => applyProviderChange(setEditForm, e.target.value)}
                                                            disabled={Boolean(editForm.llm_profile_id)}
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
                                                        disabled={Boolean(editForm.llm_profile_id)}
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
                                                            disabled={Boolean(editForm.llm_profile_id)}
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
                                                        disabled={Boolean(editForm.llm_profile_id)}
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
                                                        disabled={Boolean(editForm.llm_profile_id)}
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
                                                            Bitbucket Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={bitbucketForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setBitbucketForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Workspace"
                                                            value={bitbucketForm.workspace}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, workspace: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository Slug"
                                                            value={bitbucketForm.repo}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, repo: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={bitbucketForm.branch}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Username"
                                                            value={bitbucketForm.username}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, username: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="App Password"
                                                            value={bitbucketForm.app_password}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, app_password: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={bitbucketForm.base_url}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://api.bitbucket.org/2.0"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={bitbucketForm.paths}
                                                            onChange={(e) =>
                                                                setBitbucketForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("bitbucket")}
                                                            disabled={busy}
                                                        >
                                                            Save Bitbucket
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Azure DevOps Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={azureDevOpsForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setAzureDevOpsForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Organization"
                                                            value={azureDevOpsForm.organization}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, organization: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Project"
                                                            value={azureDevOpsForm.project}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, project: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Repository"
                                                            value={azureDevOpsForm.repository}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, repository: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Branch"
                                                            value={azureDevOpsForm.branch}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, branch: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="PAT"
                                                            value={azureDevOpsForm.pat}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, pat: e.target.value }))
                                                            }
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="API Base URL"
                                                            value={azureDevOpsForm.base_url}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, base_url: e.target.value }))
                                                            }
                                                            placeholder="https://dev.azure.com"
                                                            size="small"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={azureDevOpsForm.paths}
                                                            onChange={(e) =>
                                                                setAzureDevOpsForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("azure_devops")}
                                                            disabled={busy}
                                                        >
                                                            Save Azure DevOps
                                                        </Button>
                                                    </Stack>
                                                </Paper>

                                                <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
                                                    <Stack spacing={1.2}>
                                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                            Local Repository Source
                                                        </Typography>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={localConnectorForm.isEnabled}
                                                                    onChange={(e) =>
                                                                        setLocalConnectorForm((f) => ({
                                                                            ...f,
                                                                            isEnabled: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label="Enabled"
                                                        />
                                                        <TextField
                                                            label="Paths (comma-separated)"
                                                            value={localConnectorForm.paths}
                                                            onChange={(e) =>
                                                                setLocalConnectorForm((f) => ({ ...f, paths: e.target.value }))
                                                            }
                                                            placeholder="src, docs"
                                                            size="small"
                                                            helperText="Reads from the configured project repo path."
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            onClick={() => void saveConnector("local")}
                                                            disabled={busy}
                                                        >
                                                            Save Local Source
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

                <DeleteProjectDialog
                    open={deleteDialogOpen}
                    busy={busy}
                    projectKey={selectedProject?.key || ""}
                    confirmKey={deleteConfirmKey}
                    setConfirmKey={setDeleteConfirmKey}
                    onClose={() => {
                        if (!busy) {
                            setDeleteDialogOpen(false)
                        }
                    }}
                    onDelete={deleteSelectedProject}
                />

                <PathPickerDialog
                    open={Boolean(pathPickerTarget)}
                    title="Pick Repository Folder"
                    localRepoKey={
                        pathPickerTarget === "createRepoPath"
                            ? CREATE_DRAFT_LOCAL_REPO_KEY
                            : pathPickerTarget === "editRepoPath" && selectedProjectId
                                ? selectedProjectId
                                : undefined
                    }
                    initialPath={
                        pathPickerTarget === "createRepoPath"
                            ? createForm.repo_path
                            : pathPickerTarget === "editRepoPath"
                                ? editForm.repo_path
                                : ""
                    }
                    onClose={() => setPathPickerTarget(null)}
                    onPick={(path) => {
                        if (pathPickerTarget === "createRepoPath") {
                            setCreateForm((f) => ({ ...f, repo_path: path }))
                        } else if (pathPickerTarget === "editRepoPath") {
                            setEditForm((f) => ({ ...f, repo_path: path }))
                        }
                        setPathPickerTarget(null)
                    }}
                />
            </Container>
        </Box>
    )
}
