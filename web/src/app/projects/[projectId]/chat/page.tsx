"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"

type ChatMessage = {
    role: "user" | "assistant" | "system" | "tool"
    content: string
    ts?: string
}

type ProjectDoc = {
    _id: string
    key?: string
    name?: string
    default_branch?: string
    llm_provider?: string
    llm_model?: string
}

type MeResponse = {
    user?: DrawerUser
}

type BranchesResponse = {
    branches?: string[]
}

type ChatResponse = {
    chat_id: string
    messages: ChatMessage[]
}

type AskAgentResponse = {
    answer?: string
}

function splitChartBlocks(text: string): Array<{ type: "text" | "chart"; value: string }> {
    const parts: Array<{ type: "text" | "chart"; value: string }> = []
    const re = /```chart\s*([\s\S]*?)```/g
    let last = 0
    let m: RegExpExecArray | null

    while ((m = re.exec(text)) !== null) {
        const start = m.index
        const end = re.lastIndex
        if (start > last) {
            parts.push({ type: "text", value: text.slice(last, start) })
        }
        parts.push({ type: "chart", value: (m[1] ?? "").trim() })
        last = end
    }
    if (last < text.length) {
        parts.push({ type: "text", value: text.slice(last) })
    }
    return parts
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

function makeChatId(projectId: string, branch: string, user: string): string {
    return `${projectId}::${branch}::${user}::${Date.now().toString(36)}`
}

export default function ProjectChatPage() {
    const { projectId } = useParams<{ projectId: string }>()
    const searchParams = useSearchParams()
    const preferredChatFromUrl = searchParams.get("chat")

    const [me, setMe] = useState<DrawerUser | null>(null)
    const [project, setProject] = useState<ProjectDoc | null>(null)
    const [branches, setBranches] = useState<string[]>(["main"])
    const [branch, setBranch] = useState("main")

    const [chats, setChats] = useState<DrawerChat[]>([])
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
    const selectedChatIdRef = useRef<string | null>(null)

    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState("")
    const [loadingChats, setLoadingChats] = useState(false)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [booting, setBooting] = useState(true)

    const scrollRef = useRef<HTMLDivElement | null>(null)

    const userId = useMemo(() => me?.email || "dev@local", [me])
    const projectLabel = useMemo(
        () => project?.name || project?.key || projectId,
        [project?.key, project?.name, projectId]
    )

    useEffect(() => {
        selectedChatIdRef.current = selectedChatId
    }, [selectedChatId])

    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
    }, [])

    const ensureChat = useCallback(
        async (chatId: string) => {
            await backendJson<ChatResponse>("/api/chats/ensure", {
                method: "POST",
                body: JSON.stringify({
                    chat_id: chatId,
                    project_id: projectId,
                    branch,
                    user: userId,
                    messages: [],
                }),
            })
        },
        [branch, projectId, userId]
    )

    const loadMessages = useCallback(async (chatId: string) => {
        const doc = await backendJson<ChatResponse>(`/api/chats/${encodeURIComponent(chatId)}`)
        setMessages(doc.messages || [])
    }, [])

    const loadChats = useCallback(
        async (preferredChatId?: string) => {
            setLoadingChats(true)
            try {
                const docs = await backendJson<DrawerChat[]>(
                    `/api/projects/${projectId}/chats?branch=${encodeURIComponent(branch)}&limit=100`
                )
                if (preferredChatId && !docs.some((c) => c.chat_id === preferredChatId)) {
                    await ensureChat(preferredChatId)
                    const now = new Date().toISOString()
                    const merged = [
                        {
                            chat_id: preferredChatId,
                            title: `${projectLabel} / ${branch}`,
                            branch,
                            updated_at: now,
                            created_at: now,
                        },
                        ...docs,
                    ]
                    setChats(merged)
                    setSelectedChatId(preferredChatId)
                    return preferredChatId
                }
                if (!docs.length) {
                    const fallback = preferredChatId || `${projectId}::${branch}::${userId}`
                    await ensureChat(fallback)
                    const now = new Date().toISOString()
                    setChats([
                        {
                            chat_id: fallback,
                            title: `${projectLabel} / ${branch}`,
                            branch,
                            updated_at: now,
                            created_at: now,
                        },
                    ])
                    setSelectedChatId(fallback)
                    return fallback
                }

                setChats(docs)
                const current = preferredChatId || selectedChatIdRef.current
                const next =
                    (current && docs.some((c) => c.chat_id === current) && current) || docs[0].chat_id || null
                setSelectedChatId(next)
                return next
            } finally {
                setLoadingChats(false)
            }
        },
        [branch, ensureChat, projectId, projectLabel, userId]
    )

    useEffect(() => {
        let cancelled = false
        async function boot() {
            setBooting(true)
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
                    const branchesRes = await backendJson<BranchesResponse>(`/api/projects/${projectId}/branches`)
                    b = (branchesRes.branches || []).filter(Boolean)
                } catch {
                    b = []
                }

                if (!b.length) {
                    b = [projectRes.default_branch || "main"]
                }

                setBranches(b)
                setBranch((prev) => {
                    if (prev && b.includes(prev)) return prev
                    const preferred = (projectRes.default_branch || "").trim()
                    if (preferred && b.includes(preferred)) return preferred
                    return b[0] || "main"
                })
            } catch (err) {
                if (cancelled) return
                setError(errText(err))
            } finally {
                if (!cancelled) {
                    setBooting(false)
                }
            }
        }

        boot()
        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        if (!projectId || !branch) return
        let cancelled = false

        async function load() {
            try {
                await loadChats(preferredChatFromUrl || undefined)
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [branch, loadChats, preferredChatFromUrl, projectId])

    useEffect(() => {
        if (!selectedChatId) return
        const chatId = selectedChatId
        let cancelled = false

        async function syncSelectedChat() {
            setLoadingMessages(true)
            setError(null)
            try {
                await ensureChat(chatId)
                await loadMessages(chatId)
            } catch (err) {
                if (!cancelled) {
                    setMessages([])
                    setError(errText(err))
                }
            } finally {
                if (!cancelled) {
                    setLoadingMessages(false)
                }
            }
        }

        syncSelectedChat()
        return () => {
            cancelled = true
        }
    }, [ensureChat, loadMessages, selectedChatId])

    useEffect(() => {
        scrollToBottom()
    }, [messages, sending, scrollToBottom])

    const onNewChat = useCallback(async () => {
        const newChatId = makeChatId(projectId, branch, userId)
        setError(null)
        try {
            await ensureChat(newChatId)
            await loadChats(newChatId)
            setMessages([])
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, ensureChat, loadChats, projectId, userId])

    const send = useCallback(async () => {
        const q = input.trim()
        if (!q || sending || !selectedChatId) return

        setSending(true)
        setError(null)
        setInput("")

        setMessages((prev) => [...prev, { role: "user", content: q, ts: new Date().toISOString() }])

        try {
            const res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                method: "POST",
                body: JSON.stringify({
                    project_id: projectId,
                    branch,
                    user: userId,
                    chat_id: selectedChatId,
                    top_k: 8,
                    question: q,
                }),
            })

            if (res.answer?.trim()) {
                setMessages((prev) => [...prev, { role: "assistant", content: res.answer || "", ts: new Date().toISOString() }])
            }

            await loadMessages(selectedChatId)
            await loadChats(selectedChatId)
        } catch (err) {
            setError(errText(err))
        } finally {
            setSending(false)
        }
    }, [branch, input, loadChats, loadMessages, projectId, selectedChatId, sending, userId])

    const clearChat = useCallback(async () => {
        if (!selectedChatId) return
        setError(null)
        try {
            await backendJson(`/api/chats/${encodeURIComponent(selectedChatId)}/clear`, { method: "POST" })
            await loadMessages(selectedChatId)
            await loadChats(selectedChatId)
        } catch (err) {
            setError(errText(err))
        }
    }, [loadChats, loadMessages, selectedChatId])

    return (
        <ProjectDrawerLayout
            projectId={projectId}
            projectLabel={projectLabel}
            branch={branch}
            branches={branches}
            onBranchChange={setBranch}
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={setSelectedChatId}
            onNewChat={onNewChat}
            user={me}
            loadingChats={loadingChats}
        >
            <main className="flex min-h-0 flex-1 flex-col bg-slate-950">
                <div className="border-b border-slate-800 px-5 py-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">RAG Chat</div>
                    <div className="mt-1 text-sm text-slate-200">
                        {projectLabel} · {branch}
                    </div>
                    <div className="text-xs text-slate-500">
                        {(project?.llm_provider || "default LLM").toUpperCase()}
                        {project?.llm_model ? ` · ${project.llm_model}` : ""}
                    </div>
                </div>

                {error && (
                    <div className="border-b border-rose-500/30 bg-rose-500/10 px-5 py-2 text-sm text-rose-200">
                        {error}
                    </div>
                )}

                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
                    <div className="mx-auto max-w-4xl space-y-4">
                        {booting && (
                            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                                Loading workspace...
                            </div>
                        )}

                        {!booting && !loadingMessages && messages.length === 0 && (
                            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                                No messages yet. Ask about code, Jira tickets, Confluence pages, or cross-source context.
                            </div>
                        )}

                        {messages.map((m, idx) => {
                            const isUser = m.role === "user"
                            return (
                                <div key={`${m.ts || idx}-${idx}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                                    <div
                                        className={[
                                            "max-w-[88%] rounded-2xl border px-4 py-3 text-sm leading-relaxed shadow-sm",
                                            isUser
                                                ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
                                                : "border-slate-800 bg-slate-900 text-slate-100",
                                        ].join(" ")}
                                    >
                                        {splitChartBlocks(m.content || "").map((p, i) => {
                                            if (p.type === "chart") {
                                                return (
                                                    <div key={i} className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
                                                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                                            chart
                                                        </div>
                                                        <pre className="overflow-x-auto text-xs text-slate-200">{p.value}</pre>
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

                        {(sending || loadingMessages) && (
                            <div className="flex justify-start">
                                <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">
                                    Thinking...
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="border-t border-slate-800 bg-slate-950 px-4 py-4">
                    <div className="mx-auto flex max-w-4xl items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault()
                                    void send()
                                }
                            }}
                            placeholder="Ask anything about this project (Enter to send, Shift+Enter newline)"
                            className="min-h-[46px] max-h-44 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 placeholder:text-slate-500 focus:ring-2"
                        />
                        <button
                            onClick={() => void clearChat()}
                            disabled={!selectedChatId || sending}
                            className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => void send()}
                            disabled={sending || !input.trim() || !selectedChatId}
                            className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-300 disabled:opacity-50"
                        >
                            Send
                        </button>
                    </div>
                </div>
            </main>
        </ProjectDrawerLayout>
    )
}
