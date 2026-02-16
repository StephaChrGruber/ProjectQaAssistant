"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { backendJson } from "@/lib/backend"

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
        load()
        return () => {
            cancelled = true
        }
    }, [])

    const userLabel = useMemo(() => me?.displayName || me?.email || "Developer", [me])

    return (
        <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
            <div className="mx-auto max-w-6xl">
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-xs uppercase tracking-[0.24em] text-cyan-300/80">Project QA Assistant</div>
                            <h1 className="mt-1 text-2xl font-semibold">Workspace</h1>
                            <p className="mt-2 text-sm text-slate-400">
                                Select a project to open the RAG chat, switch branches, and search across Git, Confluence, and Jira.
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-slate-300">{userLabel}</div>
                            {me?.isGlobalAdmin && (
                                <Link
                                    href="/admin"
                                    className="mt-2 inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-950"
                                >
                                    Admin
                                </Link>
                            )}
                        </div>
                    </div>
                </div>

                {err && (
                    <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>
                )}

                {loading && (
                    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                        Loading projects...
                    </div>
                )}

                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {projects.map((p) => (
                        <div key={p._id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                            <div className="text-lg font-medium">{p.name || p.key || p._id}</div>
                            <div className="mt-1 text-xs text-slate-500">{p._id}</div>
                            <div className="mt-2 text-sm text-slate-400">{p.description || "No description"}</div>
                            <div className="mt-3 text-xs text-slate-500">
                                {(p.llm_provider || "default LLM").toUpperCase()}
                                {p.llm_model ? ` · ${p.llm_model}` : ""}
                                {` · branch ${p.default_branch || "main"}`}
                            </div>
                            <div className="mt-4 flex gap-2">
                                <Link
                                    href={`/projects/${p._id}/chat`}
                                    className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-300"
                                >
                                    Open Chat
                                </Link>
                                <Link
                                    href={`/projects/${p._id}/settings`}
                                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-950"
                                >
                                    Settings
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>

                {!loading && !err && projects.length === 0 && (
                    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                        No projects found. Use the admin workflow to create one.
                    </div>
                )}
            </div>
        </div>
    )
}

