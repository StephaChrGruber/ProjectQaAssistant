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

type LocalRepoHit = {
    term: string
    path: string
    line: number
    column: number
    snippet: string
}

const LOCAL_REPO_PREFIX = "browser-local://"
const SESSION_STORAGE_PREFIX = "projectqa.localRepo."
const MAX_FILES = 1200
const MAX_FILE_BYTES = 350_000
const MAX_TOTAL_CHARS = 2_200_000
const MAX_HITS = 18
const MAX_HITS_PER_TERM = 6

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

function sessionStorageKey(projectId: string): string {
    return `${SESSION_STORAGE_PREFIX}${projectId}`
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

async function pickFolderFilesFromBrowser(): Promise<File[]> {
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

export async function pickLocalRepoSnapshotFromBrowser(): Promise<LocalRepoSnapshot> {
    const rawFiles = await pickFolderFilesFromBrowser()
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
        out.push({
            path: inRoot,
            content: text,
        })
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

export function browserLocalRepoPath(rootName: string): string {
    const clean = (rootName || "local-repo").trim().replaceAll("/", "_")
    return `${LOCAL_REPO_PREFIX}${clean}`
}

export function isBrowserLocalRepoPath(path?: string | null): boolean {
    return (path || "").trim().toLowerCase().startsWith(LOCAL_REPO_PREFIX)
}

export function setLocalRepoSnapshot(projectId: string, snapshot: LocalRepoSnapshot): void {
    if (!projectId.trim()) return
    snapshotCache.set(projectId, snapshot)

    if (typeof window === "undefined") return
    try {
        window.sessionStorage.setItem(sessionStorageKey(projectId), JSON.stringify(snapshot))
    } catch {
        // Ignore storage quota errors; in-memory cache still works for current session.
    }
}

export function getLocalRepoSnapshot(projectId: string): LocalRepoSnapshot | null {
    if (!projectId.trim()) return null

    const inMemory = snapshotCache.get(projectId)
    if (inMemory) return inMemory

    if (typeof window === "undefined") return null
    try {
        const raw = window.sessionStorage.getItem(sessionStorageKey(projectId))
        if (!raw) return null
        const parsed = JSON.parse(raw) as LocalRepoSnapshot
        if (!parsed?.files?.length) return null
        snapshotCache.set(projectId, parsed)
        return parsed
    } catch {
        return null
    }
}

export function hasLocalRepoSnapshot(projectId: string): boolean {
    return Boolean(getLocalRepoSnapshot(projectId))
}

export function moveLocalRepoSnapshot(fromKey: string, toKey: string): void {
    if (!fromKey.trim() || !toKey.trim()) return
    const snapshot = getLocalRepoSnapshot(fromKey)
    if (!snapshot) return
    setLocalRepoSnapshot(toKey, snapshot)

    snapshotCache.delete(fromKey)
    if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(sessionStorageKey(fromKey))
    }
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
