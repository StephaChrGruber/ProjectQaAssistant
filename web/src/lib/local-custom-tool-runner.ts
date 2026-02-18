"use client"

import {
    getLocalRepoSnapshot,
    localRepoGitCheckoutBranch,
    localRepoGitCreateBranch,
    localRepoGitListBranches,
} from "@/lib/local-repo-bridge"

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
    const snapshot = getLocalRepoSnapshot(projectId)

    function ensureSnapshot() {
        if (!snapshot) {
            throw new Error("No browser-local repository snapshot is available for this project on this device.")
        }
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
            const norm = String(path || "").trim().replaceAll("\\", "/").replace(/^\.?\//, "")
            if (!norm) throw new Error("readFile(path): path is required")
            const f = snapshot!.files.find((row) => row.path === norm)
            if (!f) throw new Error(`File not found in browser-local snapshot: ${norm}`)
            const body = f.content || ""
            if (body.length <= maxChars) return body
            return `${body.slice(0, maxChars)}\n... (truncated)`
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

    const helpers = {
        localRepo: createLocalRepoHelpers(job.projectId),
        nowIso(): string {
            return new Date().toISOString()
        },
    }

    let runFn: ((args: Record<string, unknown>, context: Record<string, unknown>, helpers: any) => unknown) | null = null
    try {
        const factory = new Function(
            `"use strict";
${code}
if (typeof run !== "function") {
  throw new Error("Local custom tool must define function run(args, context, helpers)");
}
return run;`
        )
        runFn = factory() as (args: Record<string, unknown>, context: Record<string, unknown>, helpers: any) => unknown
    } catch (err) {
        throw new Error(`Failed to load local custom tool code: ${errText(err)}`)
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
