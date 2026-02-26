"use client"

import {
    ensureLocalRepoWritePermission,
    getLocalRepoRootHandle,
    getLocalRepoSnapshot,
    localRepoGitCheckoutBranch,
    localRepoGitCreateBranch,
    localRepoGitListBranches,
    restoreLocalRepoSession,
    setLocalRepoSession,
} from "@/lib/local-repo-bridge"
import { ensureDirectoryPath } from "@/lib/local-repo/docs-write"

export type LocalToolJobPayload = {
    id: string
    toolId: string
    toolName: string
    projectId: string
    branch: string
    chatId?: string | null
    runtime: "local_typescript"
    version?: number | null
    code: string
    args: Record<string, unknown>
    context: Record<string, unknown>
    claimedBy?: string | null
}

type GrepOptions = {
    regex?: boolean
    caseSensitive?: boolean
    maxResults?: number
    contextLines?: number
    glob?: string
}

type GrepHit = {
    path: string
    line: number
    column: number
    snippet: string
    before: string[]
    after: string[]
}

function errText(e: unknown): string {
    if (!e) return "Unknown error"
    if (typeof e === "string") return e
    if (e instanceof Error) return e.message
    try {
        return JSON.stringify(e)
    } catch {
        return String(e)
    }
}

function wildcardToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")
    return new RegExp(`^${escaped}$`)
}

function matchesGlob(path: string, glob?: string): boolean {
    const g = String(glob || "").trim()
    if (!g) return true
    try {
        return wildcardToRegExp(g).test(path)
    } catch {
        return true
    }
}

