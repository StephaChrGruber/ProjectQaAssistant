"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

export type DrawerUser = {
    displayName?: string
    email?: string
    isGlobalAdmin?: boolean
}

export type DrawerChat = {
    chat_id: string
    title?: string
    branch?: string
    updated_at?: string
    created_at?: string
}

type Props = {
    projectId: string
    projectLabel: string
    branch: string
    branches: string[]
    onBranchChange: (branch: string) => void
    chats: DrawerChat[]
    selectedChatId: string | null
    onSelectChat: (chat: DrawerChat) => void
    onNewChat: () => void
    user?: DrawerUser | null
    loadingChats?: boolean
    activeSection?: "chat" | "settings"
    children: React.ReactNode
}

function fmtTime(iso?: string): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function chatTitle(chat: DrawerChat): string {
    const raw = (chat.title || "").trim()
    if (!raw) return "New Conversation"
    return raw
}

export function ProjectDrawerLayout(props: Props) {
    const {
        projectId,
        projectLabel,
        branch,
        branches,
        onBranchChange,
        chats,
        selectedChatId,
        onSelectChat,
        onNewChat,
        user,
        loadingChats,
        activeSection = "chat",
        children,
    } = props

    const pathname = usePathname()
    const [mobileOpen, setMobileOpen] = useState(false)

    const userLabel = useMemo(() => user?.displayName || user?.email || "Developer", [user])

    useEffect(() => {
        // Close drawer on route changes.
        setMobileOpen(false)
    }, [pathname])

    useEffect(() => {
        // Prevent body scrolling when drawer is open on mobile.
        if (!mobileOpen) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prev
        }
    }, [mobileOpen])

    return (
        <div className="flex h-screen w-full overflow-hidden text-slate-100">
            <div className="fixed inset-0 -z-20 bg-[#05050a]" />
            <div className="fixed inset-0 -z-10 bg-[radial-gradient(1000px_500px_at_5%_0%,rgba(0,193,255,0.22),transparent_60%),radial-gradient(800px_420px_at_95%_4%,rgba(0,255,166,0.14),transparent_55%),linear-gradient(180deg,#090e1a_0%,#05050a_100%)]" />

            {mobileOpen && (
                <button
                    className="fixed inset-0 z-30 bg-black/55 md:hidden"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close drawer"
                />
            )}

            <aside
                className={[
                    "fixed inset-y-0 left-0 z-40 w-[20rem] border-r border-white/10 bg-slate-950/85 backdrop-blur-xl",
                    "transform transition-transform duration-200 ease-out md:static md:translate-x-0",
                    mobileOpen ? "translate-x-0" : "-translate-x-full",
                ].join(" ")}
            >
                <div className="flex h-full flex-col">
                    <div className="border-b border-white/10 p-4">
                        <div className="inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-100">
                            Project QA
                        </div>
                        <div className="mt-3 truncate text-sm font-semibold text-white">{projectLabel}</div>
                        <div className="truncate text-xs text-slate-400">{projectId}</div>
                    </div>

                    <div className="border-b border-white/10 p-4">
                        <label className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Branch</label>
                        <select
                            value={branch}
                            onChange={(e) => onBranchChange(e.target.value)}
                            className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2 text-sm outline-none ring-cyan-300/40 focus:ring-2"
                        >
                            {branches.map((b) => (
                                <option key={b} value={b}>
                                    {b}
                                </option>
                            ))}
                            {branches.length === 0 && <option value={branch}>{branch}</option>}
                        </select>
                        <button
                            onClick={onNewChat}
                            className="mt-3 w-full rounded-xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:from-cyan-200 hover:to-emerald-200"
                        >
                            New Chat
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        <div className="px-2 pb-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">Conversations</div>
                        {loadingChats && (
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
                                Loading chats...
                            </div>
                        )}
                        {!loadingChats && chats.length === 0 && (
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
                                No chats for this branch yet.
                            </div>
                        )}
                        <div className="space-y-1.5">
                            {chats.map((chat) => {
                                const selected = chat.chat_id === selectedChatId
                                return (
                                    <button
                                        key={chat.chat_id}
                                        onClick={() => {
                                            onSelectChat(chat)
                                            setMobileOpen(false)
                                        }}
                                        className={[
                                            "w-full rounded-xl border px-3 py-2 text-left transition",
                                            selected
                                                ? "border-cyan-300/50 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.25)]"
                                                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                                        ].join(" ")}
                                    >
                                        <div className="truncate text-sm font-medium">{chatTitle(chat)}</div>
                                        <div className="mt-1 truncate text-[11px] text-slate-400">
                                            {chat.branch || branch}
                                            {chat.updated_at ? ` · ${fmtTime(chat.updated_at)}` : ""}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="border-t border-white/10 p-4">
                        <div className="truncate pb-3 text-xs text-slate-400">{userLabel}</div>
                        <div className="space-y-2 text-sm">
                            <Link
                                href={`/projects/${projectId}/settings`}
                                className={[
                                    "block rounded-xl border px-3 py-2 transition",
                                    activeSection === "settings"
                                        ? "border-cyan-300/40 bg-cyan-300/10"
                                        : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                                ].join(" ")}
                            >
                                Settings
                            </Link>
                            {user?.isGlobalAdmin && (
                                <Link
                                    href="/admin"
                                    className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-white/20 hover:bg-white/[0.06]"
                                >
                                    Admin
                                </Link>
                            )}
                            <Link
                                href="/projects"
                                className="block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-white/20 hover:bg-white/[0.06]"
                            >
                                Projects
                            </Link>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-slate-950/65 px-4 py-3 backdrop-blur-xl md:hidden">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-sm"
                    >
                        Menu
                    </button>
                    <div className="min-w-0 text-right">
                        <div className="truncate text-sm font-medium">{projectLabel}</div>
                        <div className="text-xs text-slate-400">{branch}</div>
                    </div>
                </header>
                {children}
            </div>
        </div>
    )
}

