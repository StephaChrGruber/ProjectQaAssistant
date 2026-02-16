"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { backendJson } from "@/lib/backend"
import { redirect } from "next/navigation"

type Project = { _id: string; key?: string; name?: string }

export default function Home() {
    redirect("/projects")
}

/*export default function Home() {
    const [projects, setProjects] = useState<Project[]>([])
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        backendJson<Project[]>("/api/projects")
            .then(setProjects)
            .catch((e) => setErr(String(e)))
    }, [])

    return (
        <div style={{ padding: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>Projects</h1>
            {err ? <pre style={{ color: "crimson" }}>{err}</pre> : null}

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {projects.map((p) => (
                    <div key={p._id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
                        <div style={{ fontWeight: 700 }}>{p.name || p.key || p._id}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>{p._id}</div>
                        <div style={{ marginTop: 8 }}>
                            <Link href={`/projects/${p._id}/chat`}>Open chat</Link>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}*/
