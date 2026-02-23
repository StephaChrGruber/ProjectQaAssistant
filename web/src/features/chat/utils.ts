import type {
  ChatAnswerSource,
  ChatChartSeries,
  ChatChartSpec,
  ChatToolPolicy,
  DocTreeNode,
  DocumentationFileEntry,
  ToolCatalogItem,
} from "@/features/chat/types"

export const SOURCE_PREVIEW_LIMIT = 5

function relDocPath(path: string): string {
  return path.replace(/^documentation\/?/, "")
}

export function docAncestorFolders(path: string): string[] {
  const rel = relDocPath(path)
  const parts = rel.split("/").filter(Boolean)
  const out: string[] = []
  let current = "documentation"
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = `${current}/${parts[i]}`
    out.push(current)
  }
  return out
}

export function buildDocTree(files: DocumentationFileEntry[]): DocTreeNode[] {
  type MutableNode = {
    kind: "folder" | "file"
    name: string
    path: string
    file?: DocumentationFileEntry
    children: Map<string, MutableNode>
  }
  const root: MutableNode = { kind: "folder", name: "documentation", path: "documentation", children: new Map() }

  for (const file of files) {
    const rel = relDocPath(file.path)
    if (!rel.trim()) continue
    const parts = rel.split("/").filter(Boolean)
    if (!parts.length) continue

    let cur = root
    let builtPath = "documentation"
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      builtPath = `${builtPath}/${part}`
      const key = `${isLast ? "file" : "folder"}:${part}`
      if (!cur.children.has(key)) {
        cur.children.set(key, {
          kind: isLast ? "file" : "folder",
          name: part,
          path: builtPath,
          file: isLast ? file : undefined,
          children: new Map(),
        })
      }
      const next = cur.children.get(key)!
      if (isLast) {
        next.file = file
      }
      cur = next
    }
  }

  const toReadonly = (node: MutableNode): DocTreeNode => {
    const children = Array.from(node.children.values())
      .map(toReadonly)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return {
      kind: node.kind,
      name: node.name,
      path: node.path,
      file: node.file,
      children,
    }
  }

  return Array.from(root.children.values())
    .map(toReadonly)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function splitChartBlocks(text: string): Array<{ type: "text" | "chart"; value: string }> {
  const parts: Array<{ type: "text" | "chart"; value: string }> = []
  const re = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g
  let cursor = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = re.lastIndex
    const lang = String(m[1] || "").trim().toLowerCase()
    const body = String(m[2] || "").trim()
    const maybeChart = parseChartSpec(body)
    const chartLang = lang === "chart" || lang === "json"

    if (!chartLang || !maybeChart) {
      continue
    }

    if (start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, start) })
    }
    parts.push({ type: "chart", value: body })
    cursor = end
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) })
  }
  return parts
}

export function isDocumentationPath(path?: string): boolean {
  const p = String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
  return /^documentation\/.+\.md$/i.test(p)
}

export function sourceDisplayText(src: ChatAnswerSource): string {
  const path = String(src.path || "").trim()
  const url = String(src.url || "").trim()
  const label = String(src.label || "").trim()
  const line = typeof src.line === "number" && src.line > 0 ? `:${src.line}` : ""
  if (path) return `${path}${line}`
  if (label) return label
  if (url) return url
  return "Source"
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function asksForDocumentationGeneration(text: string): boolean {
  const q = text.toLowerCase()
  const hasDoc = q.includes("documentation") || q.includes("docs")
  const hasAction =
    q.includes("generate") || q.includes("create") || q.includes("build") || q.includes("refresh") || q.includes("update")
  return hasDoc && hasAction
}

export function makeChatId(projectId: string, branch: string, user: string): string {
  return `${projectId}::${branch}::${user}::${Date.now().toString(36)}`
}

export function dedupeChatsById<T extends { chat_id?: string | null }>(items: T[]): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (const item of items || []) {
    const id = (item?.chat_id || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

function sanitizeToolNames(values: string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values || []) {
    const s = String(raw || "").trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export function enabledToolsFromPolicy(catalog: ToolCatalogItem[], policy: ChatToolPolicy | null): Set<string> {
  const all = new Set(catalog.map((t) => t.name))
  if (!policy) return all
  const allowed = sanitizeToolNames(policy.allowed_tools)
  const blocked = new Set(sanitizeToolNames(policy.blocked_tools))
  if (!allowed.length) {
    return new Set(Array.from(all).filter((name) => !blocked.has(name)))
  }
  return new Set(allowed.filter((name) => all.has(name) && !blocked.has(name)))
}

export function parseChartSpec(raw: string): ChatChartSpec | null {
  const text = (raw || "").trim()
  if (!text) return null
  try {
    const obj = JSON.parse(text)
    if (!obj || typeof obj !== "object") return null
    const rec = obj as Record<string, unknown>
    const type = rec.type === "bar" ? "bar" : rec.type === "line" ? "line" : null
    const xKey = typeof rec.xKey === "string" ? rec.xKey : ""
    const data = Array.isArray(rec.data)
      ? (rec.data.filter((d) => d && typeof d === "object") as Array<Record<string, string | number>>)
      : []
    const rawSeries = Array.isArray(rec.series) ? rec.series : []
    const series: ChatChartSeries[] = rawSeries
      .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
      .filter((s): s is Record<string, unknown> => !!s)
      .map((s) => ({
        key: typeof s.key === "string" ? s.key : "",
        label: typeof s.label === "string" ? s.label : undefined,
        color: typeof s.color === "string" ? s.color : undefined,
      }))
      .filter((s) => !!s.key)
    const height = typeof rec.height === "number" ? Math.max(180, Math.min(520, Math.round(rec.height))) : 280
    const title = typeof rec.title === "string" ? rec.title : undefined
    if (!type || !xKey || !data.length || !series.length) return null
    return { type, title, data, xKey, series, height }
  } catch {
    return null
  }
}

