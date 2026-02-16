// web/src/app/projects/page.tsx
"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

type Project = { _id: string; key?: string; name?: string }

export default function ProjectsPage() {
    const [projects, setProjects] = useState<Project[]>([])
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        ;(async () => {
            try {
                const res = await fetch("/api/projects", { cache: "no-store" })
                if (!res.ok) throw new Error(await res.text())
                const data = (await res.json()) as Project[]
                setProjects(data)
            } catch (e: any) {
                setErr(e?.message || String(e))
            }
        })()
    }, [])

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl px-4 py-8">
                <h1 className="text-2xl font-semibold">Projects</h1>

                {err && (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {err}
                    </div>
                )}

                <div className="mt-6 space-y-2">
                    {projects.map((p) => {
                        const title = p.name || p.key || p._id
                        return (
                            <Link
                                key={p._id}
                                href={`/projects/${p._id}/chat`}
                                className="block rounded-xl border bg-white p-4 hover:bg-slate-50"
                            >
                                <div className="font-medium">{title}</div>
                                <div className="text-xs text-slate-500">{p._id}</div>
                            </Link>
                        )
                    })}

                    {!err && projects.length === 0 && (
                        <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">
                            No projects found.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
