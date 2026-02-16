"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import Link from "next/link"
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

function inputClassName() {
    return "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 placeholder:text-slate-500 focus:ring-2"
}

export default function AdminPage() {
    const [me, setMe] = useState<MeUser | null>(null)
    const [projects, setProjects] = useState<AdminProject[]>([])
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const [createForm, setCreateForm] = useState<ProjectForm>(emptyProjectForm())
    const [editForm, setEditForm] = useState<ProjectForm>(emptyProjectForm())

    const [gitForm, setGitForm] = useState<GitForm>(emptyGit())
    const [confluenceForm, setConfluenceForm] = useState<ConfluenceForm>(emptyConfluence())
    const [jiraForm, setJiraForm] = useState<JiraForm>(emptyJira())

    const selectedProject = useMemo(
        () => projects.find((p) => p.id === selectedProjectId),
        [projects, selectedProjectId]
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

    useEffect(() => {
        let cancelled = false
        async function boot() {
            setLoading(true)
            setError(null)
            try {
                const meRes = await backendJson<MeResponse>("/api/me")
                if (cancelled) return
                setMe(meRes.user || null)
                await refreshProjects()
            } catch (err) {
                if (!cancelled) setError(errText(err))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        boot()
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
            llm_base_url: p.llm_base_url || "",
            llm_model: p.llm_model || "",
            llm_api_key: p.llm_api_key || "",
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
    }, [selectedProject])

    async function onCreateProject(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
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
            setCreateForm(emptyProjectForm())
            await refreshProjects(created.id)
            setNotice(`Project ${created.key} created.`)
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
            if (type === "git") {
                await backendJson(`/api/admin/projects/${selectedProjectId}/connectors/git`, {
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
                await backendJson(`/api/admin/projects/${selectedProjectId}/connectors/confluence`, {
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
                await backendJson(`/api/admin/projects/${selectedProjectId}/connectors/jira`, {
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

            await refreshProjects(selectedProjectId)
            setNotice(`${type.toUpperCase()} connector saved.`)
        } catch (err) {
            setError(errText(err))
        } finally {
            setBusy(false)
        }
    }

    async function runIngest() {
        if (!selectedProjectId) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            const out = await backendJson<{ totalDocs?: number; totalChunks?: number; errors?: Record<string, string> }>(
                `/api/admin/projects/${selectedProjectId}/ingest`,
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

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-200">
                <div className="mx-auto max-w-5xl">Loading admin workspace...</div>
            </div>
        )
    }

    if (!me?.isGlobalAdmin) {
        return (
            <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-200">
                <div className="mx-auto max-w-3xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6">
                    <h1 className="text-xl font-semibold">Admin access required</h1>
                    <p className="mt-2 text-sm text-rose-100">
                        This page needs global admin privileges. Switch to an admin identity or enable dev admin mode.
                    </p>
                    <Link href="/projects" className="mt-4 inline-block rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-900">
                        Back to projects
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
            <div className="mx-auto max-w-7xl space-y-5">
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Admin Workflow</div>
                            <h1 className="mt-1 text-2xl font-semibold">Project + Source Configuration</h1>
                            <p className="mt-2 text-sm text-slate-400">
                                Create projects, configure Git/Confluence/Jira sources, choose Ollama or ChatGPT-compatible
                                LLM, then run ingestion.
                            </p>
                        </div>
                        <Link href="/projects" className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-950">
                            Back to Projects
                        </Link>
                    </div>
                </div>

                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
                )}
                {notice && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                        {notice}
                    </div>
                )}

                <div className="grid gap-5 xl:grid-cols-[380px,1fr]">
                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                        <h2 className="text-lg font-medium">New Project</h2>
                        <form onSubmit={onCreateProject} className="mt-3 space-y-3">
                            <label className="block text-sm">
                                Key
                                <input
                                    className={inputClassName()}
                                    value={createForm.key}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value }))}
                                    placeholder="qa-assist"
                                    required
                                />
                            </label>
                            <label className="block text-sm">
                                Name
                                <input
                                    className={inputClassName()}
                                    value={createForm.name}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                                    placeholder="QA Assistant"
                                    required
                                />
                            </label>
                            <label className="block text-sm">
                                Description
                                <textarea
                                    className={inputClassName()}
                                    value={createForm.description}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                                    rows={3}
                                />
                            </label>
                            <label className="block text-sm">
                                Local Repo Path
                                <input
                                    className={inputClassName()}
                                    value={createForm.repo_path}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, repo_path: e.target.value }))}
                                    placeholder="/workspace/repo"
                                />
                            </label>
                            <label className="block text-sm">
                                Default Branch
                                <input
                                    className={inputClassName()}
                                    value={createForm.default_branch}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, default_branch: e.target.value }))}
                                    placeholder="main"
                                />
                            </label>

                            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                                <div className="text-sm font-medium">LLM</div>
                                <label className="mt-2 block text-sm">
                                    Provider
                                    <select
                                        className={inputClassName()}
                                        value={createForm.llm_provider}
                                        onChange={(e) => setCreateForm((f) => ({ ...f, llm_provider: e.target.value }))}
                                    >
                                        <option value="ollama">Ollama (local)</option>
                                        <option value="openai">ChatGPT / OpenAI API</option>
                                    </select>
                                </label>
                                <label className="mt-2 block text-sm">
                                    Base URL
                                    <input
                                        className={inputClassName()}
                                        value={createForm.llm_base_url}
                                        onChange={(e) => setCreateForm((f) => ({ ...f, llm_base_url: e.target.value }))}
                                        placeholder="http://ollama:11434/v1 or https://api.openai.com/v1"
                                    />
                                </label>
                                <label className="mt-2 block text-sm">
                                    Model
                                    <input
                                        className={inputClassName()}
                                        value={createForm.llm_model}
                                        onChange={(e) => setCreateForm((f) => ({ ...f, llm_model: e.target.value }))}
                                        placeholder="llama3.2:3b or gpt-4o-mini"
                                    />
                                </label>
                                <label className="mt-2 block text-sm">
                                    API Key
                                    <input
                                        className={inputClassName()}
                                        value={createForm.llm_api_key}
                                        onChange={(e) => setCreateForm((f) => ({ ...f, llm_api_key: e.target.value }))}
                                        placeholder="ollama / sk-..."
                                    />
                                </label>
                            </div>

                            <button
                                type="submit"
                                disabled={busy}
                                className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-300 disabled:opacity-50"
                            >
                                Create Project
                            </button>
                        </form>
                    </section>

                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-medium">Selected Project</h2>
                            <select
                                className="ml-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                                value={selectedProjectId || ""}
                                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                            >
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} ({p.key})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {!selectedProject && (
                            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
                                No project selected.
                            </div>
                        )}

                        {selectedProject && (
                            <div className="mt-4 space-y-4">
                                <form onSubmit={onSaveProject} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="block text-sm">
                                            Key (read-only)
                                            <input className={inputClassName()} value={editForm.key} disabled />
                                        </label>
                                        <label className="block text-sm">
                                            Name
                                            <input
                                                className={inputClassName()}
                                                value={editForm.name}
                                                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                            />
                                        </label>
                                        <label className="block text-sm md:col-span-2">
                                            Description
                                            <textarea
                                                className={inputClassName()}
                                                rows={3}
                                                value={editForm.description}
                                                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                            />
                                        </label>
                                        <label className="block text-sm md:col-span-2">
                                            Local Repo Path
                                            <input
                                                className={inputClassName()}
                                                value={editForm.repo_path}
                                                onChange={(e) => setEditForm((f) => ({ ...f, repo_path: e.target.value }))}
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            Default Branch
                                            <input
                                                className={inputClassName()}
                                                value={editForm.default_branch}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, default_branch: e.target.value }))
                                                }
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            LLM Provider
                                            <select
                                                className={inputClassName()}
                                                value={editForm.llm_provider}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, llm_provider: e.target.value }))
                                                }
                                            >
                                                <option value="ollama">Ollama (local)</option>
                                                <option value="openai">ChatGPT / OpenAI API</option>
                                            </select>
                                        </label>
                                        <label className="block text-sm md:col-span-2">
                                            LLM Base URL
                                            <input
                                                className={inputClassName()}
                                                value={editForm.llm_base_url}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, llm_base_url: e.target.value }))
                                                }
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            LLM Model
                                            <input
                                                className={inputClassName()}
                                                value={editForm.llm_model}
                                                onChange={(e) => setEditForm((f) => ({ ...f, llm_model: e.target.value }))}
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            LLM API Key
                                            <input
                                                className={inputClassName()}
                                                value={editForm.llm_api_key}
                                                onChange={(e) =>
                                                    setEditForm((f) => ({ ...f, llm_api_key: e.target.value }))
                                                }
                                            />
                                        </label>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={busy}
                                        className="mt-3 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-300 disabled:opacity-50"
                                    >
                                        Save Project Settings
                                    </button>
                                </form>

                                <div className="grid gap-4 lg:grid-cols-3">
                                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                                        <div className="text-sm font-medium">Git Source</div>
                                        <label className="mt-2 flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={gitForm.isEnabled}
                                                onChange={(e) => setGitForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                            />
                                            Enabled
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Owner
                                            <input
                                                className={inputClassName()}
                                                value={gitForm.owner}
                                                onChange={(e) => setGitForm((f) => ({ ...f, owner: e.target.value }))}
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Repo
                                            <input
                                                className={inputClassName()}
                                                value={gitForm.repo}
                                                onChange={(e) => setGitForm((f) => ({ ...f, repo: e.target.value }))}
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Branch
                                            <input
                                                className={inputClassName()}
                                                value={gitForm.branch}
                                                onChange={(e) => setGitForm((f) => ({ ...f, branch: e.target.value }))}
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Token
                                            <input
                                                className={inputClassName()}
                                                value={gitForm.token}
                                                onChange={(e) => setGitForm((f) => ({ ...f, token: e.target.value }))}
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Paths (comma separated)
                                            <input
                                                className={inputClassName()}
                                                value={gitForm.paths}
                                                onChange={(e) => setGitForm((f) => ({ ...f, paths: e.target.value }))}
                                                placeholder="src, docs"
                                            />
                                        </label>
                                        <button
                                            onClick={() => void saveConnector("git")}
                                            disabled={busy}
                                            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-900 disabled:opacity-50"
                                        >
                                            Save Git
                                        </button>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                                        <div className="text-sm font-medium">Confluence Source</div>
                                        <label className="mt-2 flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={confluenceForm.isEnabled}
                                                onChange={(e) =>
                                                    setConfluenceForm((f) => ({ ...f, isEnabled: e.target.checked }))
                                                }
                                            />
                                            Enabled
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Base URL
                                            <input
                                                className={inputClassName()}
                                                value={confluenceForm.baseUrl}
                                                onChange={(e) =>
                                                    setConfluenceForm((f) => ({ ...f, baseUrl: e.target.value }))
                                                }
                                                placeholder="https://your-domain.atlassian.net/wiki"
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Space Key
                                            <input
                                                className={inputClassName()}
                                                value={confluenceForm.spaceKey}
                                                onChange={(e) =>
                                                    setConfluenceForm((f) => ({ ...f, spaceKey: e.target.value }))
                                                }
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Email
                                            <input
                                                className={inputClassName()}
                                                value={confluenceForm.email}
                                                onChange={(e) =>
                                                    setConfluenceForm((f) => ({ ...f, email: e.target.value }))
                                                }
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            API Token
                                            <input
                                                className={inputClassName()}
                                                value={confluenceForm.apiToken}
                                                onChange={(e) =>
                                                    setConfluenceForm((f) => ({ ...f, apiToken: e.target.value }))
                                                }
                                            />
                                        </label>
                                        <button
                                            onClick={() => void saveConnector("confluence")}
                                            disabled={busy}
                                            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-900 disabled:opacity-50"
                                        >
                                            Save Confluence
                                        </button>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                                        <div className="text-sm font-medium">Jira Source</div>
                                        <label className="mt-2 flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={jiraForm.isEnabled}
                                                onChange={(e) => setJiraForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                                            />
                                            Enabled
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Base URL
                                            <input
                                                className={inputClassName()}
                                                value={jiraForm.baseUrl}
                                                onChange={(e) => setJiraForm((f) => ({ ...f, baseUrl: e.target.value }))}
                                                placeholder="https://your-domain.atlassian.net"
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            Email
                                            <input
                                                className={inputClassName()}
                                                value={jiraForm.email}
                                                onChange={(e) => setJiraForm((f) => ({ ...f, email: e.target.value }))}
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            API Token
                                            <input
                                                className={inputClassName()}
                                                value={jiraForm.apiToken}
                                                onChange={(e) => setJiraForm((f) => ({ ...f, apiToken: e.target.value }))}
                                            />
                                        </label>
                                        <label className="mt-2 block text-sm">
                                            JQL
                                            <input
                                                className={inputClassName()}
                                                value={jiraForm.jql}
                                                onChange={(e) => setJiraForm((f) => ({ ...f, jql: e.target.value }))}
                                                placeholder="project = CORE ORDER BY updated DESC"
                                            />
                                        </label>
                                        <button
                                            onClick={() => void saveConnector("jira")}
                                            disabled={busy}
                                            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-900 disabled:opacity-50"
                                        >
                                            Save Jira
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                                    <h3 className="text-sm font-medium">Ingestion</h3>
                                    <p className="mt-1 text-sm text-slate-400">
                                        Pull configured source data and reindex this project for retrieval.
                                    </p>
                                    <button
                                        onClick={() => void runIngest()}
                                        disabled={busy}
                                        className="mt-3 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-300 disabled:opacity-50"
                                    >
                                        Run Ingestion
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    )
}

