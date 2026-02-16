"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

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
    onSelectChat: (chatId: string) => void
    onNewChat: () => void
    user?: DrawerUser | null
    loadingChats?: boolean
    children: React.ReactNode
}

function fmtTime(iso?: string): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleString()
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
        children,
    } = props
    const [mobileOpen, setMobileOpen] = useState(false)

    const userLabel = useMemo(() => {
        return user?.displayName || user?.email || "Developer"
    }, [user])

    return (
        <div className="flex h-screen w-full bg-slate-950/95 text-slate-100">
            {mobileOpen && (
                <button
                    className="fixed inset-0 z-20 bg-black/40 md:hidden"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                />
            )}

            <aside
                className={[
                    "fixed inset-y-0 left-0 z-30 w-80 border-r border-slate-800 bg-slate-900/95 backdrop-blur md:static md:translate-x-0",
                    "transform transition-transform duration-200",
                    mobileOpen ? "translate-x-0" : "-translate-x-full",
                ].join(" ")}
            >
                <div className="flex h-full flex-col">
                    <div className="border-b border-slate-800 px-4 py-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-cyan-300/80">Project Assistant</div>
                        <div className="mt-2 truncate text-sm font-semibold">{projectLabel}</div>
                        <div className="truncate text-xs text-slate-400">{projectId}</div>
                    </div>

                    <div className="border-b border-slate-800 px-4 py-4">
                        <label className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Branch</label>
                        <select
                            value={branch}
                            onChange={(e) => onBranchChange(e.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-cyan-300/40 focus:ring-2"
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
                            className="mt-3 w-full rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-300"
                        >
                            New Chat
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                        <div className="px-2 pb-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">Chats</div>
                        {loadingChats && <div className="px-2 py-3 text-xs text-slate-400">Loading chats...</div>}
                        {!loadingChats && chats.length === 0 && (
                            <div className="px-2 py-3 text-xs text-slate-500">No conversations yet for this branch.</div>
                        )}
                        <div className="space-y-1">
                            {chats.map((c) => {
                                const selected = c.chat_id === selectedChatId
                                const title = c.title?.trim() || c.chat_id
                                return (
                                    <button
                                        key={c.chat_id}
                                        onClick={() => onSelectChat(c.chat_id)}
                                        className={[
                                            "w-full rounded-lg border px-3 py-2 text-left transition",
                                            selected
                                                ? "border-cyan-300/70 bg-cyan-300/10"
                                                : "border-slate-800 bg-slate-900 hover:border-slate-700",
                                        ].join(" ")}
                                    >
                                        <div className="truncate text-sm font-medium">{title}</div>
                                        <div className="mt-1 truncate text-[11px] text-slate-400">
                                            {c.branch || branch}
                                            {fmtTime(c.updated_at) ? ` · ${fmtTime(c.updated_at)}` : ""}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="border-t border-slate-800 px-4 py-4 text-xs text-slate-300">
                        <div className="truncate pb-3 text-slate-400">{userLabel}</div>
                        <div className="space-y-2">
                            <Link
                                href={`/projects/${projectId}/settings`}
                                className="block rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 hover:border-slate-700"
                            >
                                Settings
                            </Link>
                            {user?.isGlobalAdmin && (
                                <Link
                                    href="/admin"
                                    className="block rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 hover:border-slate-700"
                                >
                                    Admin
                                </Link>
                            )}
                            <Link
                                href="/projects"
                                className="block rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 hover:border-slate-700"
                            >
                                All Projects
                            </Link>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3 md:hidden">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="rounded-md border border-slate-700 px-3 py-1 text-sm"
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

