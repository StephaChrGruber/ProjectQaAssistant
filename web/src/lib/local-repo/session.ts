import {
    IDB_STORE_HANDLES,
    IDB_STORE_SNAPSHOTS,
    LOCAL_REPO_PREFIX,
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_TOTAL_CHARS,
} from "./constants"
import {
    handleCache,
    hasWindow,
    idbDelete,
    idbGet,
    idbSet,
    localStorageKey,
    sessionStorageKey,
    snapshotCache,
} from "./storage"
import { firstPathSegment, isLikelyTextFile, isSkippablePath, normalizeRelPath } from "./paths"
import type { LocalRepoFile, LocalRepoSession, LocalRepoSnapshot } from "./types"

function supportsFsAccessApi(): boolean {
    if (typeof window === "undefined") return false
    const win = window as Window & {
        showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>
    }
    return typeof win.showDirectoryPicker === "function"
}

async function pickFolderFilesFromBrowserInput(): Promise<File[]> {
    if (typeof window === "undefined") {
        throw new Error("Local folder picker is only available in the browser.")
    }

    return await new Promise<File[]>((resolve, reject) => {
        const input = document.createElement("input")
        input.type = "file"
        input.multiple = true
        ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
        ;(input as HTMLInputElement & { directory?: boolean }).directory = true
        input.style.display = "none"

        input.onchange = () => {
            const files = Array.from(input.files || [])
            input.remove()
            if (!files.length) {
                reject(new Error("No folder was selected."))
                return
            }
            resolve(files)
        }
        input.onerror = () => {
            input.remove()
            reject(new Error("Failed to read selected folder."))
        }

        document.body.appendChild(input)
        input.click()
    })
}

async function collectSnapshotFromFiles(rawFiles: File[]): Promise<LocalRepoSnapshot> {
    const files = [...rawFiles].sort((a, b) => {
        const ap = normalizeRelPath(a.webkitRelativePath || a.name)
        const bp = normalizeRelPath(b.webkitRelativePath || b.name)
        return ap.localeCompare(bp)
    })

    const rootName = firstPathSegment(normalizeRelPath(files[0]?.webkitRelativePath || files[0]?.name || "local-repo"))

    const out: LocalRepoFile[] = []
    let totalChars = 0

    for (const file of files) {
        if (out.length >= MAX_FILES) break
        if (file.size > MAX_FILE_BYTES) continue

        const rel = normalizeRelPath(file.webkitRelativePath || file.name)
        if (!rel) continue
        if (isSkippablePath(rel)) continue
        if (!isLikelyTextFile(file, rel)) continue

        const pathParts = rel.split("/")
        const inRoot = pathParts.length > 1 ? pathParts.slice(1).join("/") : rel
        if (!inRoot.trim()) continue

        let text = ""
        try {
            text = (await file.text()).replaceAll("\r\n", "\n")
        } catch {
            continue
        }
        if (!text.trim()) continue

        const nextChars = totalChars + text.length
        if (nextChars > MAX_TOTAL_CHARS) break

        totalChars = nextChars
        out.push({ path: inRoot, content: text })
    }

    if (!out.length) {
        throw new Error("No readable text/code files found in selected folder.")
    }

    return {
        rootName,
        files: out,
        indexedAt: new Date().toISOString(),
    }
}

