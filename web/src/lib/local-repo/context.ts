import {
    DOC_CONTEXT_MAX_CHARS,
    DOC_CONTEXT_MAX_FILE_CHARS,
    DOC_CONTEXT_MAX_FILES,
    IMPORTANT_NAMES,
    MAX_HITS,
    MAX_HITS_PER_TERM,
    STOP_WORDS,
    TEXT_FILE_EXTENSIONS,
} from "./constants"
import { extensionOf, isSkippablePath, normalizeDocPath, normalizeRelPath } from "./paths"
import { getLocalRepoSnapshot } from "./session"
import type { LocalDocumentationContext, LocalRepoHit, LocalRepoSnapshot } from "./types"

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
