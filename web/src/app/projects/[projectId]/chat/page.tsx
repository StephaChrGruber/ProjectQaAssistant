"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { backendJson } from "@/lib/backend"

type ChatMessage = {
    role: "user" | "assistant" | "system"
    content: string
    ts?: string
}

type Project = {
    _id: string
    key?: string
    name?: string
}

type AskAgentResponse = {
    answer: string
    sources?: Array<{
        title?: string
        url?: string
        kind?: string
        score?: number
    }>
}

function cx(...xs: Array<string | false | null | undefined>) {
    return xs.filter(Boolean).join(" ")
}

// Split ```chart ...``` blocks (render JSON for now)
function splitChartBlocks(text: string): Array<
    | { type: "text"; value: string }
    | { type: "chart"; value: string }
> {
    const parts: Array<{ type: "text" | "chart"; value: string }> = []
    const re = /```chart\s*([\s\S]*?)```/g
    let last = 0
    let m: RegExpExecArray | null

    while ((m = re.exec(text)) !== null) {
        const start = m.index
        const end = re.lastIndex
        if (start > last) parts.push({ type: "text", value: text.slice(last, start) })
        parts.push({ type: "chart", value: (m[1] ?? "").trim() })
        last = end
    }
    if (last < text.length) parts.push({ type: "text", value: text.slice(last) })
    return parts
}

