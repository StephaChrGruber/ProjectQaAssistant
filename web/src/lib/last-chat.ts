export type LastChatPointer = {
    projectId: string
    branch: string
    chatId: string
    path: string
    ts: number
}

const KEY = "qa:last-chat"

export function buildChatPath(projectId: string, branch: string, chatId: string): string {
    const params = new URLSearchParams({
        branch,
        chat: chatId,
    })
    return `/projects/${encodeURIComponent(projectId)}/chat?${params.toString()}`
}

export function saveLastChat(pointer: LastChatPointer): void {
    if (typeof window === "undefined") return
    try {
        localStorage.setItem(KEY, JSON.stringify(pointer))
    } catch {
        // Ignore storage failures (private mode / quota).
    }
}

export function readLastChat(): LastChatPointer | null {
    if (typeof window === "undefined") return null
    try {
        const raw = localStorage.getItem(KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as LastChatPointer
        if (!parsed?.projectId || !parsed?.branch || !parsed?.chatId || !parsed?.path) return null
        return parsed
    } catch {
        return null
    }
}

