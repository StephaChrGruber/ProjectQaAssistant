import { SKIP_DIR_PARTS, TEXT_FILE_EXTENSIONS } from "./constants"

export function extensionOf(path: string): string {
    const idx = path.lastIndexOf(".")
    if (idx < 0) return ""
    return path.slice(idx).toLowerCase()
}

export function isLikelyTextFile(file: File, relativePath: string): boolean {
    const ext = extensionOf(relativePath)
    if (TEXT_FILE_EXTENSIONS.has(ext)) return true

    const type = (file.type || "").toLowerCase()
    if (type.startsWith("text/")) return true
    if (type.includes("json") || type.includes("xml") || type.includes("javascript")) return true

    return false
}

export function isSkippablePath(path: string): boolean {
    const parts = path.split("/").map((p) => p.trim()).filter(Boolean)
    return parts.some((part) => SKIP_DIR_PARTS.has(part))
}

export function normalizeRelPath(rawPath: string): string {
    return rawPath.replaceAll("\\", "/").replace(/^\/+/, "")
}

export function firstPathSegment(path: string): string {
    const norm = normalizeRelPath(path)
    const idx = norm.indexOf("/")
    if (idx < 0) return norm || "local-repo"
    return norm.slice(0, idx) || "local-repo"
}

export function normalizeDocPath(rawPath: string): string {
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
