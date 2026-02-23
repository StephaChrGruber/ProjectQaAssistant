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
import ExistingProjectSetupCard from "@/features/admin/projects/ExistingProjectSetupCard"
import LlmProfilesCard from "@/features/admin/projects/LlmProfilesCard"
import NewProjectWizardCard from "@/features/admin/projects/NewProjectWizardCard"
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
                        <NewProjectWizardCard
                            compactWizard={compactWizard}
                            wizardStep={wizardStep}
                            stepStatus={stepStatus}
                            canOpenStep={canOpenStep}
                            setWizardStep={setWizardStep}
                            createRepoMode={createRepoMode}
                            setCreateRepoMode={setCreateRepoMode}
                            setPathPickerTarget={setPathPickerTarget}
                            createForm={createForm}
                            setCreateForm={setCreateForm}
                            createGitForm={createGitForm}
                            setCreateGitForm={setCreateGitForm}
                            createBitbucketForm={createBitbucketForm}
                            setCreateBitbucketForm={setCreateBitbucketForm}
                            createAzureDevOpsForm={createAzureDevOpsForm}
                            setCreateAzureDevOpsForm={setCreateAzureDevOpsForm}
                            createLocalConnectorForm={createLocalConnectorForm}
                            setCreateLocalConnectorForm={setCreateLocalConnectorForm}
                            createConfluenceForm={createConfluenceForm}
                            setCreateConfluenceForm={setCreateConfluenceForm}
                            createJiraForm={createJiraForm}
                            setCreateJiraForm={setCreateJiraForm}
                            createOptionalConnectors={createOptionalConnectors}
                            createConnectorChoices={createConnectorChoices}
                            toggleCreateOptionalConnector={toggleCreateOptionalConnector}
                            llmProfiles={llmProfiles}
                            providerOptions={providerOptions}
                            applyProviderChange={applyProviderChange}
                            loadLlmOptions={loadLlmOptions}
                            loadingLlmOptions={loadingLlmOptions}
                            llmOptionsError={llmOptionsError}
                            defaultBaseUrlForProvider={defaultBaseUrlForProvider}
                            createModelOptions={createModelOptions}
                            primaryRepoConnector={primaryRepoConnector}
                            createRepoBranch={createRepoBranch}
                            selectedCreateConnectorTypes={selectedCreateConnectorTypes}
                            ingestOnCreate={ingestOnCreate}
                            setIngestOnCreate={setIngestOnCreate}
                            busy={busy}
                            repoValid={repoValid}
                            projectValid={projectValid}
                            llmValid={llmValid}
                            createProjectFromWizard={createProjectFromWizard}
                            resetCreateWorkflow={resetCreateWorkflow}
                            setError={setError}
                        />

                        <ExistingProjectSetupCard
                            selectedProjectId={selectedProjectId}
                            setSelectedProjectId={setSelectedProjectId}
                            projects={projects}
                            selectedProject={selectedProject || undefined}
                            busy={busy}
                            setDeleteConfirmKey={setDeleteConfirmKey}
                            setDeleteDialogOpen={setDeleteDialogOpen}
                            onSaveProject={onSaveProject}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            llmProfiles={llmProfiles}
                            providerOptions={providerOptions}
                            applyProviderChange={applyProviderChange}
                            editModelOptions={editModelOptions}
                            setPathPickerTarget={setPathPickerTarget}
                            gitForm={gitForm}
                            setGitForm={setGitForm}
                            bitbucketForm={bitbucketForm}
                            setBitbucketForm={setBitbucketForm}
                            azureDevOpsForm={azureDevOpsForm}
                            setAzureDevOpsForm={setAzureDevOpsForm}
                            localConnectorForm={localConnectorForm}
                            setLocalConnectorForm={setLocalConnectorForm}
                            confluenceForm={confluenceForm}
                            setConfluenceForm={setConfluenceForm}
                            jiraForm={jiraForm}
                            setJiraForm={setJiraForm}
                            saveConnector={saveConnector}
                            refreshProjects={refreshProjects}
                            runIngest={runIngest}
                        />
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
