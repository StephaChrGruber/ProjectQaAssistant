"use client"

export type LocalRepoFile = {
    path: string
    content: string
}

export type LocalRepoSnapshot = {
    rootName: string
    files: LocalRepoFile[]
    indexedAt: string
}

export type LocalRepoSession = {
    snapshot: LocalRepoSnapshot
    rootHandle?: FileSystemDirectoryHandle | null
}

export type LocalDocumentationContext = {
    repo_root: string
    file_paths: string[]
    context: string
}

type LocalRepoHit = {
    term: string
    path: string
    line: number
    column: number
    snippet: string
}

const LOCAL_REPO_PREFIX = "browser-local://"
const SESSION_STORAGE_PREFIX = "projectqa.localRepo."
const LOCAL_STORAGE_PREFIX = "projectqa.localRepo.persist."
const IDB_NAME = "projectqa-local-repo"
const IDB_VERSION = 1
const IDB_STORE_SNAPSHOTS = "snapshots"
const IDB_STORE_HANDLES = "handles"

const MAX_FILES = 1200
const MAX_FILE_BYTES = 350_000
const MAX_TOTAL_CHARS = 2_200_000

const MAX_HITS = 18
const MAX_HITS_PER_TERM = 6

const DOC_CONTEXT_MAX_FILES = 90
const DOC_CONTEXT_MAX_CHARS = 260_000
const DOC_CONTEXT_MAX_FILE_CHARS = 8_000

const SKIP_DIR_PARTS = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
])

const IMPORTANT_NAMES = new Set([
    "readme.md",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pyproject.toml",
    "requirements.txt",
    "poetry.lock",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "go.mod",
    "cargo.toml",
    "next.config.js",
    "next.config.ts",
    "tsconfig.json",
])

const TEXT_FILE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".cs",
    ".swift",
    ".scala",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".sql",
    ".graphql",
    ".gql",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".txt",
    ".md",
    ".adoc",
    ".rst",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".dockerfile",
    ".gitignore",
    ".gitattributes",
    ".properties",
    ".proto",
    ".vue",
    ".svelte",
])

const STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "that",
    "with",
    "this",
    "from",
    "what",
    "when",
    "where",
    "which",
    "into",
    "about",
    "please",
    "show",
    "find",
    "have",
    "will",
    "would",
    "could",
    "should",
    "does",
    "dont",
    "can't",
    "cannot",
    "repo",
    "project",
    "code",
    "files",
])

const snapshotCache = new Map<string, LocalRepoSnapshot>()
const handleCache = new Map<string, FileSystemDirectoryHandle>()

function sessionStorageKey(projectId: string): string {
    return `${SESSION_STORAGE_PREFIX}${projectId}`
}

function localStorageKey(projectId: string): string {
    return `${LOCAL_STORAGE_PREFIX}${projectId}`
}

function hasWindow(): boolean {
    return typeof window !== "undefined"
}