export default function ProjectChatPage() {
    const { projectId } = useParams<{ projectId: string }>()

    const [branch, setBranch] = useState("main")
    const [user, setUser] = useState(process.env.NEXT_PUBLIC_DEV_USER || "dev")

    const [project, setProject] = useState<Project | null>(null)
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const scrollRef = useRef<HTMLDivElement | null>(null)

    const chatId = useMemo(() => {
        // 1 chat per project + branch + user
        return `${projectId}::${branch}::${user}`
    }, [projectId, branch, user])

    function scrollToBottom() {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
    }

    async function loadProject() {
        setError(null)
        try {
            const p = await backendJson<Project>(`/api/projects/${projectId}`)
            setProject(p)
        } catch (e: any) {
            setProject(null)
            setError(String(e?.message || e))
        }
    }

    async function ensureAndLoadChat(currentChatId: string) {
        // 1) Ensure chat exists in Mongo (upsert)
        // 2) Load chat messages
        setError(null)

        try {
            await backendJson(`/api/chats/ensure`, {
                method: "POST",
                body: JSON.stringify({
                    chat_id: currentChatId,
                    project_id: projectId,
                    branch,
                    user,
                    messages: [],
                }),
            })
        } catch (e: any) {
            // If ensure fails, we still try to load (maybe it exists already)
            // but show a banner so you notice.
            setError(String(e?.message || e))
        }

        try {
            const doc = await backendJson<{ messages: ChatMessage[] }>(
                `/api/chats/${encodeURIComponent(currentChatId)}`
            )
            setMessages(doc.messages || [])
        } catch (e: any) {
            // If chat truly doesn't exist or route missing, show empty but keep banner
            setMessages([])
            if (!error) setError(String(e?.message || e))
        }
    }

    useEffect(() => {
        loadProject()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId])

    useEffect(() => {
        ensureAndLoadChat(chatId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId])

    useEffect(() => {
        scrollToBottom()
    }, [messages, loading])

    async function send() {
        const q = input.trim()
        if (!q || loading) return

        setError(null)
        setInput("")
        setLoading(true)

        // Optimistic UI: show user message instantly
        setMessages((m) => [...m, { role: "user", content: q, ts: new Date().toISOString() }])
        scrollToBottom()

        try {
            // IMPORTANT: match your backend request model
            // Your FastAPI currently expects: project_id + question (+ branch/user/top_k)
            const res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                method: "POST",
                body: JSON.stringify({
                    project_id: projectId,
                    branch,
                    user,
                    top_k: 8,
                    question: q,
                }),
            })

            const assistantText =
                (res?.answer || "").trim() ||
                "I didn’t get an answer back. Check backend logs for /ask_agent."

            // Add assistant message optimistically…
            setMessages((m) => [...m, { role: "assistant", content: assistantText, ts: new Date().toISOString() }])

            // …but then refresh from Mongo as source-of-truth (persistent history)
            await ensureAndLoadChat(chatId)
        } catch (e: any) {
            setError(String(e?.message || e))
            setMessages((m) => [
                ...m,
                {
                    role: "assistant",
                    content:
                        "⚠️ Request failed. Check the error banner. If this is a backend 404/500, verify your Next `/api/*` proxy routes and backend logs.",
                    ts: new Date().toISOString(),
                },
            ])
        } finally {
            setLoading(false)
            scrollToBottom()
        }
    }

    async function clearChat() {
        setError(null)
        try {
            await backendJson(`/api/chats/${encodeURIComponent(chatId)}/clear`, { method: "POST" })
            await ensureAndLoadChat(chatId)
        } catch (e: any) {
            setMessages([])
            setError(String(e?.message || e))
        }
    }

    return (
        <div className="flex h-screen w-full bg-slate-50">
            {/* Sidebar */}
            <aside className="hidden w-80 shrink-0 border-r bg-white md:flex md:flex-col">
                <div className="border-b px-4 py-3">
                    <Link href="/projects" className="text-sm text-slate-600 hover:underline">
                        ← Projects
                    </Link>
                    <div className="mt-2">
                        <div className="text-xs text-slate-500">Project</div>
                        <div className="truncate text-sm font-medium text-slate-900">
                            {project?.name || project?.key || projectId}
                        </div>
                        <div className="truncate text-xs text-slate-500">{projectId}</div>
                    </div>
                </div>

                <div className="space-y-4 px-4 py-4">
                    <div>
                        <label className="text-xs font-medium text-slate-700">Branch</label>
                        <input
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                            placeholder="main"
                        />
                        <div className="mt-1 text-xs text-slate-500">One chat per project + branch + user.</div>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-slate-700">User</label>
                        <input
                            value={user}
                            onChange={(e) => setUser(e.target.value)}
                            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                            placeholder="dev"
                        />
                    </div>

                    <button
                        onClick={clearChat}
                        className="w-full rounded-lg border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    >
                        Clear chat
                    </button>

                    <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                        Tip: Ask for diagrams or charts by returning a <code>```chart</code> JSON block.
                    </div>

                    <div className="rounded-lg border bg-white p-3 text-xs text-slate-600">
                        <div className="font-semibold text-slate-800">Chat ID</div>
                        <div className="mt-1 break-all">{chatId}</div>
                    </div>
                </div>
            </aside>

            {/* Main */}
            <main className="flex flex-1 flex-col">
                {/* Mobile header */}
                <div className="flex items-center justify-between border-b bg-white px-4 py-3 md:hidden">
                    <Link href="/projects" className="text-sm text-slate-600 hover:underline">
                        ← Projects
                    </Link>
                    <div className="min-w-0 text-right">
                        <div className="truncate text-sm font-medium">{project?.name || project?.key || projectId}</div>
                        <div className="truncate text-xs text-slate-500">
                            branch: {branch} · user: {user}
                        </div>
                    </div>
                </div>

                {/* Error banner */}
                {error && (
                    <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
                        {error}
                    </div>
                )}

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="mx-auto max-w-3xl space-y-4">
                        {messages.length === 0 && (
                            <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">
                                Chat is empty.
                                <div className="mt-1 text-xs text-slate-500">
                                    Ask something about the project. The backend should retrieve relevant chunks from storage.
                                </div>
                            </div>
                        )}

                        {messages.map((m, idx) => {
                            const isUser = m.role === "user"
                            return (
                                <div key={idx} className={cx("flex", isUser ? "justify-end" : "justify-start")}>
                                    <div
                                        className={cx(
                                            "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
                                            isUser ? "bg-slate-900 text-white" : "bg-white text-slate-900 border"
                                        )}
                                    >
                                        {splitChartBlocks(m.content).map((p, i) => {
                                            if (p.type === "chart") {
                                                return (
                                                    <div key={i} className="mt-3 rounded-lg border bg-slate-50 p-3">
                                                        <div className="mb-2 text-xs font-semibold text-slate-600">chart</div>
                                                        <pre className="overflow-x-auto text-xs text-slate-800">{p.value}</pre>
                                                    </div>
                                                )
                                            }
                                            return (
                                                <p key={i} className="whitespace-pre-wrap">
                                                    {p.value}
                                                </p>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}

                        {loading && (
                            <div className="flex justify-start">
                                <div className="rounded-2xl border bg-white px-4 py-3 text-sm text-slate-600">
                                    Thinking…
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Composer */}
                <div className="border-t bg-white px-4 py-4">
                    <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        send()
                    }
                }}
                placeholder="Ask about onboarding, architecture, endpoints, code, bugs… (Enter to send, Shift+Enter for newline)"
                className="min-h-[44px] max-h-40 flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            />
                        <button
                            onClick={send}
                            disabled={loading || !input.trim()}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                            Send
                        </button>
                    </div>
                </div>
            </main>
        </div>
    )
}