function createLocalRepoHelpers(projectId: string) {
    let snapshot = getLocalRepoSnapshot(projectId)

    function normalizeRepoPath(path: string): string {
        return String(path || "").trim().replaceAll("\\", "/").replace(/^\.?\//, "").replace(/^\/+/, "")
    }

    function ensureSnapshot() {
        if (!snapshot) {
            throw new Error("No browser-local repository snapshot is available for this project on this device.")
        }
    }

    function resolveReadablePath(path: string): string {
        ensureSnapshot()
        const norm = normalizeRepoPath(path)
        if (!norm) throw new Error("readFile(path): path is required")

        const files = snapshot!.files || []
        if (files.some((row) => row.path === norm)) {
            return norm
        }

        const hasSlash = norm.includes("/")
        // For short names like "agent2.py", allow unique suffix resolution.
        if (!hasSlash) {
            const suffixMatches = files.filter((row) => row.path === norm || row.path.endsWith(`/${norm}`))
            if (suffixMatches.length === 1) {
                return suffixMatches[0].path
            }
            if (suffixMatches.length > 1) {
                const preview = suffixMatches.slice(0, 8).map((row) => row.path).join(", ")
                throw new Error(
                    `File path is ambiguous in browser-local snapshot: ${norm}. ` +
                        `Use a repository-relative path. Matches: ${preview}${suffixMatches.length > 8 ? ", ..." : ""}`
                )
            }
        }

        const containsMatches = files
            .filter((row) => row.path.toLowerCase().includes(norm.toLowerCase()))
            .slice(0, 8)
            .map((row) => row.path)
        const hint =
            containsMatches.length > 0
                ? ` Closest matches: ${containsMatches.join(", ")}${containsMatches.length >= 8 ? ", ..." : ""}`
                : ""
        throw new Error(`File not found in browser-local snapshot: ${norm}.${hint}`)
    }

    async function requireWritableRootHandle(): Promise<FileSystemDirectoryHandle> {
        await restoreLocalRepoSession(projectId)
        const rootHandle = getLocalRepoRootHandle(projectId)
        if (!rootHandle) {
            throw new Error("No writable local repository handle available. Re-pick folder with 'Pick From This Device'.")
        }
        const granted = await ensureLocalRepoWritePermission(projectId)
        if (!granted) {
            throw new Error("Write permission to local repository folder was denied.")
        }
        return rootHandle
    }

    return {
        hasSnapshot(): boolean {
            return Boolean(snapshot)
        },
        info(): { rootName: string; indexedAt: string; files: number } {
            ensureSnapshot()
            return {
                rootName: snapshot!.rootName,
                indexedAt: snapshot!.indexedAt,
                files: snapshot!.files.length,
            }
        },
        listFiles(limit = 500): string[] {
            ensureSnapshot()
            return snapshot!.files.slice(0, Math.max(1, Math.min(limit, 5000))).map((f) => f.path)
        },
        readFile(path: string, maxChars = 200_000): string {
            ensureSnapshot()
            const norm = resolveReadablePath(path)
            const f = snapshot!.files.find((row) => row.path === norm)
            if (!f) throw new Error(`File not found in browser-local snapshot: ${norm}`)
            const body = f.content || ""
            if (body.length <= maxChars) return body
            return `${body.slice(0, maxChars)}\n... (truncated)`
        },
        async writeFile(path: string, content: string): Promise<{ path: string; bytesWritten: number }> {
            const norm = normalizeRepoPath(path)
            if (!norm) throw new Error("writeFile(path): path is required")

            const rootHandle = await requireWritableRootHandle()
            const parts = norm.split("/").filter(Boolean)
            const fileName = parts.pop()
            if (!fileName) throw new Error("writeFile(path): invalid target path")
            const dir = await ensureDirectoryPath(rootHandle, parts)
            const fileHandle = await dir.getFileHandle(fileName, { create: true })
            const writable = await fileHandle.createWritable()
            const normalizedContent = String(content || "").replaceAll("\r\n", "\n")
            await writable.write(normalizedContent)
            await writable.close()

            const currentSnapshot = snapshot || getLocalRepoSnapshot(projectId)
            if (currentSnapshot) {
                const files = [...(currentSnapshot.files || [])]
                const idx = files.findIndex((row) => row.path === norm)
                const nextFile = { path: norm, content: normalizedContent }
                if (idx >= 0) files[idx] = nextFile
                else files.push(nextFile)

                const nextSnapshot = {
                    rootName: currentSnapshot.rootName,
                    files,
                    indexedAt: new Date().toISOString(),
                }
                setLocalRepoSession(projectId, { snapshot: nextSnapshot, rootHandle })
                snapshot = nextSnapshot
            }

            return {
                path: norm,
                bytesWritten: normalizedContent.length,
            }
        },
        async deleteFile(path: string): Promise<{ path: string; deleted: boolean }> {
            const norm = normalizeRepoPath(path)
            if (!norm) throw new Error("deleteFile(path): path is required")

            const rootHandle = await requireWritableRootHandle()
            const parts = norm.split("/").filter(Boolean)
            const fileName = parts.pop()
            if (!fileName) throw new Error("deleteFile(path): invalid target path")

            let dir: FileSystemDirectoryHandle = rootHandle
            for (const part of parts) {
                try {
                    dir = await dir.getDirectoryHandle(part)
                } catch {
                    return { path: norm, deleted: false }
                }
            }

            try {
                await dir.removeEntry(fileName)
            } catch {
                return { path: norm, deleted: false }
            }

            const currentSnapshot = snapshot || getLocalRepoSnapshot(projectId)
            if (currentSnapshot) {
                const files = [...(currentSnapshot.files || [])].filter((row) => row.path !== norm)
                const nextSnapshot = {
                    rootName: currentSnapshot.rootName,
                    files,
                    indexedAt: new Date().toISOString(),
                }
                setLocalRepoSession(projectId, { snapshot: nextSnapshot, rootHandle })
                snapshot = nextSnapshot
            }
            return { path: norm, deleted: true }
        },
        grep(pattern: string, options?: GrepOptions): GrepHit[] {
            ensureSnapshot()
            const regex = options?.regex !== false
            const caseSensitive = Boolean(options?.caseSensitive)
            const maxResults = Math.max(1, Math.min(options?.maxResults || 60, 800))
            const contextLines = Math.max(0, Math.min(options?.contextLines || 2, 12))
            const glob = options?.glob

            const hits: GrepHit[] = []
            let re: RegExp
            if (regex) {
                re = new RegExp(pattern, caseSensitive ? "g" : "gi")
            } else {
                const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                re = new RegExp(esc, caseSensitive ? "g" : "gi")
            }

            for (const file of snapshot!.files) {
                if (!matchesGlob(file.path, glob)) continue
                const lines = (file.content || "").split("\n")
                for (let i = 0; i < lines.length; i += 1) {
                    re.lastIndex = 0
                    const line = lines[i]
                    const m = re.exec(line)
                    if (!m) continue
                    const lineNo = i + 1
                    const before = lines.slice(Math.max(0, i - contextLines), i)
                    const after = lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines))
                    hits.push({
                        path: file.path,
                        line: lineNo,
                        column: (m.index || 0) + 1,
                        snippet: line.slice(0, 500),
                        before,
                        after,
                    })
                    if (hits.length >= maxResults) return hits
                }
            }
            return hits
        },
        git: {
            async listBranches(options?: { maxBranches?: number }) {
                const maxBranches = Math.max(1, Math.min(Number(options?.maxBranches || 200), 1000))
                return await localRepoGitListBranches(projectId, maxBranches)
            },
            async createBranch(input: { branch: string; sourceRef?: string | null; checkout?: boolean }) {
                return await localRepoGitCreateBranch(projectId, input || { branch: "" })
            },
            async checkoutBranch(input: { branch: string; createIfMissing?: boolean; startPoint?: string | null }) {
                return await localRepoGitCheckoutBranch(projectId, input || { branch: "" })
            },
        },
    }
}