async function openLocalRepoDb(): Promise<IDBDatabase | null> {
    if (!hasWindow() || !("indexedDB" in window)) return null
    return await new Promise<IDBDatabase | null>((resolve) => {
        try {
            const req = window.indexedDB.open(IDB_NAME, IDB_VERSION)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains(IDB_STORE_SNAPSHOTS)) {
                    db.createObjectStore(IDB_STORE_SNAPSHOTS)
                }
                if (!db.objectStoreNames.contains(IDB_STORE_HANDLES)) {
                    db.createObjectStore(IDB_STORE_HANDLES)
                }
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
}

async function idbGet(store: string, key: string): Promise<any> {
    const db = await openLocalRepoDb()
    if (!db) return null
    return await new Promise<any>((resolve) => {
        const tx = db.transaction(store, "readonly")
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
    })
}

async function idbSet(store: string, key: string, value: any): Promise<void> {
    const db = await openLocalRepoDb()
    if (!db) return
    await new Promise<void>((resolve) => {
        const tx = db.transaction(store, "readwrite")
        tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
    })
}

async function idbDelete(store: string, key: string): Promise<void> {
    const db = await openLocalRepoDb()
    if (!db) return
    await new Promise<void>((resolve) => {
        const tx = db.transaction(store, "readwrite")
        tx.objectStore(store).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
    })
}

function extensionOf(path: string): string {
    const idx = path.lastIndexOf(".")
    if (idx < 0) return ""
    return path.slice(idx).toLowerCase()
}

function isLikelyTextFile(file: File, relativePath: string): boolean {
    const ext = extensionOf(relativePath)
    if (TEXT_FILE_EXTENSIONS.has(ext)) return true

    const type = (file.type || "").toLowerCase()
    if (type.startsWith("text/")) return true
    if (type.includes("json") || type.includes("xml") || type.includes("javascript")) return true

    return false
}

function isSkippablePath(path: string): boolean {
    const parts = path.split("/").map((p) => p.trim()).filter(Boolean)
    return parts.some((part) => SKIP_DIR_PARTS.has(part))
}

function normalizeRelPath(rawPath: string): string {
    return rawPath.replaceAll("\\", "/").replace(/^\/+/, "")
}

function firstPathSegment(path: string): string {
    const norm = normalizeRelPath(path)
    const idx = norm.indexOf("/")
    if (idx < 0) return norm || "local-repo"
    return norm.slice(0, idx) || "local-repo"
}

function normalizeDocPath(rawPath: string): string {
    const clean = normalizeRelPath(rawPath)
    if (!clean || clean.split("/").includes("..")) return ""

    let path = clean
    if (!path.startsWith("documentation/")) {
        path = `documentation/${path}`
    }
    if (!path.endsWith(".md")) {
        path = `${path}.md`
    }
    return path
}

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

function searchTerms(question: string): string[] {
    const raw = question
        .toLowerCase()
        .split(/[^a-z0-9_./:-]+/g)
        .map((x) => x.trim())
        .filter(Boolean)

    const filtered = raw.filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    return Array.from(new Set(filtered)).slice(0, 8)
}

function collectHits(snapshot: LocalRepoSnapshot, terms: string[]): LocalRepoHit[] {
    const hits: LocalRepoHit[] = []
    const perTermCount = new Map<string, number>()

    for (const file of snapshot.files) {
        if (hits.length >= MAX_HITS) break
        const lines = file.content.split("\n")

        for (let i = 0; i < lines.length; i += 1) {
            if (hits.length >= MAX_HITS) break
            const line = lines[i]
            const lineLower = line.toLowerCase()

            for (const term of terms) {
                const already = perTermCount.get(term) || 0
                if (already >= MAX_HITS_PER_TERM) continue

                const col = lineLower.indexOf(term)
                if (col < 0) continue

                hits.push({
                    term,
                    path: file.path,
                    line: i + 1,
                    column: col + 1,
                    snippet: line.trim().slice(0, 240),
                })
                perTermCount.set(term, already + 1)
                break
            }
        }
    }

    return hits
}

function snippetAround(content: string, line: number): string {
    const lines = content.split("\n")
    const start = Math.max(1, line - 3)
    const end = Math.min(lines.length, line + 3)
    const chunk = lines.slice(start - 1, end)
    return chunk
        .map((l, idx) => `${String(start + idx).padStart(4, " ")} | ${l}`)
        .join("\n")
}

export function buildFrontendLocalRepoContext(projectId: string, question: string, branch?: string): string | null {
    const snapshot = getLocalRepoSnapshot(projectId)
    if (!snapshot) return null

    const terms = searchTerms(question)
    if (!terms.length) {
        return [
            "LOCAL_FRONTEND_REPO_TOOLS",
            `repo: ${snapshot.rootName}`,
            `selected_branch: ${branch || "unknown"}`,
            `indexed_at: ${snapshot.indexedAt}`,
            `indexed_files: ${snapshot.files.length}`,
            "No useful query terms extracted from question.",
        ].join("\n")
    }

    const hits = collectHits(snapshot, terms)
    const lines: string[] = [
        "LOCAL_FRONTEND_REPO_TOOLS",
        `repo: ${snapshot.rootName}`,
        `selected_branch: ${branch || "unknown"}`,
        `indexed_at: ${snapshot.indexedAt}`,
        `indexed_files: ${snapshot.files.length}`,
        `query_terms: ${terms.join(", ")}`,
        "",
        "repo_grep matches:",
    ]

    if (!hits.length) {
        lines.push("- No direct matches found in locally indexed files.")
    } else {
        for (const h of hits) {
            lines.push(`- ${h.path}:${h.line}:${h.column} [${h.term}] ${h.snippet}`)
        }
    }

    const uniquePaths: string[] = []
    for (const h of hits) {
        if (!uniquePaths.includes(h.path)) uniquePaths.push(h.path)
    }

    if (uniquePaths.length) {
        lines.push("")
        lines.push("open_file snippets:")
        for (const path of uniquePaths.slice(0, 4)) {
            const first = hits.find((h) => h.path === path)
            const file = snapshot.files.find((f) => f.path === path)
            if (!first || !file) continue
            lines.push(`--- ${path}`)
            lines.push(snippetAround(file.content, first.line))
        }
    }

    const context = lines.join("\n").trim()
    if (context.length > 14000) {
        return `${context.slice(0, 14000)}\n... (truncated local repo context)`
    }
    return context
}

function docPathScore(path: string): number {
    const low = path.toLowerCase()
    const name = low.split("/").pop() || low
    let score = 0
    if (IMPORTANT_NAMES.has(name)) score += 120
    if (low.startsWith("src/")) score += 50
    if (low.startsWith("app/")) score += 40
    if (low.startsWith("backend/") || low.startsWith("web/")) score += 30
    if (low.includes("/routes/") || low.includes("/api/")) score += 25
    if (low.includes("/models/")) score += 25
    if (low.includes("config")) score += 20
    if (low.endsWith(".md")) score -= 10
    return score
}

function isDocumentationContextCandidate(path: string): boolean {
    const norm = normalizeRelPath(path)
    const low = norm.toLowerCase()
    if (!norm) return false
    if (isSkippablePath(norm)) return false
    if (low.startsWith("documentation/")) return false

    const ext = extensionOf(low)
    const name = low.split("/").pop() || low
    if (IMPORTANT_NAMES.has(name)) return true
    if (TEXT_FILE_EXTENSIONS.has(ext)) return true
    return false
}

export function buildLocalRepoDocumentationContext(projectId: string, branch: string): LocalDocumentationContext | null {
    const snapshot = getLocalRepoSnapshot(projectId)
    if (!snapshot) return null

    const candidates = snapshot.files
        .filter((f) => isDocumentationContextCandidate(f.path))
        .sort((a, b) => {
            const sa = docPathScore(a.path)
            const sb = docPathScore(b.path)
            if (sa !== sb) return sb - sa
            return a.path.localeCompare(b.path)
        })

    const selected = candidates.slice(0, DOC_CONTEXT_MAX_FILES)
    const filePaths = selected.map((f) => f.path)

    const chunks: string[] = [
        "LOCAL_REPO_DOCUMENTATION_CONTEXT",
        `repo: ${snapshot.rootName}`,
        `selected_branch: ${branch || "unknown"}`,
        `indexed_at: ${snapshot.indexedAt}`,
        `indexed_files: ${snapshot.files.length}`,
        `context_files: ${filePaths.length}`,
        "",
        "candidate_files:",
        ...filePaths.map((p) => `- ${p}`),
        "",
        "code_and_config_snippets:",
    ]

    let total = chunks.join("\n").length
    for (const file of selected) {
        const text = file.content.length > DOC_CONTEXT_MAX_FILE_CHARS
            ? `${file.content.slice(0, DOC_CONTEXT_MAX_FILE_CHARS)}\n... (truncated)`
            : file.content
        const block = `\nFILE: ${file.path}\n\`\`\`\n${text}\n\`\`\`\n`
        if (total + block.length > DOC_CONTEXT_MAX_CHARS) break
        chunks.push(block)
        total += block.length
    }

    return {
        repo_root: snapshot.rootName,
        file_paths: filePaths,
        context: chunks.join("\n").trim(),
    }
}

export function listLocalDocumentationFiles(projectId: string): Array<{ path: string; size: number; updated_at: string | null }> {
    const snapshot = getLocalRepoSnapshot(projectId)
    if (!snapshot) return []

    return snapshot.files
        .filter((f) => f.path.startsWith("documentation/") && f.path.endsWith(".md"))
        .map((f) => ({
            path: f.path,
            size: f.content.length,
            updated_at: snapshot.indexedAt || null,
        }))
        .sort((a, b) => a.path.localeCompare(b.path))
}

export function readLocalDocumentationFile(projectId: string, path: string): string | null {
    const snapshot = getLocalRepoSnapshot(projectId)
    if (!snapshot) return null

    const norm = normalizeDocPath(path)
    if (!norm) return null

    const found = snapshot.files.find((f) => f.path === norm)
    return found?.content || null
}

async function ensureDirectoryPath(
    rootHandle: FileSystemDirectoryHandle,
    parts: string[]
): Promise<FileSystemDirectoryHandle> {
    let current = rootHandle
    for (const part of parts) {
        if (!part || part === ".") continue
        current = await current.getDirectoryHandle(part, { create: true })
    }
    return current
}

async function clearDirectoryEntries(dirHandle: FileSystemDirectoryHandle): Promise<void> {
    const mutableHandle = dirHandle as any
    if (typeof mutableHandle.removeEntry !== "function") return

    const entries: Array<{ name: string; kind: "file" | "directory" }> = []
    for await (const [name, child] of (dirHandle as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        entries.push({ name, kind: child.kind })
    }

    for (const entry of entries) {
        await mutableHandle.removeEntry(entry.name, { recursive: entry.kind === "directory" })
    }
}

async function clearDocumentationFolder(rootHandle: FileSystemDirectoryHandle): Promise<void> {
    try {
        const docsDir = await rootHandle.getDirectoryHandle("documentation")
        await clearDirectoryEntries(docsDir)
    } catch {
        // documentation/ does not exist yet
    }
}

export async function writeLocalDocumentationFiles(
    projectId: string,
    files: Array<{ path: string; content: string }>
): Promise<{ written: string[] }> {
    const snapshot = getLocalRepoSnapshot(projectId)
    if (!snapshot) {
        throw new Error("No local repository snapshot available in this browser session.")
    }

    const rootHandle = handleCache.get(projectId)
    if (!rootHandle) {
        throw new Error("No writable local repository handle available. Re-pick folder with 'Pick From This Device'.")
    }

    const granted = await ensureLocalRepoWritePermission(projectId)
    if (!granted) {
        throw new Error("Write permission was not granted for the selected local repository folder.")
    }

    await clearDocumentationFolder(rootHandle)

    const nextFiles = snapshot.files.filter((f) => !f.path.toLowerCase().startsWith("documentation/"))
    const written: string[] = []

    for (const item of files) {
        const norm = normalizeDocPath(item.path)
        const content = (item.content || "").replaceAll("\r\n", "\n")
        if (!norm || !content.trim()) continue

        const parts = norm.split("/")
        const fileName = parts.pop() || "README.md"
        const dir = await ensureDirectoryPath(rootHandle, parts)
        const fileHandle = await dir.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(content.endsWith("\n") ? content : `${content}\n`)
        await writable.close()

        const idx = nextFiles.findIndex((f) => f.path === norm)
        if (idx >= 0) {
            nextFiles[idx] = { path: norm, content: content.endsWith("\n") ? content : `${content}\n` }
        } else {
            nextFiles.push({ path: norm, content: content.endsWith("\n") ? content : `${content}\n` })
        }

        written.push(norm)
    }

    const nextSnapshot: LocalRepoSnapshot = {
        rootName: snapshot.rootName,
        files: nextFiles,
        indexedAt: new Date().toISOString(),
    }
    setLocalRepoSession(projectId, { snapshot: nextSnapshot, rootHandle })

    return { written }
}
