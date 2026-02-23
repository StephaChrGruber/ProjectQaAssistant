import { ensureDirectoryPath } from "./docs-write"
import { normalizeRelPath } from "./paths"
import { ensureLocalRepoWritePermission, getLocalRepoRootHandle, restoreLocalRepoSession } from "./session"
import type {
    LocalRepoGitBranches,
    LocalRepoGitCheckoutBranchReq,
    LocalRepoGitCheckoutBranchRes,
    LocalRepoGitCreateBranchReq,
    LocalRepoGitCreateBranchRes,
} from "./types"

const GIT_SHA_RE = /^[0-9a-f]{40}$/i

function normalizeBranchName(raw: string): string {
    return String(raw || "").trim().replaceAll("\\", "/")
}

function assertValidBranchName(raw: string): string {
    const branch = normalizeBranchName(raw)
    if (!branch) throw new Error("Branch name is required.")
    if (branch.startsWith("/") || branch.endsWith("/")) throw new Error("Invalid branch name.")
    if (branch.includes("..") || branch.includes(" ")) throw new Error("Invalid branch name.")
    if (branch.includes("//")) throw new Error("Invalid branch name.")
    if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Invalid branch name.")
    return branch
}

async function requireRootHandle(projectId: string, requireWrite: boolean): Promise<FileSystemDirectoryHandle> {
    await restoreLocalRepoSession(projectId)
    const rootHandle = getLocalRepoRootHandle(projectId)
    if (!rootHandle) {
        throw new Error("No writable local repository handle available. Re-pick folder with 'Pick From This Device'.")
    }
    if (requireWrite) {
        const granted = await ensureLocalRepoWritePermission(projectId)
        if (!granted) {
            throw new Error("Write permission to local repository folder was denied.")
        }
    }
    return rootHandle
}

async function readFileTextFromHandle(fileHandle: FileSystemFileHandle): Promise<string> {
    const file = await fileHandle.getFile()
    return (await file.text()).replaceAll("\r\n", "\n")
}

async function readRepoFileText(rootHandle: FileSystemDirectoryHandle, relPath: string): Promise<string | null> {
    const parts = normalizeRelPath(relPath).split("/").filter(Boolean)
    if (!parts.length) return null
    const fileName = parts.pop()!
    let dir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) {
        try {
            dir = await dir.getDirectoryHandle(part)
        } catch {
            return null
        }
    }
    try {
        const file = await dir.getFileHandle(fileName)
        return await readFileTextFromHandle(file)
    } catch {
        return null
    }
}

async function writeRepoFileText(rootHandle: FileSystemDirectoryHandle, relPath: string, content: string): Promise<void> {
    const parts = normalizeRelPath(relPath).split("/").filter(Boolean)
    if (!parts.length) throw new Error("Invalid path")
    const fileName = parts.pop()!
    const dir = await ensureDirectoryPath(rootHandle, parts)
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content.endsWith("\n") ? content : `${content}\n`)
    await writable.close()
}

async function collectRefFiles(dir: FileSystemDirectoryHandle, relDir = ""): Promise<string[]> {
    const out: string[] = []
    for await (const [name, child] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        const rel = relDir ? `${relDir}/${name}` : name
        if (child.kind === "directory") {
            out.push(...(await collectRefFiles(child as FileSystemDirectoryHandle, rel)))
            continue
        }
        out.push(rel)
    }
    return out
}

function parsePackedRefs(text: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const rawLine of String(text || "").split("\n")) {
        const line = rawLine.trim()
        if (!line || line.startsWith("#") || line.startsWith("^")) continue
        const parts = line.split(/\s+/g).filter(Boolean)
        if (parts.length < 2) continue
        const sha = (parts[0] || "").trim()
        const ref = (parts[1] || "").trim()
        if (!GIT_SHA_RE.test(sha) || !ref) continue
        out.set(ref, sha.toLowerCase())
    }
    return out
}

type ResolvedGitRef = {
    commit: string
    ref: string | null
}

async function readHeadInfo(rootHandle: FileSystemDirectoryHandle): Promise<{ ref: string | null; commit: string | null }> {
    const head = (await readRepoFileText(rootHandle, ".git/HEAD")) || ""
    const trimmed = head.trim()
    if (!trimmed) return { ref: null, commit: null }
    if (trimmed.startsWith("ref:")) {
        const ref = trimmed.slice(4).trim()
        return { ref: ref || null, commit: null }
    }
    if (GIT_SHA_RE.test(trimmed)) {
        return { ref: null, commit: trimmed.toLowerCase() }
    }
    return { ref: null, commit: null }
}

async function resolveRefCommit(rootHandle: FileSystemDirectoryHandle, refOrBranch: string): Promise<ResolvedGitRef | null> {
    const raw = String(refOrBranch || "").trim()
    if (!raw) return null
    if (GIT_SHA_RE.test(raw)) {
        return { commit: raw.toLowerCase(), ref: null }
    }

    const packed = parsePackedRefs((await readRepoFileText(rootHandle, ".git/packed-refs")) || "")
    const candidates: string[] = []
    if (raw.startsWith("refs/")) {
        candidates.push(raw)
    } else {
        candidates.push(`refs/heads/${raw}`)
        candidates.push(raw)
    }

    for (const ref of candidates) {
        const loose = (await readRepoFileText(rootHandle, `.git/${ref}`)) || ""
        const looseSha = loose.trim()
        if (GIT_SHA_RE.test(looseSha)) {
            return { commit: looseSha.toLowerCase(), ref }
        }
        const packedSha = packed.get(ref)
        if (packedSha && GIT_SHA_RE.test(packedSha)) {
            return { commit: packedSha.toLowerCase(), ref }
        }
    }
    return null
}

