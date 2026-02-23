import { getLocalRepoRootHandle, getLocalRepoSnapshot, ensureLocalRepoWritePermission, setLocalRepoSession } from "./session"
import { normalizeDocPath } from "./paths"
import type { LocalRepoSnapshot } from "./types"

export async function ensureDirectoryPath(
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

    const rootHandle = getLocalRepoRootHandle(projectId)
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
