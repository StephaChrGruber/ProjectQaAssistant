"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { readLastChat } from "@/lib/last-chat"
import { backendJson } from "@/lib/backend"

type ProjectDoc = {
    _id: string
    default_branch?: string
}

export default function Home() {
    const router = useRouter()

    useEffect(() => {
        let cancelled = false

        async function go() {
            const last = readLastChat()
            if (last?.path) {
                router.replace(last.path)
                return
            }

            try {
                const projects = await backendJson<ProjectDoc[]>("/api/projects")
                if (cancelled) return
                const first = projects[0]
                if (first?._id) {
                    router.replace(`/projects/${encodeURIComponent(first._id)}/chat`)
                    return
                }
            } catch {
                // Fallback below.
            }

            if (!cancelled) {
                router.replace("/projects")
            }
        }

        void go()
        return () => {
            cancelled = true
        }
    }, [router])

    return (
        <main className="flex min-h-screen items-center justify-center px-6">
            <div className="rounded-2xl border border-white/15 bg-slate-900/70 px-6 py-4 text-sm text-slate-300 backdrop-blur">
                Restoring your workspace...
            </div>
        </main>
    )
}

