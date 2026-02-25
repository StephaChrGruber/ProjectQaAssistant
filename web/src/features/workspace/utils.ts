import type { WorkspaceMode, WorkspacePatchFile, WorkspaceTreeEntry } from "@/features/workspace/types"

export type WorkspaceTreeNode = {
  kind: "folder" | "file"
  name: string
  path: string
  entry?: WorkspaceTreeEntry
  children?: WorkspaceTreeNode[]
}

export function modeLabel(mode: WorkspaceMode): string {
  if (!mode) return "Unknown"
  if (mode === "local") return "Local repository"
  if (mode === "browser_local") return "Browser-local repository"
  if (mode.startsWith("remote:")) return `Remote (${mode.replace("remote:", "")})`
  return mode
}

export function extLanguage(path: string): string {
  const lower = String(path || "").toLowerCase()
  if (lower.endsWith(".ts")) return "typescript"
  if (lower.endsWith(".tsx")) return "typescript"
  if (lower.endsWith(".js")) return "javascript"
  if (lower.endsWith(".jsx")) return "javascript"
  if (lower.endsWith(".json")) return "json"
  if (lower.endsWith(".md")) return "markdown"
  if (lower.endsWith(".py")) return "python"
  if (lower.endsWith(".go")) return "go"
  if (lower.endsWith(".java")) return "java"
  if (lower.endsWith(".cs")) return "csharp"
  if (lower.endsWith(".rs")) return "rust"
  if (lower.endsWith(".sh")) return "shell"
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml"
  if (lower.endsWith(".toml")) return "toml"
  if (lower.endsWith(".sql")) return "sql"
  if (lower.endsWith(".css")) return "css"
  if (lower.endsWith(".html")) return "html"
  return "plaintext"
}

export function buildWorkspaceTree(entries: WorkspaceTreeEntry[]): WorkspaceTreeNode[] {
  type MutableNode = {
    kind: "folder" | "file"
    name: string
    path: string
    entry?: WorkspaceTreeEntry
    children: Map<string, MutableNode>
  }

  const root: MutableNode = { kind: "folder", name: ".", path: ".", children: new Map() }

  for (const entry of entries || []) {
    const rel = String(entry.path || "").trim().replace(/^\/+/, "")
    if (!rel) continue
    const parts = rel.split("/").filter(Boolean)
    if (!parts.length) continue

    let cur = root
    let built = ""
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      built = built ? `${built}/${part}` : part
      const kind: "folder" | "file" = isLast && entry.type === "file" ? "file" : "folder"
      const key = `${kind}:${part}`
      if (!cur.children.has(key)) {
        cur.children.set(key, {
          kind,
          name: part,
          path: built,
          entry: isLast ? entry : undefined,
          children: new Map(),
        })
      }
      const next = cur.children.get(key)!
      if (isLast) next.entry = entry
      cur = next
    }
  }

  const toNode = (node: MutableNode): WorkspaceTreeNode => {
    const children = Array.from(node.children.values())
      .map(toNode)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return {
      kind: node.kind,
      name: node.name,
      path: node.path,
      entry: node.entry,
      children,
    }
  }

  return Array.from(root.children.values())
    .map(toNode)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function selectedHunksMap(files: WorkspacePatchFile[], selected: Record<string, Set<number>>): number {
  let count = 0
  for (const file of files || []) {
    const selectedForFile = selected[file.path]
    if (!selectedForFile) continue
    count += selectedForFile.size
  }
  return count
}
