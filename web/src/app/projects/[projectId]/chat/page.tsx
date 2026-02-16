"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"

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
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialChatRef = useRef(searchParams.get("chat"))
    const initialBranchRef = useRef(searchParams.get("branch"))

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
    const projectLabel = useMemo(() => project?.name || project?.key || projectId, [project, projectId])
    const userId = useMemo(() => me?.email || "dev@local", [me])

    useEffect(() => {
        selectedChatIdRef.current = selectedChatId
    }, [selectedChatId])

    const syncUrl = useCallback(
        (chatId: string, activeBranch: string) => {
            const next = buildChatPath(projectId, activeBranch, chatId)
            router.replace(next)
        },
        [projectId, router]
    )

    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
    }, [])

    const ensureChat = useCallback(
        async (chatId: string, activeBranch: string) => {
            await backendJson<ChatResponse>("/api/chats/ensure", {
                method: "POST",
                body: JSON.stringify({
                    chat_id: chatId,
                    project_id: projectId,
                    branch: activeBranch,
                    user: userId,
                    messages: [],
                }),
            })
        },
        [projectId, userId]
    )

    const loadMessages = useCallback(async (chatId: string) => {
        const doc = await backendJson<ChatResponse>(`/api/chats/${encodeURIComponent(chatId)}`)
        setMessages(doc.messages || [])
    }, [])

    const loadChats = useCallback(
        async (activeBranch: string, preferredChatId?: string | null) => {
            setLoadingChats(true)
            try {
                const docs = await backendJson<DrawerChat[]>(
                    `/api/projects/${projectId}/chats?branch=${encodeURIComponent(activeBranch)}&limit=100`
                )

                if (!docs.length) {
                    const fallback = preferredChatId || `${projectId}::${activeBranch}::${userId}`
                    await ensureChat(fallback, activeBranch)
                    const now = new Date().toISOString()
                    const seeded: DrawerChat = {
                        chat_id: fallback,
                        title: `${projectLabel} / ${activeBranch}`,
                        branch: activeBranch,
                        updated_at: now,
                        created_at: now,
                    }
                    setChats([seeded])
                    setSelectedChatId(fallback)
                    return fallback
                }

                setChats(docs)
                const current = preferredChatId || selectedChatIdRef.current
                const next =
                    (current && docs.some((c) => c.chat_id === current) && current) ||
                    docs[0]?.chat_id ||
                    null
                setSelectedChatId(next)
                return next
            } finally {
                setLoadingChats(false)
            }
        },
        [ensureChat, projectId, projectLabel, userId]
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

                let fetchedBranches: string[] = []
                try {
                    const b = await backendJson<BranchesResponse>(`/api/projects/${projectId}/branches`)
                    fetchedBranches = (b.branches || []).filter(Boolean)
                } catch {
                    fetchedBranches = []
                }

                if (!fetchedBranches.length) {
                    fetchedBranches = [projectRes.default_branch || "main"]
                }

                setBranches(fetchedBranches)

                const urlBranch = (initialBranchRef.current || "").trim()
                const preferred = (projectRes.default_branch || "").trim()
                if (urlBranch && fetchedBranches.includes(urlBranch)) {
                    setBranch(urlBranch)
                } else if (preferred && fetchedBranches.includes(preferred)) {
                    setBranch(preferred)
                } else {
                    setBranch(fetchedBranches[0] || "main")
                }
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            } finally {
                if (!cancelled) {
                    setBooting(false)
                }
            }
        }

        void boot()
        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        if (!branch) return
        let cancelled = false

        async function loadByBranch() {
            try {
                const next = await loadChats(branch, initialChatRef.current)
                if (!cancelled && next) {
                    initialChatRef.current = null
                }
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            }
        }

        void loadByBranch()
        return () => {
            cancelled = true
        }
    }, [branch, loadChats])

    useEffect(() => {
        if (!selectedChatId || !branch) return
        const chatId = selectedChatId
        let cancelled = false

        async function syncSelectedChat() {
            setLoadingMessages(true)
            setError(null)
            try {
                await ensureChat(chatId, branch)
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

        void syncSelectedChat()
        return () => {
            cancelled = true
        }
    }, [branch, ensureChat, loadMessages, selectedChatId])

    useEffect(() => {
        scrollToBottom()
    }, [messages, sending, loadingMessages, scrollToBottom])

    useEffect(() => {
        if (!selectedChatId || !branch) return
        syncUrl(selectedChatId, branch)
        saveLastChat({
            projectId,
            branch,
            chatId: selectedChatId,
            path: buildChatPath(projectId, branch, selectedChatId),
            ts: Date.now(),
        })
    }, [branch, projectId, selectedChatId, syncUrl])

    const onSelectChat = useCallback((chat: DrawerChat) => {
        setSelectedChatId(chat.chat_id)
    }, [])

    const onBranchChange = useCallback((nextBranch: string) => {
        setBranch(nextBranch)
        setMessages([])
        setSelectedChatId(null)
    }, [])

    const onNewChat = useCallback(async () => {
        const newChatId = makeChatId(projectId, branch, userId)
        setError(null)
        try {
            await ensureChat(newChatId, branch)
            await loadChats(branch, newChatId)
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
            await loadChats(branch, selectedChatId)
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
            await loadChats(branch, selectedChatId)
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, loadChats, loadMessages, selectedChatId])

    return (
        <ProjectDrawerLayout
            projectId={projectId}
            projectLabel={projectLabel}
            branch={branch}
            branches={branches}
            onBranchChange={onBranchChange}
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={onSelectChat}
            onNewChat={onNewChat}
            user={me}
            loadingChats={loadingChats}
            activeSection="chat"
        >
            <main className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-white/10 bg-slate-950/55 px-5 py-4 backdrop-blur-xl">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">RAG Conversation</div>
                    <div className="mt-1 text-sm text-white">
                        {projectLabel} · <span className="text-cyan-200">{branch}</span>
                    </div>
                    <div className="text-xs text-slate-400">
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
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                                Loading workspace...
                            </div>
                        )}

                        {!booting && !loadingMessages && messages.length === 0 && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                                Start with a question about this project. I can pull context from Git, Confluence, and Jira.
                            </div>
                        )}

                        {messages.map((m, idx) => {
                            const isUser = m.role === "user"
                            return (
                                <div key={`${m.ts || idx}-${idx}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                                    <div
                                        className={[
                                            "max-w-[88%] rounded-2xl border px-4 py-3 text-sm leading-relaxed",
                                            isUser
                                                ? "border-cyan-300/30 bg-gradient-to-br from-cyan-300/20 to-emerald-300/10 text-cyan-100"
                                                : "border-white/10 bg-white/[0.03] text-slate-100",
                                        ].join(" ")}
                                    >
                                        {splitChartBlocks(m.content || "").map((part, i) => {
                                            if (part.type === "chart") {
                                                return (
                                                    <div key={i} className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                                                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                                            Chart Block
                                                        </div>
                                                        <pre className="overflow-x-auto text-xs text-slate-200">{part.value}</pre>
                                                    </div>
                                                )
                                            }
                                            return (
                                                <p key={i} className="whitespace-pre-wrap">
                                                    {part.value}
                                                </p>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}

                        {(sending || loadingMessages) && (
                            <div className="flex justify-start">
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300">
                                    Thinking...
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="border-t border-white/10 bg-slate-950/65 px-4 py-4 backdrop-blur-xl">
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
                            placeholder="Ask a project question (Enter to send, Shift+Enter for newline)"
                            className="min-h-[48px] max-h-44 flex-1 resize-none rounded-2xl border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/40 placeholder:text-slate-500 focus:ring-2"
                        />
                        <button
                            onClick={() => void clearChat()}
                            disabled={!selectedChatId || sending}
                            className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => void send()}
                            disabled={sending || !input.trim() || !selectedChatId}
                            className="rounded-xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:from-cyan-200 hover:to-emerald-200 disabled:opacity-50"
                        >
                            Send
                        </button>
                    </div>
                </div>
            </main>
        </ProjectDrawerLayout>
    )
}

