"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { backendJson } from "@/lib/backend"
import { readLastChat } from "@/lib/last-chat"

type Project = {
    _id: string
    key?: string
    name?: string
    description?: string
    default_branch?: string
    llm_provider?: string
    llm_model?: string
}

type MeResponse = {
    user?: {
        displayName?: string
        email?: string
        isGlobalAdmin?: boolean
    }
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

export default function ProjectsPage() {
    const router = useRouter()
    const [projects, setProjects] = useState<Project[]>([])
    const [me, setMe] = useState<MeResponse["user"] | null>(null)
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            setErr(null)
            try {
                const [meRes, projectRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<Project[]>("/api/projects"),
                ])
                if (cancelled) return
                setMe(meRes.user || null)
                setProjects(projectRes)
            } catch (e) {
                if (!cancelled) setErr(errText(e))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        void load()
        return () => {
            cancelled = true
        }
    }, [])

    const userLabel = useMemo(() => me?.displayName || me?.email || "Developer", [me])
    const hasLastChat = useMemo(() => Boolean(readLastChat()?.path), [])

    return (
        <div className="min-h-screen px-4 py-8 text-slate-100">
            <div className="page-rise mx-auto max-w-6xl space-y-6">
                <section className="glass-card rounded-3xl p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="max-w-3xl">
                            <div className="inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-100">
                                Project QA Assistant
                            </div>
                            <h1 className="mt-3 text-3xl font-semibold leading-tight text-white">Choose A Workspace</h1>
                            <p className="mt-3 text-sm text-slate-300">
                                All conversations are branch-aware and source-backed by Git, Confluence, and Jira.
                            </p>
                        </div>
                        <div className="space-y-2 text-right">
                            <div className="text-sm text-slate-200">{userLabel}</div>
                            <div className="flex flex-wrap justify-end gap-2">
                                {hasLastChat && (
                                    <button
                                        onClick={() => {
                                            const last = readLastChat()
                                            if (last?.path) router.push(last.path)
                                        }}
                                        className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-300/20"
                                    >
                                        Resume Last Chat
                                    </button>
                                )}
                                {me?.isGlobalAdmin && (
                                    <Link
                                        href="/admin"
                                        className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.08]"
                                    >
                                        Admin
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {err && (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                        {err}
                    </div>
                )}

                {loading && (
                    <div className="glass-card rounded-2xl p-4 text-sm text-slate-300">
                        Loading projects...
                    </div>
                )}

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {projects.map((p, idx) => (
                        <article
                            key={p._id}
                            className="glass-card page-rise rounded-2xl p-4"
                            style={{ animationDelay: `${Math.min(idx * 50, 260)}ms` }}
                        >
                            <div className="text-lg font-medium text-white">{p.name || p.key || p._id}</div>
                            <div className="mt-1 text-xs text-slate-400">{p._id}</div>
                            <p className="mt-3 min-h-10 text-sm text-slate-300">{p.description || "No description"}</p>
                            <div className="mt-3 text-xs text-slate-400">
                                {(p.llm_provider || "default LLM").toUpperCase()}
                                {p.llm_model ? ` · ${p.llm_model}` : ""}
                                {` · ${p.default_branch || "main"}`}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Link
                                    href={`/projects/${p._id}/chat`}
                                    className="rounded-xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:from-cyan-200 hover:to-emerald-200"
                                >
                                    Open Chat
                                </Link>
                                <Link
                                    href={`/projects/${p._id}/settings`}
                                    className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 hover:bg-white/[0.08]"
                                >
                                    Settings
                                </Link>
                            </div>
                        </article>
                    ))}
                </section>

                {!loading && !err && projects.length === 0 && (
                    <div className="glass-card rounded-2xl p-4 text-sm text-slate-300">
                        No projects found. Create one in the admin workflow.
                    </div>
                )}
            </div>
        </div>
    )
}