async function collectSnapshotFromDirectoryHandle(rootHandle: FileSystemDirectoryHandle): Promise<LocalRepoSnapshot> {
    const rootName = (rootHandle.name || "local-repo").trim() || "local-repo"

    type QueueItem = {
        handle: FileSystemDirectoryHandle
        relDir: string
    }

    const queue: QueueItem[] = [{ handle: rootHandle, relDir: "" }]
    const entries: Array<{ rel: string; fileHandle: FileSystemFileHandle }> = []

    while (queue.length > 0) {
        const next = queue.shift()!
        for await (const [name, child] of (next.handle as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
            const rel = normalizeRelPath(next.relDir ? `${next.relDir}/${name}` : name)
            if (!rel || isSkippablePath(rel)) continue

            if (child.kind === "directory") {
                queue.push({ handle: child as FileSystemDirectoryHandle, relDir: rel })
                continue
            }

            entries.push({ rel, fileHandle: child as FileSystemFileHandle })
            if (entries.length >= MAX_FILES * 3) break
        }
        if (entries.length >= MAX_FILES * 3) break
    }

    entries.sort((a, b) => a.rel.localeCompare(b.rel))

    const out: LocalRepoFile[] = []
    let totalChars = 0

    for (const entry of entries) {
        if (out.length >= MAX_FILES) break

        let file: File
        try {
            file = await entry.fileHandle.getFile()
        } catch {
            continue
        }

        if (file.size > MAX_FILE_BYTES) continue
        if (!isLikelyTextFile(file, entry.rel)) continue

        let text = ""
        try {
            text = (await file.text()).replaceAll("\r\n", "\n")
        } catch {
            continue
        }
        if (!text.trim()) continue

        const nextChars = totalChars + text.length
        if (nextChars > MAX_TOTAL_CHARS) break

        totalChars = nextChars
        out.push({ path: entry.rel, content: text })
    }

    if (!out.length) {
        throw new Error("No readable text/code files found in selected folder.")
    }

    return {
        rootName,
        files: out,
        indexedAt: new Date().toISOString(),
    }
}

async function pickLocalRepoSessionWithFsAccess(): Promise<LocalRepoSession> {
    const win = window as Window & {
        showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>
    }
    if (!win.showDirectoryPicker) {
        throw new Error("File System Access API not available.")
    }

    const rootHandle = await win.showDirectoryPicker({ mode: "readwrite" })
    const snapshot = await collectSnapshotFromDirectoryHandle(rootHandle)
    return { snapshot, rootHandle }
}

export async function pickLocalRepoSessionFromBrowser(): Promise<LocalRepoSession> {
    if (typeof window === "undefined") {
        throw new Error("Local folder picker is only available in the browser.")
    }

    if (supportsFsAccessApi()) {
        try {
            return await pickLocalRepoSessionWithFsAccess()
        } catch {
            // Fallback to input mode if permission canceled or unsupported by browser profile.
        }
    }

    const files = await pickFolderFilesFromBrowserInput()
    const snapshot = await collectSnapshotFromFiles(files)
    return { snapshot, rootHandle: null }
}

export async function pickLocalRepoSnapshotFromBrowser(): Promise<LocalRepoSnapshot> {
    const session = await pickLocalRepoSessionFromBrowser()
    return session.snapshot
}

export function browserLocalRepoPath(rootName: string): string {
    const clean = (rootName || "local-repo").trim().replaceAll("/", "_")
    return `${LOCAL_REPO_PREFIX}${clean}`
}

export function isBrowserLocalRepoPath(path?: string | null): boolean {
    return (path || "").trim().toLowerCase().startsWith(LOCAL_REPO_PREFIX)
}

export function setLocalRepoSession(projectId: string, session: LocalRepoSession): void {
    if (!projectId.trim()) return
    setLocalRepoSnapshot(projectId, session.snapshot)
    if (session.rootHandle) {
        handleCache.set(projectId, session.rootHandle)
        void idbSet(IDB_STORE_HANDLES, projectId, session.rootHandle)
    }
}

export function setLocalRepoSnapshot(projectId: string, snapshot: LocalRepoSnapshot): void {
    if (!projectId.trim()) return
    snapshotCache.set(projectId, snapshot)

    if (!hasWindow()) return
    const payload = JSON.stringify(snapshot)
    try {
        window.sessionStorage.setItem(sessionStorageKey(projectId), payload)
    } catch {
        // Ignore storage quota errors; in-memory cache still works for current session.
    }
    try {
        window.localStorage.setItem(localStorageKey(projectId), payload)
    } catch {
        // Ignore localStorage quota errors.
    }
    void idbSet(IDB_STORE_SNAPSHOTS, projectId, snapshot)
}

export function getLocalRepoSnapshot(projectId: string): LocalRepoSnapshot | null {
    if (!projectId.trim()) return null

    const inMemory = snapshotCache.get(projectId)
    if (inMemory) return inMemory

    if (!hasWindow()) return null
    try {
        const raw = window.sessionStorage.getItem(sessionStorageKey(projectId))
        if (raw) {
            const parsed = JSON.parse(raw) as LocalRepoSnapshot
            if (parsed?.files?.length) {
                snapshotCache.set(projectId, parsed)
                return parsed
            }
        }
    } catch {
        // continue with localStorage fallback
    }

    try {
        const raw = window.localStorage.getItem(localStorageKey(projectId))
        if (raw) {
            const parsed = JSON.parse(raw) as LocalRepoSnapshot
            if (parsed?.files?.length) {
                snapshotCache.set(projectId, parsed)
                return parsed
            }
        }
    } catch {
        // fall through
    }
    return null
}

export function hasLocalRepoSnapshot(projectId: string): boolean {
    return Boolean(getLocalRepoSnapshot(projectId))
}

export function hasLocalRepoWriteCapability(projectId: string): boolean {
    return handleCache.has(projectId)
}

export async function ensureLocalRepoWritePermission(projectId: string): Promise<boolean> {
    const handle = handleCache.get(projectId)
    if (!handle) return false

    const anyHandle = handle as any
    try {
        const query = await anyHandle.queryPermission?.({ mode: "readwrite" })
        if (query === "granted") return true
        const request = await anyHandle.requestPermission?.({ mode: "readwrite" })
        return request === "granted"
    } catch {
        return false
    }
}

export async function restoreLocalRepoSession(projectId: string): Promise<boolean> {
    if (!projectId.trim()) return false

    // Warm snapshot cache from synchronous storages first.
    const existing = getLocalRepoSnapshot(projectId)
    if (!existing) {
        const persisted = await idbGet(IDB_STORE_SNAPSHOTS, projectId)
        if (persisted?.files?.length) {
            setLocalRepoSnapshot(projectId, persisted as LocalRepoSnapshot)
        }
    }

    if (!handleCache.has(projectId)) {
        const persistedHandle = await idbGet(IDB_STORE_HANDLES, projectId)
        if (persistedHandle && (persistedHandle as FileSystemHandle).kind === "directory") {
            handleCache.set(projectId, persistedHandle as FileSystemDirectoryHandle)
        }
    }

    return Boolean(getLocalRepoSnapshot(projectId))
}

export function moveLocalRepoSnapshot(fromKey: string, toKey: string): void {
    if (!fromKey.trim() || !toKey.trim()) return
    const snapshot = getLocalRepoSnapshot(fromKey)
    if (!snapshot) return
    setLocalRepoSnapshot(toKey, snapshot)

    const handle = handleCache.get(fromKey)
    if (handle) {
        handleCache.set(toKey, handle)
        handleCache.delete(fromKey)
    }

    snapshotCache.delete(fromKey)
    if (hasWindow()) {
        window.sessionStorage.removeItem(sessionStorageKey(fromKey))
        window.localStorage.removeItem(localStorageKey(fromKey))
    }

    void (async () => {
        const persistedSnap = await idbGet(IDB_STORE_SNAPSHOTS, fromKey)
        if (persistedSnap) {
            await idbSet(IDB_STORE_SNAPSHOTS, toKey, persistedSnap)
        }
        await idbDelete(IDB_STORE_SNAPSHOTS, fromKey)

        const persistedHandle = await idbGet(IDB_STORE_HANDLES, fromKey)
        if (persistedHandle) {
            await idbSet(IDB_STORE_HANDLES, toKey, persistedHandle)
        }
        await idbDelete(IDB_STORE_HANDLES, fromKey)
    })()
}

export function getLocalRepoRootHandle(projectId: string): FileSystemDirectoryHandle | null {
    return handleCache.get(projectId) || null
}