async function listBranchCommits(rootHandle: FileSystemDirectoryHandle): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    try {
        const heads = await rootHandle
            .getDirectoryHandle(".git")
            .then((git) => git.getDirectoryHandle("refs"))
            .then((refs) => refs.getDirectoryHandle("heads"))
        const refFiles = await collectRefFiles(heads)
        for (const rel of refFiles) {
            const branch = normalizeRelPath(rel)
            if (!branch) continue
            const text = (await readRepoFileText(rootHandle, `.git/refs/heads/${branch}`)) || ""
            const sha = text.trim().toLowerCase()
            if (GIT_SHA_RE.test(sha)) out.set(branch, sha)
        }
    } catch {
        // no loose refs
    }

    const packed = parsePackedRefs((await readRepoFileText(rootHandle, ".git/packed-refs")) || "")
    for (const [ref, sha] of packed.entries()) {
        if (!ref.startsWith("refs/heads/")) continue
        const branch = ref.slice("refs/heads/".length)
        if (!branch) continue
        if (!out.has(branch)) out.set(branch, sha)
    }
    return out
}

function dedupeBranches(activeBranch: string | null, branchNames: string[], maxBranches: number): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const active = normalizeBranchName(activeBranch || "")
    if (active) {
        seen.add(active)
        out.push(active)
    }
    for (const raw of branchNames) {
        const branch = normalizeBranchName(raw)
        if (!branch || seen.has(branch)) continue
        seen.add(branch)
        out.push(branch)
    }
    return out.slice(0, Math.max(1, Math.min(maxBranches, 1000)))
}

export async function localRepoGitListBranches(projectId: string, maxBranches = 200): Promise<LocalRepoGitBranches> {
    const rootHandle = await requireRootHandle(projectId, false)
    const head = await readHeadInfo(rootHandle)
    const commits = await listBranchCommits(rootHandle)
    const activeBranch = head.ref?.startsWith("refs/heads/") ? head.ref.slice("refs/heads/".length) : null
    const branches = dedupeBranches(activeBranch, Array.from(commits.keys()).sort((a, b) => a.localeCompare(b)), maxBranches)
    return {
        activeBranch: activeBranch || branches[0] || "main",
        detached: !activeBranch,
        branches,
    }
}

export async function localRepoGitCreateBranch(projectId: string, req: LocalRepoGitCreateBranchReq): Promise<LocalRepoGitCreateBranchRes> {
    const rootHandle = await requireRootHandle(projectId, true)
    const targetBranch = assertValidBranchName(req.branch)
    const targetRef = `refs/heads/${targetBranch}`

    const existing = await resolveRefCommit(rootHandle, targetRef)
    if (existing) {
        throw new Error(`Branch already exists: ${targetBranch}`)
    }

    const head = await readHeadInfo(rootHandle)
    let source = await resolveRefCommit(rootHandle, String(req.sourceRef || "").trim())
    if (!source && head.ref) {
        source = await resolveRefCommit(rootHandle, head.ref)
    }
    if (!source && head.commit && GIT_SHA_RE.test(head.commit)) {
        source = { commit: head.commit.toLowerCase(), ref: null }
    }
    if (!source) {
        source = await resolveRefCommit(rootHandle, "main")
    }
    if (!source) {
        throw new Error("Could not resolve source ref for branch creation.")
    }

    await writeRepoFileText(rootHandle, `.git/${targetRef}`, `${source.commit}\n`)
    const shouldCheckout = req.checkout !== false
    if (shouldCheckout) {
        await writeRepoFileText(rootHandle, ".git/HEAD", `ref: ${targetRef}\n`)
    }

    const sourceRef = source.ref?.startsWith("refs/heads/") ? source.ref.slice("refs/heads/".length) : (source.ref || source.commit)
    return {
        branch: targetBranch,
        sourceRef,
        checkedOut: shouldCheckout,
        currentBranch: shouldCheckout ? targetBranch : (head.ref?.slice("refs/heads/".length) || targetBranch),
    }
}

export async function localRepoGitCheckoutBranch(projectId: string, req: LocalRepoGitCheckoutBranchReq): Promise<LocalRepoGitCheckoutBranchRes> {
    const rootHandle = await requireRootHandle(projectId, true)
    const branch = assertValidBranchName(req.branch)
    const head = await readHeadInfo(rootHandle)
    const previousBranch = head.ref?.startsWith("refs/heads/") ? head.ref.slice("refs/heads/".length) : null

    const targetRef = `refs/heads/${branch}`
    let target = await resolveRefCommit(rootHandle, targetRef)
    let created = false
    if (!target) {
        if (!req.createIfMissing) {
            throw new Error(`Branch does not exist: ${branch}`)
        }
        const start = String(req.startPoint || "").trim()
        let source = await resolveRefCommit(rootHandle, start)
        if (!source && previousBranch) source = await resolveRefCommit(rootHandle, previousBranch)
        if (!source && head.commit) source = { commit: head.commit, ref: null }
        if (!source) source = await resolveRefCommit(rootHandle, "main")
        if (!source) {
            throw new Error("Could not resolve start point for branch creation.")
        }
        await writeRepoFileText(rootHandle, `.git/${targetRef}`, `${source.commit}\n`)
        created = true
        target = source
    }
    if (!target) {
        throw new Error(`Branch does not exist: ${branch}`)
    }

    await writeRepoFileText(rootHandle, ".git/HEAD", `ref: ${targetRef}\n`)
    return {
        branch,
        previousBranch,
        created,
    }
}