export async function executeLocalToolJob(job: LocalToolJobPayload): Promise<unknown> {
    const code = String(job.code || "").trim()
    if (!code) throw new Error("Local custom tool has empty code")
    try {
        await restoreLocalRepoSession(job.projectId)
    } catch {
        // Ignore restore failures; helpers will surface actionable runtime errors if snapshot remains unavailable.
    }

    const helpers = {
        localRepo: createLocalRepoHelpers(job.projectId),
        nowIso(): string {
            return new Date().toISOString()
        },
    }

    function rewriteRunSymbolCollisions(src: string): string {
        return src
            .replace(/\basync\s+function\s+run\s*\(/g, "async function __tool_run_fn__(")
            .replace(/\bfunction\s+run\s*\(/g, "function __tool_run_fn__(")
            .replace(/\bconst\s+run\s*=/g, "const __tool_run_var__ =")
            .replace(/\blet\s+run\s*=/g, "let __tool_run_var__ =")
            .replace(/\bvar\s+run\s*=/g, "var __tool_run_var__ =")
    }

    function compileRunFn(source: string): ((args: Record<string, unknown>, context: Record<string, unknown>, helpers: any) => unknown) {
        const factory = new Function(
            `"use strict";
const __toolModule = { exports: {} };
let exports = __toolModule.exports;
const module = __toolModule;
${source}
const __runCandidates = [];
if (typeof run === "function") __runCandidates.push(run);
if (typeof __tool_run_fn__ === "function") __runCandidates.push(__tool_run_fn__);
if (typeof __tool_run_var__ === "function") __runCandidates.push(__tool_run_var__);
if (typeof module.exports === "function") __runCandidates.push(module.exports);
if (module.exports && typeof module.exports.run === "function") __runCandidates.push(module.exports.run);
if (typeof exports === "function") __runCandidates.push(exports);
if (exports && typeof exports.run === "function") __runCandidates.push(exports.run);
if (!__runCandidates.length) {
  throw new Error("Local custom tool must define function run(args, context, helpers)");
}
return __runCandidates[__runCandidates.length - 1];`
        )
        return factory() as (args: Record<string, unknown>, context: Record<string, unknown>, helpers: any) => unknown
    }

    let runFn: ((args: Record<string, unknown>, context: Record<string, unknown>, helpers: any) => unknown) | null = null
    try {
        runFn = compileRunFn(code)
    } catch (firstErr) {
        try {
            runFn = compileRunFn(rewriteRunSymbolCollisions(code))
        } catch (secondErr) {
            const detail = `${errText(firstErr)} | ${errText(secondErr)}`
            throw new Error(`Failed to load local custom tool code: ${detail}`)
        }
    }
    if (!runFn) throw new Error("Local custom tool runtime failed to initialize")

    try {
        const out = runFn(job.args || {}, job.context || {}, helpers)
        if (out && typeof (out as Promise<unknown>).then === "function") {
            return await (out as Promise<unknown>)
        }
        return out
    } catch (err) {
        throw new Error(`Local custom tool execution failed: ${errText(err)}`)
    }
}
