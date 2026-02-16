"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"

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

    const projectLabel = useMemo(
        () => project?.name || project?.key || projectId,
        [project?.name, project?.key, projectId]
    )
    const userId = useMemo(() => me?.email || "dev@local", [me])

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
            } catch (err) {
                if (!cancelled) setError(errText(err))
            }
        }

        boot()
        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        void loadChats().catch((err) => setError(errText(err)))
    }, [loadChats])

    const onSelectChat = useCallback(
        (chatId: string) => {
            router.push(`/projects/${projectId}/chat?chat=${encodeURIComponent(chatId)}`)
        },
        [projectId, router]
    )

    const onNewChat = useCallback(() => {
        const chatId = makeChatId(projectId, branch, userId)
        router.push(`/projects/${projectId}/chat?chat=${encodeURIComponent(chatId)}`)
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
        >
            <main className="min-h-0 flex-1 overflow-y-auto bg-slate-950 px-4 py-6">
                <div className="mx-auto max-w-4xl space-y-5">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                        <div className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Workspace Settings</div>
                        <h1 className="mt-2 text-2xl font-semibold text-slate-100">{projectLabel}</h1>
                        <p className="mt-2 text-sm text-slate-400">
                            Configure where the assistant reads from and which model stack it should use.
                        </p>
                    </div>

                    {error && (
                        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
                            {error}
                        </div>
                    )}

                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                        <h2 className="text-lg font-medium text-slate-100">Project</h2>
                        <div className="mt-3 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Project ID</div>
                                <div className="mt-1 break-all">{projectId}</div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Default Branch</div>
                                <div className="mt-1">{project?.default_branch || "main"}</div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 md:col-span-2">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Local Repo Path</div>
                                <div className="mt-1 break-all">{project?.repo_path || "not configured"}</div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 md:col-span-2">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Description</div>
                                <div className="mt-1">{project?.description || "No description"}</div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                        <h2 className="text-lg font-medium text-slate-100">LLM Settings</h2>
                        <div className="mt-3 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Provider</div>
                                <div className="mt-1">{project?.llm_provider || "default"}</div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Model</div>
                                <div className="mt-1">{project?.llm_model || "backend default"}</div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 md:col-span-2">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Base URL</div>
                                <div className="mt-1 break-all">{project?.llm_base_url || "backend default"}</div>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 md:col-span-2">
                                <div className="text-xs uppercase tracking-[0.15em] text-slate-500">API Key</div>
                                <div className="mt-1">{maskSecret(project?.llm_api_key)}</div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                        <h2 className="text-lg font-medium text-slate-100">Sources</h2>
                        <p className="mt-2 text-sm text-slate-400">
                            Git, Confluence, and Jira connectors are managed from the admin console and ingested into this
                            project index.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                                href={`/projects/${projectId}/chat`}
                                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-300"
                            >
                                Open Chat
                            </Link>
                            {me?.isGlobalAdmin && (
                                <Link
                                    href="/admin"
                                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-950"
                                >
                                    Open Admin Workflow
                                </Link>
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </ProjectDrawerLayout>
    )
}

