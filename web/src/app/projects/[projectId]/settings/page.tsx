"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
    Alert,
    Box,
    Stack,
} from "@mui/material"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"
import PathPickerDialog from "@/components/PathPickerDialog"
import DetailCard from "@/features/project-settings/DetailCard"
import ProjectSettingsAdminPanel from "@/features/project-settings/ProjectSettingsAdminPanel"
import { ProjectSettingsOverviewCards } from "@/features/project-settings/ProjectSettingsOverviewCards"
import { hasLocalRepoSnapshot, isBrowserLocalRepoPath } from "@/lib/local-repo-bridge"
import {
    resolveDefaultBaseUrlForProvider,
    resolveModelOptionsForProvider,
    resolveProviderOptions,
} from "@/features/llm/provider-utils"
import {
    asStr,
    csvToList,
    dedupeChatsById,
    DEFAULT_PROVIDER_OPTIONS,
    emptyAzureDevOps,
    emptyBitbucket,
    emptyConfluence,
    emptyGit,
    emptyJira,
    emptyLocalConnector,
    errText,
    FALLBACK_OLLAMA_MODELS,
    FALLBACK_OPENAI_MODELS,
    getConnector,
    makeChatId,
    normalizedOpenAiKey,
    type AzureDevOpsForm,
    type BitbucketForm,
    type BranchesResponse,
    type ConfluenceForm,
    type ConnectorDoc,
    type ConnectorsResponse,
    type ConnectorHealthResponse,
    type ConnectorHealthHistoryResponse,
    type EvalRunResponse,
    type FeatureFlags,
    type FeatureFlagsResponse,
    type GitForm,
    type JiraForm,
    type LlmOptionsResponse,
    type LlmProfileDoc,
    type LocalConnectorForm,
    type MeResponse,
    type ProjectDoc,
    type ProjectEditForm,
    type QaMetricsResponse,
} from "@/features/project-settings/form-model"

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
        llm_profile_id: "",
        grounding_require_sources: true,
        grounding_min_sources: 1,
        routing_enabled: false,
        routing_fast_profile_id: "",
        routing_strong_profile_id: "",
        routing_fallback_profile_id: "",
        security_read_only_non_admin: true,
        security_allow_write_members: false,
    })

    const [gitForm, setGitForm] = useState<GitForm>(emptyGit())
    const [bitbucketForm, setBitbucketForm] = useState<BitbucketForm>(emptyBitbucket())
    const [azureDevOpsForm, setAzureDevOpsForm] = useState<AzureDevOpsForm>(emptyAzureDevOps())
    const [localConnectorForm, setLocalConnectorForm] = useState<LocalConnectorForm>(emptyLocalConnector())
    const [confluenceForm, setConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [jiraForm, setJiraForm] = useState<JiraForm>(emptyJira())
    const [llmProfiles, setLlmProfiles] = useState<LlmProfileDoc[]>([])

    const [llmOptions, setLlmOptions] = useState<LlmOptionsResponse | null>(null)
    const [loadingLlmOptions, setLoadingLlmOptions] = useState(false)
    const [llmOptionsError, setLlmOptionsError] = useState<string | null>(null)
    const [pathPickerOpen, setPathPickerOpen] = useState(false)
    const [qaMetrics, setQaMetrics] = useState<QaMetricsResponse | null>(null)
    const [loadingQaMetrics, setLoadingQaMetrics] = useState(false)
    const [evaluationQuestions, setEvaluationQuestions] = useState<string>(
        "What is the architecture of this project?\nHow do I run this project locally?\nWhich connectors are configured?"
    )
    const [runningEvaluations, setRunningEvaluations] = useState(false)
    const [latestEvalRun, setLatestEvalRun] = useState<EvalRunResponse | null>(null)
    const [runningIncrementalIngest, setRunningIncrementalIngest] = useState(false)
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({
        enable_audit_events: true,
        enable_connector_health: true,
        enable_memory_controls: true,
        dry_run_tools_default: false,
        require_approval_for_write_tools: false,
    })
    const [savingFeatureFlags, setSavingFeatureFlags] = useState(false)
    const [connectorHealth, setConnectorHealth] = useState<ConnectorHealthResponse | null>(null)
    const [connectorHealthHistory, setConnectorHealthHistory] = useState<ConnectorHealthHistoryResponse | null>(null)
    const [loadingConnectorHealth, setLoadingConnectorHealth] = useState(false)

    const projectLabel = useMemo(
        () => project?.name || project?.key || projectId,
        [project?.name, project?.key, projectId]
    )
    const userId = useMemo(() => me?.email || "dev@local", [me])
    const localRepoConfiguredInBrowser = useMemo(
        () => isBrowserLocalRepoPath(editForm.repo_path) && hasLocalRepoSnapshot(projectId),
        [editForm.repo_path, projectId]
    )

    const providerOptions = useMemo(
        () => resolveProviderOptions(llmOptions, DEFAULT_PROVIDER_OPTIONS),
        [llmOptions]
    )

    const defaultBaseUrlForProvider = useCallback(
        (provider: string) =>
            resolveDefaultBaseUrlForProvider(provider, providerOptions, {
                openai: "https://api.openai.com/v1",
                ollama: "http://ollama:11434/v1",
            }),
        [providerOptions]
    )

    const editModelOptions = useMemo(
        () =>
            resolveModelOptionsForProvider({
                provider: editForm.llm_provider,
                current: editForm.llm_model,
                llmOptions,
                fallbackOpenAiModels: FALLBACK_OPENAI_MODELS,
                fallbackOllamaModels: FALLBACK_OLLAMA_MODELS,
            }),
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

            const nextModelOptions = resolveModelOptionsForProvider({
                provider: nextProvider,
                current: prev.llm_model,
                llmOptions,
                fallbackOpenAiModels: FALLBACK_OPENAI_MODELS,
                fallbackOllamaModels: FALLBACK_OLLAMA_MODELS,
            })
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
                `/api/projects/${projectId}/chats?branch=${encodeURIComponent(branch)}&limit=100&user=${encodeURIComponent(userId)}`
            )
            setChats(dedupeChatsById(docs || []))
        } finally {
            setLoadingChats(false)
        }
    }, [branch, projectId, userId])

    const loadLlmOptions = useCallback(async (opts?: { openaiApiKey?: string; openaiBaseUrl?: string }) => {
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
    }, [])

    const loadLlmProfiles = useCallback(async () => {
        try {
            const profiles = await backendJson<LlmProfileDoc[]>("/api/llm/profiles")
            setLlmProfiles((profiles || []).filter((p) => p && p.id))
        } catch {
            setLlmProfiles([])
        }
    }, [])

    const loadConnectors = useCallback(async (defaultBranch: string) => {
        const connectors = await backendJson<ConnectorsResponse>(`/api/admin/projects/${projectId}/connectors`)
        const git = getConnector(connectors, "github")
        const bitbucket = getConnector(connectors, "bitbucket")
        const azureDevOps = getConnector(connectors, "azure_devops")
        const local = getConnector(connectors, "local")
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
        setBitbucketForm({
            isEnabled: bitbucket?.isEnabled ?? false,
            workspace: asStr(bitbucket?.config?.workspace),
            repo: asStr(bitbucket?.config?.repo_slug || bitbucket?.config?.repo),
            branch: asStr(bitbucket?.config?.branch) || defaultBranch,
            username: asStr(bitbucket?.config?.username),
            app_password: asStr(bitbucket?.config?.app_password || bitbucket?.config?.appPassword),
            paths: Array.isArray(bitbucket?.config?.paths) ? (bitbucket?.config?.paths as string[]).join(", ") : "",
            base_url: asStr(bitbucket?.config?.base_url || bitbucket?.config?.baseUrl) || "https://api.bitbucket.org/2.0",
        })
        setAzureDevOpsForm({
            isEnabled: azureDevOps?.isEnabled ?? false,
            organization: asStr(azureDevOps?.config?.organization || azureDevOps?.config?.org),
            project: asStr(azureDevOps?.config?.project),
            repository: asStr(azureDevOps?.config?.repository || azureDevOps?.config?.repo),
            branch: asStr(azureDevOps?.config?.branch) || defaultBranch,
            pat: asStr(azureDevOps?.config?.pat || azureDevOps?.config?.token),
            paths: Array.isArray(azureDevOps?.config?.paths) ? (azureDevOps?.config?.paths as string[]).join(", ") : "",
            base_url: asStr(azureDevOps?.config?.base_url || azureDevOps?.config?.baseUrl) || "https://dev.azure.com",
        })
        setLocalConnectorForm({
            isEnabled: local?.isEnabled ?? false,
            paths: Array.isArray(local?.config?.paths) ? (local?.config?.paths as string[]).join(", ") : "",
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
    }, [projectId])

    const loadFeatureFlags = useCallback(async () => {
        if (!me?.isGlobalAdmin) return
        try {
            const out = await backendJson<FeatureFlagsResponse>(`/api/admin/projects/${projectId}/feature-flags`)
            if (out?.feature_flags) {
                setFeatureFlags(out.feature_flags)
                setProject((prev) =>
                    prev
                        ? {
                              ...prev,
                              extra: {
                                  ...(prev.extra || {}),
                                  feature_flags: out.feature_flags,
                              },
                          }
                        : prev
                )
            }
        } catch (err) {
            setError(errText(err))
        }
    }, [me?.isGlobalAdmin, projectId])

    const refreshConnectorHealth = useCallback(async () => {
        if (!me?.isGlobalAdmin) return
        setLoadingConnectorHealth(true)
        try {
            const [health, history] = await Promise.all([
                backendJson<ConnectorHealthResponse>(`/api/admin/projects/${projectId}/connectors/health`),
                backendJson<ConnectorHealthHistoryResponse>(
                    `/api/admin/projects/${projectId}/connectors/health/history?hours=168&limit=2000`
                ),
            ])
            setConnectorHealth(health)
            setConnectorHealthHistory(history)
        } catch (err) {
            setError(errText(err))
        } finally {
            setLoadingConnectorHealth(false)
        }
    }, [me?.isGlobalAdmin, projectId])

    const loadQaMetrics = useCallback(async () => {
        if (!me?.isGlobalAdmin) return
        setLoadingQaMetrics(true)
        try {
            const out = await backendJson<QaMetricsResponse>(
                `/api/projects/${projectId}/qa-metrics?hours=72&branch=${encodeURIComponent(branch)}`
            )
            setQaMetrics(out)
        } catch (err) {
            setError(errText(err))
        } finally {
            setLoadingQaMetrics(false)
        }
    }, [branch, me?.isGlobalAdmin, projectId])

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
                const defaultBase = resolveDefaultBaseUrlForProvider(provider, DEFAULT_PROVIDER_OPTIONS, {
                    openai: "https://api.openai.com/v1",
                    ollama: "http://ollama:11434/v1",
                })
                const defaultModel =
                    resolveModelOptionsForProvider({
                        provider,
                        current: projectRes.llm_model,
                        llmOptions: null,
                        fallbackOpenAiModels: FALLBACK_OPENAI_MODELS,
                        fallbackOllamaModels: FALLBACK_OLLAMA_MODELS,
                    })[0] || ""
                const grounding = (projectRes.extra?.grounding || {}) as Record<string, any>
                const routing = (projectRes.extra?.llm_routing || {}) as Record<string, any>
                const security = (projectRes.extra?.security || {}) as Record<string, any>
                setEditForm({
                    name: projectRes.name || "",
                    description: projectRes.description || "",
                    repo_path: projectRes.repo_path || "",
                    default_branch: projectRes.default_branch || "main",
                    llm_provider: provider,
                    llm_base_url: projectRes.llm_base_url || defaultBase,
                    llm_model: projectRes.llm_model || defaultModel,
                    llm_api_key: projectRes.llm_api_key || (provider === "ollama" ? "ollama" : ""),
                    llm_profile_id: projectRes.llm_profile_id || "",
                    grounding_require_sources: grounding.require_sources ?? true,
                    grounding_min_sources: Number(grounding.min_sources || 1),
                    routing_enabled: Boolean(routing.enabled),
                    routing_fast_profile_id: String(routing.fast_profile_id || ""),
                    routing_strong_profile_id: String(routing.strong_profile_id || ""),
                    routing_fallback_profile_id: String(routing.fallback_profile_id || ""),
                    security_read_only_non_admin: security.read_only_for_non_admin ?? true,
                    security_allow_write_members: Boolean(security.allow_write_tools_for_members),
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
                        loadLlmProfiles(),
                        loadConnectors(projectRes.default_branch || "main"),
                        loadFeatureFlags(),
                        refreshConnectorHealth(),
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
    }, [loadConnectors, loadFeatureFlags, loadLlmOptions, loadLlmProfiles, projectId, refreshConnectorHealth])

    useEffect(() => {
        void loadChats().catch((err) => setError(errText(err)))
    }, [loadChats])

    useEffect(() => {
        if (!me?.isGlobalAdmin) return
        void loadQaMetrics()
    }, [loadQaMetrics, me?.isGlobalAdmin])

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
                    llm_profile_id: editForm.llm_profile_id.trim() || null,
                    extra: {
                        ...((project?.extra || {}) as Record<string, unknown>),
                        grounding: {
                            require_sources: Boolean(editForm.grounding_require_sources),
                            min_sources: Math.max(1, Math.min(5, Number(editForm.grounding_min_sources || 1))),
                        },
                        llm_routing: {
                            enabled: Boolean(editForm.routing_enabled),
                            fast_profile_id: editForm.routing_fast_profile_id.trim() || null,
                            strong_profile_id: editForm.routing_strong_profile_id.trim() || null,
                            fallback_profile_id: editForm.routing_fallback_profile_id.trim() || null,
                        },
                        security: {
                            read_only_for_non_admin: Boolean(editForm.security_read_only_non_admin),
                            allow_write_tools_for_members: Boolean(editForm.security_allow_write_members),
                        },
                        feature_flags: featureFlags,
                    },
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

    async function saveConnector(type: "git" | "bitbucket" | "azure_devops" | "local" | "confluence" | "jira") {
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
            } else if (type === "bitbucket") {
                await backendJson(`/api/admin/projects/${projectId}/connectors/bitbucket`, {
                    method: "PUT",
                    body: JSON.stringify({
                        isEnabled: bitbucketForm.isEnabled,
                        config: {
                            workspace: bitbucketForm.workspace.trim(),
                            repo_slug: bitbucketForm.repo.trim(),
                            branch: bitbucketForm.branch.trim() || "main",
                            username: bitbucketForm.username.trim(),
                            app_password: bitbucketForm.app_password.trim(),
                            paths: csvToList(bitbucketForm.paths),
                            base_url: bitbucketForm.base_url.trim(),
                        },
                    }),
                })
            } else if (type === "azure_devops") {
                await backendJson(`/api/admin/projects/${projectId}/connectors/azure_devops`, {
                    method: "PUT",
                    body: JSON.stringify({
                        isEnabled: azureDevOpsForm.isEnabled,
                        config: {
                            organization: azureDevOpsForm.organization.trim(),
                            project: azureDevOpsForm.project.trim(),
                            repository: azureDevOpsForm.repository.trim(),
                            branch: azureDevOpsForm.branch.trim() || "main",
                            pat: azureDevOpsForm.pat.trim(),
                            paths: csvToList(azureDevOpsForm.paths),
                            base_url: azureDevOpsForm.base_url.trim(),
                        },
                    }),
                })
            } else if (type === "local") {
                await backendJson(`/api/admin/projects/${projectId}/connectors/local`, {
                    method: "PUT",
                    body: JSON.stringify({
                        isEnabled: localConnectorForm.isEnabled,
                        config: {
                            paths: csvToList(localConnectorForm.paths),
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

    async function runIncrementalIngest() {
        if (!me?.isGlobalAdmin) return
        setRunningIncrementalIngest(true)
        setError(null)
        setNotice(null)
        try {
            const connectors = ["github", "bitbucket", "azure_devops", "local", "confluence", "jira"]
            const out = await backendJson<{ totalDocs?: number; totalChunks?: number; requested_connectors?: string[] }>(
                `/api/admin/projects/${projectId}/ingest/incremental`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        connectors,
                        reason: "settings_incremental_refresh",
                    }),
                }
            )
            setNotice(
                `Incremental ingestion finished. Docs: ${out.totalDocs || 0}, chunks: ${out.totalChunks || 0}.`
            )
        } catch (err) {
            setError(errText(err))
        } finally {
            setRunningIncrementalIngest(false)
        }
    }

    async function runEvaluations() {
        if (!me?.isGlobalAdmin) return
        setRunningEvaluations(true)
        setError(null)
        setNotice(null)
        try {
            const questions = evaluationQuestions
                .split("\n")
                .map((q) => q.trim())
                .filter(Boolean)
            if (!questions.length) {
                setError("Add at least one evaluation question.")
                return
            }
            const run = await backendJson<EvalRunResponse>(`/api/admin/projects/${projectId}/evaluations/run`, {
                method: "POST",
                body: JSON.stringify({
                    questions,
                    branch,
                    max_questions: 12,
                }),
            })
            setLatestEvalRun(run)
            setNotice("Evaluation run completed.")
            await loadQaMetrics()
        } catch (err) {
            setError(errText(err))
        } finally {
            setRunningEvaluations(false)
        }
    }

    async function saveFeatureFlags() {
        if (!me?.isGlobalAdmin) return
        setSavingFeatureFlags(true)
        setError(null)
        setNotice(null)
        try {
            const out = await backendJson<FeatureFlagsResponse>(`/api/admin/projects/${projectId}/feature-flags`, {
                method: "PATCH",
                body: JSON.stringify(featureFlags),
            })
            if (out?.feature_flags) {
                setFeatureFlags(out.feature_flags)
                setProject((prev) =>
                    prev
                        ? {
                              ...prev,
                              extra: {
                                  ...(prev.extra || {}),
                                  feature_flags: out.feature_flags,
                              },
                          }
                        : prev
                )
            }
            setNotice("Feature flags updated.")
            await refreshConnectorHealth()
        } catch (err) {
            setError(errText(err))
        } finally {
            setSavingFeatureFlags(false)
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
                    <ProjectSettingsOverviewCards
                        projectId={projectId}
                        project={project}
                        projectLabel={projectLabel}
                        isGlobalAdmin={Boolean(me?.isGlobalAdmin)}
                    />

                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="success">{notice}</Alert>}

                    {me?.isGlobalAdmin && (
                        <ProjectSettingsAdminPanel
                            projectId={projectId}
                            branch={branch}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            isBrowserLocalRepoPath={isBrowserLocalRepoPath}
                            localRepoConfiguredInBrowser={localRepoConfiguredInBrowser}
                            setPathPickerOpen={setPathPickerOpen}
                            llmProfiles={llmProfiles}
                            providerOptions={providerOptions}
                            applyProviderChange={applyProviderChange}
                            editModelOptions={editModelOptions}
                            onSaveProjectSettings={onSaveProjectSettings}
                            savingProject={savingProject}
                            savingConnector={savingConnector}
                            ingesting={ingesting}
                            loadLlmOptions={loadLlmOptions}
                            loadingLlmOptions={loadingLlmOptions}
                            llmOptionsError={llmOptionsError}
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
                            runIngest={runIngest}
                            runningIncrementalIngest={runningIncrementalIngest}
                            runIncrementalIngest={runIncrementalIngest}
                            loadQaMetrics={loadQaMetrics}
                            loadingQaMetrics={loadingQaMetrics}
                            qaMetrics={qaMetrics}
                            evaluationQuestions={evaluationQuestions}
                            setEvaluationQuestions={setEvaluationQuestions}
                            runEvaluations={runEvaluations}
                            runningEvaluations={runningEvaluations}
                            latestEvalRun={latestEvalRun}
                            featureFlags={featureFlags}
                            setFeatureFlags={setFeatureFlags}
                            saveFeatureFlags={saveFeatureFlags}
                            savingFeatureFlags={savingFeatureFlags}
                            connectorHealth={connectorHealth}
                            connectorHealthHistory={connectorHealthHistory}
                            loadingConnectorHealth={loadingConnectorHealth}
                            refreshConnectorHealth={refreshConnectorHealth}
                            DetailCardComponent={DetailCard}
                        />
                    )}
                </Stack>

                <PathPickerDialog
                    open={pathPickerOpen}
                    title="Pick Repository Folder"
                    initialPath={editForm.repo_path}
                    localRepoKey={projectId}
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
