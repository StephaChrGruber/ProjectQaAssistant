"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import SendRounded from "@mui/icons-material/SendRounded"
import ClearAllRounded from "@mui/icons-material/ClearAllRounded"
import DescriptionRounded from "@mui/icons-material/DescriptionRounded"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import CloseRounded from "@mui/icons-material/CloseRounded"
import FolderRounded from "@mui/icons-material/FolderRounded"
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import BuildRounded from "@mui/icons-material/BuildRounded"
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded"
import { backendJson } from "@/lib/backend"
import { ProjectDrawerLayout, type DrawerChat, type DrawerUser } from "@/components/ProjectDrawerLayout"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"
import {
    buildLocalRepoDocumentationContext,
    buildFrontendLocalRepoContext,
    ensureLocalRepoWritePermission,
    hasLocalRepoSnapshot,
    hasLocalRepoWriteCapability,
    isBrowserLocalRepoPath,
    listLocalDocumentationFiles,
    readLocalDocumentationFile,
    restoreLocalRepoSession,
    writeLocalDocumentationFiles,
} from "@/lib/local-repo-bridge"
import { executeLocalToolJob, type LocalToolJobPayload } from "@/lib/local-custom-tool-runner"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

type ChatMessage = {
    role: "user" | "assistant" | "system" | "tool"
    content: string
    ts?: string
    meta?: {
        tool_summary?: {
            calls?: number
            errors?: number
            cached_hits?: number
        }
        sources?: ChatAnswerSource[]
        grounded?: boolean
    }
}

type ProjectDoc = {
    _id: string
    key?: string
    name?: string
    repo_path?: string
    default_branch?: string
    llm_provider?: string
    llm_model?: string
    llm_profile_id?: string
}

type MeResponse = {
    user?: DrawerUser
}

type BranchesResponse = {
    branches?: string[]
}

type ChatResponse = {
    chat_id: string
    messages: ChatMessage[]
    memory_summary?: ChatMemorySummary
}

type AskAgentResponse = {
    answer?: string
    tool_events?: Array<{
        tool: string
        ok: boolean
        duration_ms: number
        attempts?: number
        cached?: boolean
        input_bytes?: number
        result_bytes?: number
        error?: {
            code?: string
            message?: string
            retryable?: boolean
        } | null
    }>
    sources?: ChatAnswerSource[]
    grounded?: boolean
    memory_summary?: ChatMemorySummary
}

type LocalToolClaimResponse = {
    job: LocalToolJobPayload | null
}

type LlmProfileDoc = {
    id: string
    name: string
    provider: string
    model: string
}

type ChatLlmProfileResponse = {
    chat_id: string
    llm_profile_id?: string | null
}

type ChatAnswerSource = {
    label: string
    kind?: "url" | "documentation" | "file" | string
    source?: string
    url?: string
    path?: string
    line?: number
    snippet?: string
    confidence?: number
}

type ChatMemorySummary = {
    decisions?: string[]
    open_questions?: string[]
    next_steps?: string[]
    updated_at?: string
}

type ToolCatalogItem = {
    name: string
    description?: string
    timeout_sec?: number
    rate_limit_per_min?: number
    max_retries?: number
    cache_ttl_sec?: number
    read_only?: boolean
    require_approval?: boolean
    origin?: string
    runtime?: string
    version?: string
}

type ToolCatalogResponse = {
    tools: ToolCatalogItem[]
}

type ChatToolPolicy = {
    allowed_tools?: string[]
    blocked_tools?: string[]
    read_only_only?: boolean
}

type ChatToolPolicyResponse = {
    chat_id: string
    tool_policy?: ChatToolPolicy
}

type ChatToolApproval = {
    toolName: string
    expiresAt?: string
}

type ChatToolApprovalsResponse = {
    chat_id: string
    items?: ChatToolApproval[]
}

type GenerateDocsResponse = {
    branch?: string
    current_branch?: string
    mode?: string
    summary?: string
    llm_error?: string | null
    files_written?: string[]
    files?: Array<{ path: string; content: string }>
}

type DocumentationFileEntry = {
    path: string
    size?: number | null
    updated_at?: string | null
}

type DocumentationListResponse = {
    branch?: string
    current_branch?: string
    files?: DocumentationFileEntry[]
}

type DocumentationFileResponse = {
    branch?: string
    path: string
    content: string
}

type DocTreeNode = {
    kind: "folder" | "file"
    name: string
    path: string
    file?: DocumentationFileEntry
    children?: DocTreeNode[]
}

type ChatChartSeries = {
    key: string
    label?: string
    color?: string
}

type ChatChartSpec = {
    type: "line" | "bar"
    title?: string
    data: Array<Record<string, string | number>>
    xKey: string
    series: ChatChartSeries[]
    height?: number
}

type TokenKind = "plain" | "keyword" | "string" | "number" | "comment" | "operator" | "type" | "builtin"

type Token = {
    kind: TokenKind
    text: string
}

const SOURCE_PREVIEW_LIMIT = 5

type LangRule = {
    kind: Exclude<TokenKind, "plain">
    re: RegExp
}

function relDocPath(path: string): string {
    return path.replace(/^documentation\/?/, "")
}

function docAncestorFolders(path: string): string[] {
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

function buildDocTree(files: DocumentationFileEntry[]): DocTreeNode[] {
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

function splitChartBlocks(text: string): Array<{ type: "text" | "chart"; value: string }> {
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

function isDocumentationPath(path?: string): boolean {
    const p = String(path || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "")
    return /^documentation\/.+\.md$/i.test(p)
}

function sourceDisplayText(src: ChatAnswerSource): string {
    const path = String(src.path || "").trim()
    const url = String(src.url || "").trim()
    const label = String(src.label || "").trim()
    const line = typeof src.line === "number" && src.line > 0 ? `:${src.line}` : ""
    if (path) return `${path}${line}`
    if (label) return label
    if (url) return url
    return "Source"
}

function errText(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

function asksForDocumentationGeneration(text: string): boolean {
    const q = text.toLowerCase()
    const hasDoc = q.includes("documentation") || q.includes("docs")
    const hasAction =
        q.includes("generate") ||
        q.includes("create") ||
        q.includes("build") ||
        q.includes("refresh") ||
        q.includes("update")
    return hasDoc && hasAction
}

function makeChatId(projectId: string, branch: string, user: string): string {
    return `${projectId}::${branch}::${user}::${Date.now().toString(36)}`
}

function dedupeChatsById(items: DrawerChat[]): DrawerChat[] {
    const out: DrawerChat[] = []
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

function enabledToolsFromPolicy(catalog: ToolCatalogItem[], policy: ChatToolPolicy | null): Set<string> {
    const all = new Set(catalog.map((t) => t.name))
    if (!policy) return all
    const allowed = sanitizeToolNames(policy.allowed_tools)
    const blocked = new Set(sanitizeToolNames(policy.blocked_tools))
    if (!allowed.length) {
        return new Set(Array.from(all).filter((name) => !blocked.has(name)))
    }
    return new Set(allowed.filter((name) => all.has(name) && !blocked.has(name)))
}

function parseChartSpec(raw: string): ChatChartSpec | null {
    const text = (raw || "").trim()
    if (!text) return null
    try {
        const obj = JSON.parse(text)
        if (!obj || typeof obj !== "object") return null
        const rec = obj as Record<string, unknown>
        const type = rec.type === "bar" ? "bar" : rec.type === "line" ? "line" : null
        const xKey = typeof rec.xKey === "string" ? rec.xKey : ""
        const data = Array.isArray(rec.data) ? rec.data.filter((d) => d && typeof d === "object") as Array<Record<string, string | number>> : []
        const rawSeries = Array.isArray(rec.series) ? rec.series : []
        const series: ChatChartSeries[] = rawSeries
            .map((s) => (s && typeof s === "object" ? s as Record<string, unknown> : null))
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
    } catch {}
    return null
}

function normalizeLanguage(raw?: string): string {
    const lang = String(raw || "").trim().toLowerCase()
    if (!lang) return ""
    const alias: Record<string, string> = {
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        py: "python",
        sh: "bash",
        shell: "bash",
        zsh: "bash",
        yml: "yaml",
        cs: "csharp",
    }
    return alias[lang] || lang
}

function keywordRegex(words: string[]): RegExp {
    return new RegExp(`\\b(?:${words.join("|")})\\b`, "y")
}

function rulesForLanguage(language: string): LangRule[] {
    const commonStringRules: LangRule[] = [
        { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
        { kind: "string", re: /'(?:\\.|[^'\\])*'/y },
        { kind: "string", re: /`(?:\\.|[^`\\])*`/y },
    ]
    const commonNumberRules: LangRule[] = [{ kind: "number", re: /\b\d+(?:\.\d+)?\b/y }]
    const commonOperatorRules: LangRule[] = [{ kind: "operator", re: /[{}()[\].,;:+\-*/%=<>!&|^~?]+/y }]

    if (language === "python") {
        return [
            { kind: "comment", re: /#[^\n]*/y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["def", "class", "if", "elif", "else", "for", "while", "try", "except", "finally", "return", "import", "from", "as", "with", "lambda", "pass", "break", "continue", "yield", "raise", "in", "is", "not", "and", "or"]) },
            { kind: "builtin", re: keywordRegex(["True", "False", "None"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "json") {
        return [
            { kind: "string", re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
            { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
            { kind: "builtin", re: keywordRegex(["true", "false", "null"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "bash") {
        return [
            { kind: "comment", re: /#[^\n]*/y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["if", "then", "else", "fi", "for", "in", "do", "done", "case", "esac", "while", "function"]) },
            { kind: "builtin", re: keywordRegex(["echo", "cd", "export", "source", "pwd", "cat", "grep", "awk", "sed", "git", "npm", "python", "node"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "sql") {
        return [
            { kind: "comment", re: /--[^\n]*/y },
            { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["select", "from", "where", "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "limit", "offset", "as", "and", "or", "not"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "yaml") {
        return [
            { kind: "comment", re: /#[^\n]*/y },
            { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
            { kind: "string", re: /'(?:\\.|[^'\\])*'/y },
            { kind: "keyword", re: /\b[A-Za-z_][A-Za-z0-9_-]*(?=\s*:)/y },
            { kind: "builtin", re: keywordRegex(["true", "false", "null"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "java") {
        return [
            { kind: "comment", re: /\/\/[^\n]*/y },
            { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["class", "interface", "enum", "public", "private", "protected", "static", "final", "void", "if", "else", "switch", "case", "for", "while", "do", "try", "catch", "finally", "return", "new", "package", "import", "extends", "implements"]) },
            { kind: "type", re: keywordRegex(["int", "long", "double", "float", "boolean", "char", "byte", "short", "String"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "go") {
        return [
            { kind: "comment", re: /\/\/[^\n]*/y },
            { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["package", "import", "func", "type", "struct", "interface", "if", "else", "for", "range", "switch", "case", "default", "return", "go", "defer", "var", "const"]) },
            { kind: "type", re: keywordRegex(["int", "int64", "float64", "string", "bool", "byte", "rune"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "csharp") {
        return [
            { kind: "comment", re: /\/\/[^\n]*/y },
            { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["class", "interface", "enum", "public", "private", "protected", "internal", "static", "void", "if", "else", "switch", "case", "for", "foreach", "while", "try", "catch", "finally", "return", "new", "namespace", "using"]) },
            { kind: "type", re: keywordRegex(["int", "long", "double", "float", "bool", "char", "byte", "string", "decimal"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "rust") {
        return [
            { kind: "comment", re: /\/\/[^\n]*/y },
            { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
            ...commonStringRules,
            { kind: "keyword", re: keywordRegex(["fn", "struct", "enum", "impl", "trait", "pub", "use", "mod", "let", "mut", "if", "else", "match", "for", "while", "loop", "return"]) },
            { kind: "type", re: keywordRegex(["i32", "i64", "u32", "u64", "f32", "f64", "bool", "str", "String"]) },
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    if (language === "html") {
        return [
            { kind: "comment", re: /<!--[\s\S]*?-->/y },
            { kind: "keyword", re: /<\/?[A-Za-z][A-Za-z0-9-]*/y },
            { kind: "operator", re: /\/?>/y },
            ...commonStringRules,
        ]
    }

    if (language === "css") {
        return [
            { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
            { kind: "keyword", re: /[.#]?[A-Za-z_-][A-Za-z0-9_-]*(?=\s*\{)/y },
            { kind: "type", re: /[A-Za-z-]+(?=\s*:)/y },
            ...commonStringRules,
            ...commonNumberRules,
            ...commonOperatorRules,
        ]
    }

    return [
        { kind: "comment", re: /\/\/[^\n]*/y },
        { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
        ...commonStringRules,
        { kind: "keyword", re: keywordRegex(["function", "const", "let", "var", "class", "interface", "type", "if", "else", "switch", "case", "for", "while", "do", "return", "import", "from", "export", "async", "await", "try", "catch", "finally", "new"]) },
        { kind: "builtin", re: keywordRegex(["true", "false", "null", "undefined"]) },
        ...commonNumberRules,
        ...commonOperatorRules,
    ]
}

function tokenizeCode(code: string, language: string): Token[] {
    const rules = rulesForLanguage(normalizeLanguage(language))
    const out: Token[] = []
    let i = 0
    while (i < code.length) {
        let matched = false
        for (const rule of rules) {
            rule.re.lastIndex = i
            const m = rule.re.exec(code)
            if (m && m.index === i && m[0].length > 0) {
                out.push({ kind: rule.kind, text: m[0] })
                i += m[0].length
                matched = true
                break
            }
        }
        if (!matched) {
            out.push({ kind: "plain", text: code[i] })
            i += 1
        }
    }
    return out
}

function tokenColor(kind: TokenKind, isUser: boolean): string {
    if (kind === "keyword") return isUser ? "#FFE082" : "#5C6BC0"
    if (kind === "string") return isUser ? "#A5D6A7" : "#2E7D32"
    if (kind === "number") return isUser ? "#FFCC80" : "#EF6C00"
    if (kind === "comment") return isUser ? "#B0BEC5" : "#607D8B"
    if (kind === "operator") return isUser ? "#F8BBD0" : "#C2185B"
    if (kind === "type") return isUser ? "#80DEEA" : "#00838F"
    if (kind === "builtin") return isUser ? "#CE93D8" : "#6A1B9A"
    return isUser ? "rgba(255,255,255,0.95)" : "inherit"
}

export default function ProjectChatPage() {
    const { projectId } = useParams<{ projectId: string }>()
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialChatRef = useRef(searchParams.get("chat"))
    const initialBranchRef = useRef(searchParams.get("branch"))

    const [me, setMe] = useState<DrawerUser | null>(null)
    const [project, setProject] = useState<ProjectDoc | null>(null)
    const [branches, setBranches] = useState<string[]>(["main"])
    const [branch, setBranch] = useState("main")

    const [chats, setChats] = useState<DrawerChat[]>([])
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
    const selectedChatIdRef = useRef<string | null>(null)

    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState("")
    const [loadingChats, setLoadingChats] = useState(false)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lastToolEvents, setLastToolEvents] = useState<AskAgentResponse["tool_events"]>([])
    const [toolEventsDismissed, setToolEventsDismissed] = useState(false)
    const [booting, setBooting] = useState(true)
    const [docsOpen, setDocsOpen] = useState(false)
    const [docsLoading, setDocsLoading] = useState(false)
    const [docsGenerating, setDocsGenerating] = useState(false)
    const [docsError, setDocsError] = useState<string | null>(null)
    const [docsNotice, setDocsNotice] = useState<string | null>(null)
    const [docsFiles, setDocsFiles] = useState<DocumentationFileEntry[]>([])
    const [expandedDocFolders, setExpandedDocFolders] = useState<string[]>([])
    const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null)
    const [selectedDocContent, setSelectedDocContent] = useState("")
    const [docContentLoading, setDocContentLoading] = useState(false)
    const [toolsOpen, setToolsOpen] = useState(false)
    const [toolsLoading, setToolsLoading] = useState(false)
    const [toolsSaving, setToolsSaving] = useState(false)
    const [toolsError, setToolsError] = useState<string | null>(null)
    const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([])
    const [chatToolPolicy, setChatToolPolicy] = useState<ChatToolPolicy | null>(null)
    const [toolEnabledSet, setToolEnabledSet] = useState<Set<string>>(new Set())
    const [toolReadOnlyOnly, setToolReadOnlyOnly] = useState(false)
    const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set())
    const [approvalBusyTool, setApprovalBusyTool] = useState<string | null>(null)
    const [llmProfiles, setLlmProfiles] = useState<LlmProfileDoc[]>([])
    const [selectedLlmProfileId, setSelectedLlmProfileId] = useState<string>("")
    const [savingLlmProfile, setSavingLlmProfile] = useState(false)
    const [expandedSourceMessages, setExpandedSourceMessages] = useState<Record<string, boolean>>({})
    const [chatMemory, setChatMemory] = useState<ChatMemorySummary | null>(null)

    const scrollRef = useRef<HTMLDivElement | null>(null)
    const projectLabel = useMemo(() => project?.name || project?.key || projectId, [project, projectId])
    const userId = useMemo(() => me?.email || "dev@local", [me])
    const browserLocalRepoMode = useMemo(
        () => isBrowserLocalRepoPath((project?.repo_path || "").trim()),
        [project?.repo_path]
    )
    const docsTree = useMemo(() => buildDocTree(docsFiles), [docsFiles])
    const enabledToolCount = useMemo(() => toolEnabledSet.size, [toolEnabledSet])
    const selectedLlmProfile = useMemo(
        () => llmProfiles.find((p) => p.id === selectedLlmProfileId) || null,
        [llmProfiles, selectedLlmProfileId]
    )
    const memoryHasItems = useMemo(() => {
        const d = chatMemory?.decisions || []
        const q = chatMemory?.open_questions || []
        const n = chatMemory?.next_steps || []
        return d.length > 0 || q.length > 0 || n.length > 0
    }, [chatMemory])

    useEffect(() => {
        if (!error) return
        const timer = window.setTimeout(() => setError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [error])

    useEffect(() => {
        if (!docsNotice) return
        const timer = window.setTimeout(() => setDocsNotice(null), 7000)
        return () => window.clearTimeout(timer)
    }, [docsNotice])

    useEffect(() => {
        if (!docsError) return
        const timer = window.setTimeout(() => setDocsError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [docsError])

    useEffect(() => {
        if (!toolsError) return
        const timer = window.setTimeout(() => setToolsError(null), 9000)
        return () => window.clearTimeout(timer)
    }, [toolsError])

    useEffect(() => {
        if (!lastToolEvents?.length) {
            setToolEventsDismissed(false)
            return
        }
        setToolEventsDismissed(false)
        const timer = window.setTimeout(() => setToolEventsDismissed(true), 12000)
        return () => window.clearTimeout(timer)
    }, [lastToolEvents])

    useEffect(() => {
        selectedChatIdRef.current = selectedChatId
    }, [selectedChatId])

    const syncUrl = useCallback(
        (chatId: string, activeBranch: string) => {
            const next = buildChatPath(projectId, activeBranch, chatId)
            router.replace(next)
        },
        [projectId, router]
    )

    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
    }, [])

    const toggleSourceList = useCallback((messageKey: string) => {
        setExpandedSourceMessages((prev) => ({ ...prev, [messageKey]: !prev[messageKey] }))
    }, [])

    const ensureChat = useCallback(
        async (chatId: string, activeBranch: string) => {
            await backendJson<ChatResponse>("/api/chats/ensure", {
                method: "POST",
                body: JSON.stringify({
                    chat_id: chatId,
                    project_id: projectId,
                    branch: activeBranch,
                    user: userId,
                    messages: [],
                }),
            })
        },
        [projectId, userId]
    )

    const loadMessages = useCallback(async (chatId: string) => {
        const doc = await backendJson<ChatResponse>(`/api/chats/${encodeURIComponent(chatId)}`)
        setMessages(doc.messages || [])
        setChatMemory((doc.memory_summary as ChatMemorySummary) || null)
    }, [])

    const loadChats = useCallback(
        async (activeBranch: string, preferredChatId?: string | null) => {
            setLoadingChats(true)
            try {
                const docs = await backendJson<DrawerChat[]>(
                    `/api/projects/${projectId}/chats?branch=${encodeURIComponent(activeBranch)}&limit=100&user=${encodeURIComponent(userId)}`
                )
                const uniqueDocs = dedupeChatsById(docs || [])

                const current = preferredChatId || selectedChatIdRef.current
                if (current && !uniqueDocs.some((c) => c.chat_id === current)) {
                    await ensureChat(current, activeBranch)
                    const now = new Date().toISOString()
                    const merged: DrawerChat[] = [
                        {
                            chat_id: current,
                            title: `${projectLabel} / ${activeBranch}`,
                            branch: activeBranch,
                            updated_at: now,
                            created_at: now,
                        },
                        ...uniqueDocs.filter((c) => c.chat_id !== current),
                    ]
                    setChats(dedupeChatsById(merged))
                    setSelectedChatId(current)
                    return current
                }

                if (!uniqueDocs.length) {
                    const fallback = preferredChatId || `${projectId}::${activeBranch}::${userId}`
                    await ensureChat(fallback, activeBranch)
                    const now = new Date().toISOString()
                    const seeded: DrawerChat = {
                        chat_id: fallback,
                        title: `${projectLabel} / ${activeBranch}`,
                        branch: activeBranch,
                        updated_at: now,
                        created_at: now,
                    }
                    setChats([seeded])
                    setSelectedChatId(fallback)
                    return fallback
                }

                setChats(uniqueDocs)
                const next =
                    (current && uniqueDocs.some((c) => c.chat_id === current) && current) || uniqueDocs[0]?.chat_id || null
                setSelectedChatId(next)
                return next
            } finally {
                setLoadingChats(false)
            }
        },
        [ensureChat, projectId, projectLabel, userId]
    )

    const loadChatToolConfig = useCallback(
        async (chatId: string) => {
            setToolsLoading(true)
            setToolsError(null)
            try {
                const [catalogRes, policyRes, approvalsRes] = await Promise.all([
                    backendJson<ToolCatalogResponse>(`/api/tools/catalog?projectId=${encodeURIComponent(projectId)}`),
                    backendJson<ChatToolPolicyResponse>(`/api/chats/${encodeURIComponent(chatId)}/tool-policy`),
                    backendJson<ChatToolApprovalsResponse>(
                        `/api/chats/${encodeURIComponent(chatId)}/tool-approvals?user=${encodeURIComponent(userId)}`
                    ),
                ])
                const catalog = (catalogRes.tools || []).filter((t) => !!t.name)
                const policy = (policyRes.tool_policy || {}) as ChatToolPolicy
                const enabled = enabledToolsFromPolicy(catalog, policy)
                const approved = new Set(
                    (approvalsRes.items || [])
                        .map((row) => String(row.toolName || "").trim())
                        .filter(Boolean)
                )

                setToolCatalog(catalog)
                setChatToolPolicy(policy)
                setToolEnabledSet(enabled)
                setToolReadOnlyOnly(Boolean(policy.read_only_only))
                setApprovedTools(approved)
            } catch (err) {
                setToolsError(errText(err))
            } finally {
                setToolsLoading(false)
            }
        },
        [projectId, userId]
    )

    const loadLlmProfiles = useCallback(async () => {
        try {
            const rows = await backendJson<LlmProfileDoc[]>("/api/llm/profiles")
            setLlmProfiles((rows || []).filter((r) => r && r.id))
        } catch {
            setLlmProfiles([])
        }
    }, [])

    const loadChatLlmProfile = useCallback(async (chatId: string) => {
        try {
            const out = await backendJson<ChatLlmProfileResponse>(`/api/chats/${encodeURIComponent(chatId)}/llm-profile`)
            setSelectedLlmProfileId((out.llm_profile_id || "").trim())
        } catch {
            setSelectedLlmProfileId("")
        }
    }, [])

    useEffect(() => {
        let stopped = false
        let inFlight = false
        const claimId = `webchat-${projectId}-${Math.random().toString(36).slice(2, 10)}`

        async function tick() {
            if (stopped || inFlight) return
            inFlight = true
            try {
                const claim = await backendJson<LocalToolClaimResponse>("/api/local-tools/jobs/claim", {
                    method: "POST",
                    body: JSON.stringify({
                        projectId,
                        claimId,
                        user: userId,
                    }),
                })
                const job = claim.job
                if (!job?.id) return

                try {
                    const result = await executeLocalToolJob(job)
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/complete`, {
                        method: "POST",
                        body: JSON.stringify({ claimId, result, user: userId }),
                    })
                } catch (err) {
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/fail`, {
                        method: "POST",
                        body: JSON.stringify({ claimId, error: errText(err), user: userId }),
                    })
                }
            } catch {
                // Silent background worker: avoid noisy UI when no jobs are pending.
            } finally {
                inFlight = false
            }
        }

        const timer = window.setInterval(() => {
            void tick()
        }, 900)
        void tick()

        return () => {
            stopped = true
            window.clearInterval(timer)
        }
    }, [projectId, userId])

    const saveChatLlmProfile = useCallback(async (chatId: string, llmProfileId: string) => {
        setSavingLlmProfile(true)
        try {
            await backendJson<ChatLlmProfileResponse>(`/api/chats/${encodeURIComponent(chatId)}/llm-profile`, {
                method: "PUT",
                body: JSON.stringify({ llm_profile_id: llmProfileId || null }),
            })
            setDocsNotice(llmProfileId ? "Chat LLM profile updated." : "Chat LLM profile cleared.")
        } catch (err) {
            setError(errText(err))
        } finally {
            setSavingLlmProfile(false)
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        async function boot() {
            setBooting(true)
            setError(null)
            try {
                const [meRes, projectRes] = await Promise.all([
                    backendJson<MeResponse>("/api/me"),
                    backendJson<ProjectDoc>(`/api/projects/${projectId}`),
                ])
                if (cancelled) return
                setMe(meRes.user || null)
                setProject(projectRes)

                let fetchedBranches: string[] = []
                try {
                    const b = await backendJson<BranchesResponse>(`/api/projects/${projectId}/branches`)
                    fetchedBranches = (b.branches || []).filter(Boolean)
                } catch {
                    fetchedBranches = []
                }

                if (!fetchedBranches.length) {
                    fetchedBranches = [projectRes.default_branch || "main"]
                }

                setBranches(fetchedBranches)

                const urlBranch = (initialBranchRef.current || "").trim()
                const preferred = (projectRes.default_branch || "").trim()
                if (urlBranch && fetchedBranches.includes(urlBranch)) {
                    setBranch(urlBranch)
                } else if (preferred && fetchedBranches.includes(preferred)) {
                    setBranch(preferred)
                } else {
                    setBranch(fetchedBranches[0] || "main")
                }
                await loadLlmProfiles()
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            } finally {
                if (!cancelled) {
                    setBooting(false)
                }
            }
        }

        void boot()
        return () => {
            cancelled = true
        }
    }, [loadLlmProfiles, projectId])

    useEffect(() => {
        if (!branch) return
        let cancelled = false

        async function loadByBranch() {
            try {
                const next = await loadChats(branch, initialChatRef.current)
                if (!cancelled && next) {
                    initialChatRef.current = null
                }
            } catch (err) {
                if (!cancelled) {
                    setError(errText(err))
                }
            }
        }

        void loadByBranch()
        return () => {
            cancelled = true
        }
    }, [branch, loadChats])

    useEffect(() => {
        if (!selectedChatId || !branch) return
        const chatId = selectedChatId
        let cancelled = false

        async function syncSelectedChat() {
            setLoadingMessages(true)
            setError(null)
            try {
                await ensureChat(chatId, branch)
                await loadMessages(chatId)
            } catch (err) {
                if (!cancelled) {
                    setMessages([])
                    setError(errText(err))
                }
            } finally {
                if (!cancelled) {
                    setLoadingMessages(false)
                }
            }
        }

        void syncSelectedChat()
        return () => {
            cancelled = true
        }
    }, [branch, ensureChat, loadMessages, selectedChatId])

    useEffect(() => {
        if (!selectedChatId) return
        void loadChatToolConfig(selectedChatId)
        void loadChatLlmProfile(selectedChatId)
    }, [loadChatLlmProfile, loadChatToolConfig, selectedChatId])

    useEffect(() => {
        scrollToBottom()
    }, [messages, sending, loadingMessages, scrollToBottom])

    useEffect(() => {
        if (!selectedChatId || !branch) return
        syncUrl(selectedChatId, branch)
        saveLastChat({
            projectId,
            branch,
            chatId: selectedChatId,
            path: buildChatPath(projectId, branch, selectedChatId),
            ts: Date.now(),
        })
    }, [branch, projectId, selectedChatId, syncUrl])

    useEffect(() => {
        if (!browserLocalRepoMode) return
        void restoreLocalRepoSession(projectId)
    }, [browserLocalRepoMode, projectId])

    const onSelectChat = useCallback((chat: DrawerChat) => {
        setSelectedChatId(chat.chat_id)
    }, [])

    const onBranchChange = useCallback((nextBranch: string) => {
        setBranch(nextBranch)
        setMessages([])
        setSelectedChatId(null)
    }, [])

    const onNewChat = useCallback(async () => {
        const newChatId = makeChatId(projectId, branch, userId)
        setError(null)
        try {
            await ensureChat(newChatId, branch)
            await loadChats(branch, newChatId)
            setMessages([])
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, ensureChat, loadChats, projectId, userId])

    const toggleToolEnabled = useCallback((toolName: string) => {
        setToolEnabledSet((prev) => {
            const next = new Set(prev)
            if (next.has(toolName)) next.delete(toolName)
            else next.add(toolName)
            return next
        })
    }, [])

    const openToolDialog = useCallback(async () => {
        setToolsOpen(true)
        if (selectedChatId) {
            await loadChatToolConfig(selectedChatId)
        }
    }, [loadChatToolConfig, selectedChatId])

    const saveChatToolPolicy = useCallback(async () => {
        if (!selectedChatId) return
        setToolsSaving(true)
        setToolsError(null)
        try {
            const allNames = toolCatalog.map((t) => t.name)
            const enabled = Array.from(toolEnabledSet).filter((name) => allNames.includes(name)).sort((a, b) => a.localeCompare(b))
            const blocked = allNames.filter((name) => !toolEnabledSet.has(name)).sort((a, b) => a.localeCompare(b))

            const body: ChatToolPolicy = {
                allowed_tools: enabled,
                blocked_tools: blocked,
                read_only_only: toolReadOnlyOnly,
            }
            const out = await backendJson<ChatToolPolicyResponse>(
                `/api/chats/${encodeURIComponent(selectedChatId)}/tool-policy`,
                {
                    method: "PUT",
                    body: JSON.stringify(body),
                }
            )
            setChatToolPolicy(out.tool_policy || body)
            setDocsNotice(`Tool configuration saved for chat ${selectedChatId}.`)
        } catch (err) {
            setToolsError(errText(err))
        } finally {
            setToolsSaving(false)
        }
    }, [selectedChatId, toolCatalog, toolEnabledSet, toolReadOnlyOnly])

    const setToolApproval = useCallback(
        async (toolName: string, approve: boolean) => {
            if (!selectedChatId) return
            setApprovalBusyTool(toolName)
            setToolsError(null)
            try {
                if (approve) {
                    await backendJson(`/api/chats/${encodeURIComponent(selectedChatId)}/tool-approvals`, {
                        method: "POST",
                        body: JSON.stringify({
                            tool_name: toolName,
                            ttl_minutes: 60,
                            user: userId,
                        }),
                    })
                    setApprovedTools((prev) => {
                        const next = new Set(prev)
                        next.add(toolName)
                        return next
                    })
                } else {
                    await backendJson(
                        `/api/chats/${encodeURIComponent(selectedChatId)}/tool-approvals/${encodeURIComponent(toolName)}?user=${encodeURIComponent(userId)}`,
                        {
                            method: "DELETE",
                        }
                    )
                    setApprovedTools((prev) => {
                        const next = new Set(prev)
                        next.delete(toolName)
                        return next
                    })
                }
            } catch (err) {
                setToolsError(errText(err))
            } finally {
                setApprovalBusyTool(null)
            }
        },
        [selectedChatId, userId]
    )

    const maybeAutoGenerateDocsFromQuestion = useCallback(
        async (question: string) => {
            if (!browserLocalRepoMode) return
            if (!asksForDocumentationGeneration(question)) return

            if (!hasLocalRepoSnapshot(projectId)) {
                await restoreLocalRepoSession(projectId)
            }
            if (!hasLocalRepoSnapshot(projectId)) {
                throw new Error(
                    "Browser-local repository is not indexed in this session. Open Project Settings and pick the local repository folder first."
                )
            }
            if (!hasLocalRepoWriteCapability(projectId)) {
                await restoreLocalRepoSession(projectId)
            }
            if (!hasLocalRepoWriteCapability(projectId)) {
                throw new Error(
                    "Local repository write access is not available. Re-pick the repository folder in Project Settings to grant write access."
                )
            }
            const allowed = await ensureLocalRepoWritePermission(projectId)
            if (!allowed) {
                throw new Error("Write permission to local repository folder was denied.")
            }

            const localContext = buildLocalRepoDocumentationContext(projectId, branch)
            if (!localContext) {
                throw new Error("Could not build local repository context for documentation generation.")
            }

            const out = await backendJson<GenerateDocsResponse>(
                `/api/projects/${projectId}/documentation/generate-local`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        branch,
                        local_repo_root: localContext.repo_root,
                        local_repo_file_paths: localContext.file_paths,
                        local_repo_context: localContext.context,
                    }),
                }
            )
            const generated = out.files || []
            const writeRes = await writeLocalDocumentationFiles(projectId, generated)
            const mode = out.mode || "generated"
            const count = writeRes.written.length
            const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
            setDocsNotice(
                `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for local repo branch ${out.branch || branch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
            )
        },
        [branch, browserLocalRepoMode, projectId]
    )

    const send = useCallback(async () => {
        const q = input.trim()
        if (!q || sending || !selectedChatId) return

        setSending(true)
        setError(null)
        setLastToolEvents([])
        setInput("")
        setMessages((prev) => [...prev, { role: "user", content: q, ts: new Date().toISOString() }])

        try {
            let effectiveQuestion = q
            const repoPath = (project?.repo_path || "").trim()
            let localRepoContext: string | undefined
            if (isBrowserLocalRepoPath(repoPath)) {
                if (!hasLocalRepoSnapshot(projectId)) {
                    await restoreLocalRepoSession(projectId)
                }
                if (!hasLocalRepoSnapshot(projectId)) {
                    throw new Error(
                        "This project uses a browser-local repository. Open Project Settings and pick the local repo folder on this device first."
                    )
                }
                localRepoContext = buildFrontendLocalRepoContext(projectId, q, branch) || undefined

                if (asksForDocumentationGeneration(q)) {
                    await maybeAutoGenerateDocsFromQuestion(q)
                    effectiveQuestion = `${q}\n\nNote: documentation has already been generated in the browser-local repository for this branch.`
                }
            }

            const res = await backendJson<AskAgentResponse>("/api/ask_agent", {
                method: "POST",
                body: JSON.stringify({
                    project_id: projectId,
                    branch,
                    user: userId,
                    chat_id: selectedChatId,
                    top_k: 8,
                    question: effectiveQuestion,
                    local_repo_context: localRepoContext,
                    llm_profile_id: selectedLlmProfileId || null,
                }),
            })

            if (res.answer?.trim()) {
                setMessages((prev) => [
                    ...prev,
                    {
                        role: "assistant",
                        content: res.answer || "",
                        ts: new Date().toISOString(),
                        meta: { sources: res.sources || [], grounded: res.grounded ?? undefined },
                    },
                ])
            }
            setLastToolEvents(res.tool_events || [])
            setChatMemory((res.memory_summary as ChatMemorySummary) || null)

            await loadMessages(selectedChatId)
            await loadChats(branch, selectedChatId)
        } catch (err) {
            setError(errText(err))
        } finally {
            setSending(false)
        }
    }, [branch, input, loadChats, loadMessages, maybeAutoGenerateDocsFromQuestion, project?.repo_path, projectId, selectedChatId, selectedLlmProfileId, sending, userId])

    const clearChat = useCallback(async () => {
        if (!selectedChatId) return
        setError(null)
        try {
            await backendJson(`/api/chats/${encodeURIComponent(selectedChatId)}/clear`, { method: "POST" })
            await loadMessages(selectedChatId)
            await loadChats(branch, selectedChatId)
        } catch (err) {
            setError(errText(err))
        }
    }, [branch, loadChats, loadMessages, selectedChatId])

    const loadDocumentationFile = useCallback(
        async (path: string) => {
            setDocContentLoading(true)
            setDocsError(null)
            const ancestors = docAncestorFolders(path)
            if (ancestors.length) {
                setExpandedDocFolders((prev) => {
                    const next = new Set(prev)
                    for (const folder of ancestors) next.add(folder)
                    return Array.from(next)
                })
            }
            try {
                if (browserLocalRepoMode) {
                    const content = readLocalDocumentationFile(projectId, path)
                    if (content == null) {
                        throw new Error(`Documentation file not found in local repo: ${path}`)
                    }
                    setSelectedDocPath(path)
                    setSelectedDocContent(content)
                } else {
                    const doc = await backendJson<DocumentationFileResponse>(
                        `/api/projects/${projectId}/documentation/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
                    )
                    setSelectedDocPath(doc.path || path)
                    setSelectedDocContent(doc.content || "")
                }
            } catch (err) {
                setDocsError(errText(err))
            } finally {
                setDocContentLoading(false)
            }
        },
        [branch, browserLocalRepoMode, projectId]
    )

    const toggleDocFolder = useCallback((folderPath: string) => {
        setExpandedDocFolders((prev) => {
            const next = new Set(prev)
            if (next.has(folderPath)) {
                next.delete(folderPath)
            } else {
                next.add(folderPath)
            }
            return Array.from(next)
        })
    }, [])

    const renderDocTreeNodes = useCallback(
        (nodes: DocTreeNode[], depth = 0) =>
            nodes.map((node) => {
                if (node.kind === "folder") {
                    const isOpen = expandedDocFolders.includes(node.path)
                    return (
                        <Fragment key={node.path}>
                            <ListItemButton
                                onClick={() => toggleDocFolder(node.path)}
                                sx={{ pl: 1 + depth * 1.6 }}
                            >
                                {isOpen ? (
                                    <ExpandMoreRounded fontSize="small" color="action" />
                                ) : (
                                    <ChevronRightRounded fontSize="small" color="action" />
                                )}
                                <FolderRounded fontSize="small" color="action" sx={{ ml: 0.35, mr: 0.8 }} />
                                <ListItemText
                                    primary={node.name}
                                    primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
                                />
                            </ListItemButton>
                            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                                <List dense disablePadding>
                                    {renderDocTreeNodes(node.children || [], depth + 1)}
                                </List>
                            </Collapse>
                        </Fragment>
                    )
                }

                const file = node.file
                if (!file) return null
                const selected = selectedDocPath === file.path
                return (
                    <ListItemButton
                        key={file.path}
                        selected={selected}
                        onClick={() => void loadDocumentationFile(file.path)}
                        sx={{ pl: 3.4 + depth * 1.6 }}
                    >
                        <DescriptionOutlined fontSize="small" color={selected ? "primary" : "action"} sx={{ mr: 0.9 }} />
                        <ListItemText
                            primary={node.name}
                            secondary={file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : undefined}
                            primaryTypographyProps={{ noWrap: true }}
                            secondaryTypographyProps={{ noWrap: true }}
                        />
                    </ListItemButton>
                )
            }),
        [expandedDocFolders, loadDocumentationFile, selectedDocPath, toggleDocFolder]
    )

    const loadDocumentationList = useCallback(
        async (preferredPath?: string | null) => {
            setDocsLoading(true)
            setDocsError(null)
            try {
                const files = browserLocalRepoMode
                    ? listLocalDocumentationFiles(projectId)
                    : (
                        (await backendJson<DocumentationListResponse>(
                            `/api/projects/${projectId}/documentation?branch=${encodeURIComponent(branch)}`
                        )).files || []
                    )
                        .filter((f) => !!f.path)
                        .sort((a, b) => a.path.localeCompare(b.path))
                setDocsFiles(files)
                const target = (preferredPath && files.find((f) => f.path === preferredPath)?.path) || files[0]?.path || null
                setSelectedDocPath(target)
                setExpandedDocFolders((prev) => {
                    const next = new Set(prev)
                    if (!next.size) {
                        for (const f of files) {
                            const ancestors = docAncestorFolders(f.path)
                            if (ancestors[0]) next.add(ancestors[0])
                        }
                    }
                    if (target) {
                        for (const ancestor of docAncestorFolders(target)) next.add(ancestor)
                    }
                    return Array.from(next)
                })
                if (target) {
                    await loadDocumentationFile(target)
                } else {
                    setSelectedDocContent("")
                }
            } catch (err) {
                setDocsFiles([])
                setSelectedDocPath(null)
                setSelectedDocContent("")
                setDocsError(errText(err))
            } finally {
                setDocsLoading(false)
            }
        },
        [branch, browserLocalRepoMode, loadDocumentationFile, projectId]
    )

    const openDocumentationViewer = useCallback(() => {
        setDocsOpen(true)
        void loadDocumentationList(selectedDocPath)
    }, [loadDocumentationList, selectedDocPath])

    const handleAnswerSourceClick = useCallback(
        async (src: ChatAnswerSource) => {
            const rawUrl = String(src.url || "").trim()
            if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
                window.open(rawUrl, "_blank", "noopener,noreferrer")
                return
            }

            const path = String(src.path || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "")
            if (isDocumentationPath(path)) {
                setDocsOpen(true)
                await loadDocumentationList(path)
            }
        },
        [loadDocumentationList]
    )

    const generateDocumentation = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) {
            setDocsOpen(true)
            setError(null)
        }
        setDocsGenerating(true)
        setDocsError(null)
        setDocsNotice(null)
        try {
            if (browserLocalRepoMode) {
                if (!hasLocalRepoSnapshot(projectId)) {
                    await restoreLocalRepoSession(projectId)
                }
                if (!hasLocalRepoSnapshot(projectId)) {
                    throw new Error(
                        "Browser-local repository is not indexed in this session. Open Project Settings and pick the local repository folder first."
                    )
                }
                if (!hasLocalRepoWriteCapability(projectId)) {
                    await restoreLocalRepoSession(projectId)
                }
                if (!hasLocalRepoWriteCapability(projectId)) {
                    throw new Error(
                        "Local repository write access is not available. Re-pick the repository folder in Project Settings to grant write access."
                    )
                }
                const allowed = await ensureLocalRepoWritePermission(projectId)
                if (!allowed) {
                    throw new Error("Write permission to local repository folder was denied.")
                }

                const localContext = buildLocalRepoDocumentationContext(projectId, branch)
                if (!localContext) {
                    throw new Error("Could not build local repository context for documentation generation.")
                }

                const out = await backendJson<GenerateDocsResponse>(
                    `/api/projects/${projectId}/documentation/generate-local`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            branch,
                            local_repo_root: localContext.repo_root,
                            local_repo_file_paths: localContext.file_paths,
                            local_repo_context: localContext.context,
                        }),
                    }
                )

                const generated = out.files || []
                const writeRes = await writeLocalDocumentationFiles(projectId, generated)
                const mode = out.mode || "generated"
                const count = writeRes.written.length
                const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
                setDocsNotice(
                    `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for local repo branch ${out.branch || branch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
                )
            } else {
                const out = await backendJson<GenerateDocsResponse>(`/api/projects/${projectId}/documentation/generate`, {
                    method: "POST",
                    body: JSON.stringify({ branch }),
                })
                const mode = out.mode || "generated"
                const count = out.files_written?.length || 0
                const info = [out.summary, out.llm_error].filter(Boolean).join(" ")
                setDocsNotice(
                    `Documentation ${mode === "llm" ? "generated with LLM" : "generated"} for branch ${out.branch || branch}. Files updated: ${count}.${info ? ` ${info}` : ""}`
                )
            }

            await loadDocumentationList()
        } catch (err) {
            const msg = errText(err)
            setDocsError(msg)
            if (!opts?.silent) {
                setError(`Documentation generation failed: ${msg}`)
            }
        } finally {
            setDocsGenerating(false)
        }
    }, [branch, browserLocalRepoMode, loadDocumentationList, projectId])

    return (
        <ProjectDrawerLayout
            projectId={projectId}
            projectLabel={projectLabel}
            branch={branch}
            branches={branches}
            onBranchChange={onBranchChange}
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={onSelectChat}
            onNewChat={onNewChat}
            user={me}
            loadingChats={loadingChats}
            activeSection="chat"
        >
            <Stack sx={{ minHeight: 0, flex: 1 }}>
                <Paper
                    square
                    elevation={0}
                    sx={{
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        px: { xs: 1.5, md: 3 },
                        py: { xs: 1.25, md: 1.8 },
                    }}
                >
                    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.15em" }}>
                        RAG Conversation
                    </Typography>
                    <Typography variant="h6" sx={{ mt: 0.2, fontWeight: 700, fontSize: { xs: "1.02rem", sm: "1.2rem" } }}>
                        {projectLabel}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Branch: {branch} ·{" "}
                        {selectedLlmProfile
                            ? `${selectedLlmProfile.name} (${selectedLlmProfile.provider.toUpperCase()} · ${selectedLlmProfile.model})`
                            : `${(project?.llm_provider || "default LLM").toUpperCase()}${project?.llm_model ? ` · ${project.llm_model}` : ""}`}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
                        <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 360 } }}>
                            <InputLabel id="chat-llm-profile-label">Chat LLM Profile</InputLabel>
                            <Select
                                labelId="chat-llm-profile-label"
                                label="Chat LLM Profile"
                                value={selectedLlmProfileId}
                                onChange={(e) => {
                                    const next = e.target.value
                                    setSelectedLlmProfileId(next)
                                    if (selectedChatId) {
                                        void saveChatLlmProfile(selectedChatId, next)
                                    }
                                }}
                                disabled={savingLlmProfile || !selectedChatId}
                            >
                                <MenuItem value="">Project default</MenuItem>
                                {llmProfiles.map((profile) => (
                                    <MenuItem key={profile.id} value={profile.id}>
                                        {profile.name} · {profile.provider.toUpperCase()} · {profile.model}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ mt: 1.2 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<BuildRounded />}
                            onClick={() => void openToolDialog()}
                            disabled={!selectedChatId}
                        >
                            Tools ({enabledToolCount})
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<DescriptionRounded />}
                            onClick={openDocumentationViewer}
                        >
                            Open Docs
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<AutoFixHighRounded />}
                            onClick={() => void generateDocumentation()}
                            disabled={docsGenerating || booting}
                        >
                            {docsGenerating ? "Generating..." : "Generate Docs"}
                        </Button>
                    </Stack>
                </Paper>

                {error && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    </Box>
                )}
                {!!lastToolEvents?.length && !toolEventsDismissed && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Paper variant="outlined" sx={{ p: 1.2 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                    TOOL EXECUTION
                                </Typography>
                                <IconButton size="small" onClick={() => setToolEventsDismissed(true)}>
                                    <CloseRounded fontSize="small" />
                                </IconButton>
                            </Stack>
                            <Stack spacing={0.45} sx={{ mt: 0.8 }}>
                                {lastToolEvents.map((ev, idx) => (
                                    <Typography key={`${ev.tool}-${idx}`} variant="body2" color={ev.ok ? "success.main" : "warning.main"}>
                                        {ev.ok ? "OK" : "ERR"} · {ev.tool} · {ev.duration_ms} ms
                                        {ev.cached ? " · cached" : ""}
                                        {ev.attempts && ev.attempts > 1 ? ` · attempts:${ev.attempts}` : ""}
                                        {ev.error?.code ? ` · ${ev.error.code}` : ""}
                                        {ev.error?.message ? ` · ${ev.error.message}` : ""}
                                    </Typography>
                                ))}
                            </Stack>
                        </Paper>
                    </Box>
                )}
                {docsNotice && !docsOpen && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Alert severity="success" onClose={() => setDocsNotice(null)}>
                            {docsNotice}
                        </Alert>
                    </Box>
                )}
                {memoryHasItems && (
                    <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 1.25 }}>
                        <Paper variant="outlined" sx={{ p: { xs: 1.2, md: 1.5 }, maxWidth: 980, mx: "auto" }}>
                            <Typography variant="overline" color="primary" sx={{ letterSpacing: "0.12em" }}>
                                Session Memory
                            </Typography>
                            <Box
                                sx={{
                                    mt: 0.8,
                                    display: "grid",
                                    gap: 1.2,
                                    gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                                }}
                            >
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                        Decisions
                                    </Typography>
                                    {(chatMemory?.decisions || []).slice(0, 5).map((item, idx) => (
                                        <Typography key={`mem-d-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                            - {item}
                                        </Typography>
                                    ))}
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                        Open Questions
                                    </Typography>
                                    {(chatMemory?.open_questions || []).slice(0, 5).map((item, idx) => (
                                        <Typography key={`mem-q-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                            - {item}
                                        </Typography>
                                    ))}
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
                                        Next Steps
                                    </Typography>
                                    {(chatMemory?.next_steps || []).slice(0, 5).map((item, idx) => (
                                        <Typography key={`mem-n-${idx}`} variant="body2" sx={{ mt: 0.4 }}>
                                            - {item}
                                        </Typography>
                                    ))}
                                </Box>
                            </Box>
                        </Paper>
                    </Box>
                )}

                <Box
                    ref={scrollRef}
                    sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 1.25, md: 4 }, py: { xs: 1.6, md: 2.5 } }}
                >
                    <Stack spacing={1.5} sx={{ maxWidth: 980, mx: "auto" }}>
                        {booting && (
                            <Paper variant="outlined" sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.2 }}>
                                <CircularProgress size={18} />
                                <Typography variant="body2">Loading workspace...</Typography>
                            </Paper>
                        )}

                        {!booting && !loadingMessages && messages.length === 0 && (
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                <Typography variant="body2" color="text.secondary">
                                    Start with a question about this project. The assistant can use GitHub/Bitbucket/Azure DevOps, local repository, Confluence, and Jira context.
                                </Typography>
                            </Paper>
                        )}

                        {messages.map((m, idx) => {
                            const isUser = m.role === "user"
                            const sources = !isUser && m.role === "assistant" ? (m.meta?.sources || []) : []
                            const messageKey = `${m.ts || "na"}-${idx}`
                            const sourceExpanded = Boolean(expandedSourceMessages[messageKey])
                            const hasManySources = sources.length > SOURCE_PREVIEW_LIMIT
                            const previewSources = hasManySources ? sources.slice(0, SOURCE_PREVIEW_LIMIT) : sources
                            const hiddenSources = hasManySources ? sources.slice(SOURCE_PREVIEW_LIMIT) : []
                            return (
                                <Box key={messageKey} sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                                    <Paper
                                        variant={isUser ? "elevation" : "outlined"}
                                        elevation={isUser ? 3 : 0}
                                        sx={{
                                            maxWidth: { xs: "96%", sm: "92%" },
                                            px: { xs: 1.5, sm: 2 },
                                            py: { xs: 1.1, sm: 1.4 },
                                            borderRadius: 3,
                                            bgcolor: isUser ? "primary.main" : "background.paper",
                                            color: isUser ? "primary.contrastText" : "text.primary",
                                        }}
                                    >
                                        <Stack spacing={1}>
                                            {splitChartBlocks(m.content || "").map((part, i) => {
                                                if (part.type === "chart") {
                                                    const spec = parseChartSpec(part.value)
                                                    return (
                                                        <Paper key={i} variant="outlined" sx={{ p: 1.2, bgcolor: "rgba(0,0,0,0.16)" }}>
                                                            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.12em" }}>
                                                                CHART BLOCK
                                                            </Typography>
                                                            {spec ? (
                                                                <Box sx={{ mt: 1.1, width: "100%", minWidth: 280 }}>
                                                                    {spec.title && (
                                                                        <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                                                                            {spec.title}
                                                                        </Typography>
                                                                    )}
                                                                    <ResponsiveContainer width="100%" height={spec.height || 280}>
                                                                        {spec.type === "bar" ? (
                                                                            <BarChart data={spec.data}>
                                                                                <CartesianGrid strokeDasharray="3 3" />
                                                                                <XAxis dataKey={spec.xKey} />
                                                                                <YAxis />
                                                                                <Tooltip />
                                                                                <Legend />
                                                                                {spec.series.map((s, sidx) => (
                                                                                    <Bar
                                                                                        key={s.key}
                                                                                        dataKey={s.key}
                                                                                        name={s.label || s.key}
                                                                                        fill={s.color || ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][sidx % 4]}
                                                                                    />
                                                                                ))}
                                                                            </BarChart>
                                                                        ) : (
                                                                            <LineChart data={spec.data}>
                                                                                <CartesianGrid strokeDasharray="3 3" />
                                                                                <XAxis dataKey={spec.xKey} />
                                                                                <YAxis />
                                                                                <Tooltip />
                                                                                <Legend />
                                                                                {spec.series.map((s, sidx) => (
                                                                                    <Line
                                                                                        key={s.key}
                                                                                        type="monotone"
                                                                                        dataKey={s.key}
                                                                                        name={s.label || s.key}
                                                                                        stroke={s.color || ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][sidx % 4]}
                                                                                        strokeWidth={2}
                                                                                        dot={false}
                                                                                    />
                                                                                ))}
                                                                            </LineChart>
                                                                        )}
                                                                    </ResponsiveContainer>
                                                                </Box>
                                                            ) : (
                                                                <Box
                                                                    component="pre"
                                                                    sx={{
                                                                        mt: 0.8,
                                                                        mb: 0,
                                                                        overflowX: "auto",
                                                                        whiteSpace: "pre",
                                                                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                                        fontSize: 12,
                                                                    }}
                                                                >
                                                                    {part.value}
                                                                </Box>
                                                            )}
                                                        </Paper>
                                                    )
                                                }

                                                return (
                                                    <Box
                                                        key={i}
                                                        sx={{
                                                            "& p": { my: 0.7, lineHeight: 1.55 },
                                                            "& ul, & ol": { my: 0.7, pl: 2.5 },
                                                            "& li": { my: 0.3 },
                                                            "& a": { color: "inherit", textDecoration: "underline" },
                                                            "& img": {
                                                                maxWidth: "100%",
                                                                borderRadius: 1.5,
                                                                display: "block",
                                                                my: 1,
                                                            },
                                                            "& code": {
                                                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                                fontSize: "0.82em",
                                                                bgcolor: isUser ? "rgba(255,255,255,0.2)" : "action.hover",
                                                                px: 0.5,
                                                                borderRadius: 0.6,
                                                            },
                                                            "& pre": {
                                                                my: 1,
                                                                overflowX: "auto",
                                                                borderRadius: 1.2,
                                                                p: 1.1,
                                                                bgcolor: isUser ? "rgba(0,0,0,0.22)" : "rgba(2,6,23,0.06)",
                                                            },
                                                            "& pre code": {
                                                                display: "block",
                                                                whiteSpace: "pre",
                                                            },
                                                        }}
                                                    >
                                                        <ReactMarkdown
                                                            remarkPlugins={[remarkGfm]}
                                                            components={{
                                                                code(props: any) {
                                                                    const { inline, className, children, ...rest } = props
                                                                    const content = String(children ?? "")
                                                                    if (inline) {
                                                                        return (
                                                                            <code className={className} {...rest}>
                                                                                {children}
                                                                            </code>
                                                                        )
                                                                    }

                                                                    const match = /language-([a-zA-Z0-9_-]+)/.exec(className || "")
                                                                    const language = normalizeLanguage(match?.[1] || "")
                                                                    const tokens = tokenizeCode(content.replace(/\n$/, ""), language)
                                                                    return (
                                                                        <code className={className} {...rest}>
                                                                            {tokens.map((t, tidx) => (
                                                                                <span key={tidx} style={{ color: tokenColor(t.kind, isUser) }}>
                                                                                    {t.text}
                                                                                </span>
                                                                            ))}
                                                                        </code>
                                                                    )
                                                                },
                                                            }}
                                                        >
                                                            {part.value}
                                                        </ReactMarkdown>
                                                    </Box>
                                                )
                                            })}

                                            {!isUser && m.role === "assistant" && (
                                                <Box
                                                    sx={{
                                                        mt: 0.4,
                                                        pt: 0.9,
                                                        borderTop: "1px solid",
                                                        borderColor: "divider",
                                                    }}
                                                >
                                                    <Typography
                                                        variant="caption"
                                                        color="text.secondary"
                                                        sx={{ letterSpacing: "0.08em", display: "block", mb: 0.6 }}
                                                    >
                                                        SOURCES
                                                    </Typography>
                                                    {m.meta?.grounded === false && (
                                                        <Typography variant="caption" color="warning.main" sx={{ display: "block", mb: 0.6 }}>
                                                            Grounding check failed for this answer.
                                                        </Typography>
                                                    )}
                                                    <Stack spacing={0.2}>
                                                        {sources.length > 0 ? (
                                                            previewSources.map((src, sidx) => {
                                                                const clickable = Boolean(
                                                                    (src.url && /^https?:\/\//i.test(src.url)) ||
                                                                    isDocumentationPath(src.path)
                                                                )
                                                                const confidence =
                                                                    typeof src.confidence === "number"
                                                                        ? Math.max(0, Math.min(100, Math.round(src.confidence * 100)))
                                                                        : null
                                                                return (
                                                                    <Box key={`${sourceDisplayText(src)}-${sidx}`} sx={{ py: 0.2 }}>
                                                                        <Button
                                                                            variant="text"
                                                                            size="small"
                                                                            onClick={() => {
                                                                                void handleAnswerSourceClick(src)
                                                                            }}
                                                                            disabled={!clickable}
                                                                            sx={{
                                                                                justifyContent: "flex-start",
                                                                                textTransform: "none",
                                                                                px: 0,
                                                                                minHeight: "auto",
                                                                                fontSize: 12,
                                                                                lineHeight: 1.35,
                                                                            }}
                                                                        >
                                                                            {sourceDisplayText(src)}
                                                                            {confidence !== null ? ` (${confidence}%)` : ""}
                                                                        </Button>
                                                                        {src.snippet ? (
                                                                            <Typography
                                                                                variant="caption"
                                                                                color="text.secondary"
                                                                                sx={{ display: "block", lineHeight: 1.3, pl: 0.1 }}
                                                                            >
                                                                                {src.snippet}
                                                                            </Typography>
                                                                        ) : null}
                                                                    </Box>
                                                                )
                                                            })
                                                        ) : (
                                                            <Typography variant="caption" color="text.secondary">
                                                                No explicit sources were captured for this answer.
                                                            </Typography>
                                                        )}
                                                        {hasManySources && (
                                                            <>
                                                                <Collapse in={sourceExpanded} timeout="auto" unmountOnExit>
                                                                    <Stack spacing={0.2}>
                                                                        {hiddenSources.map((src, sidx) => {
                                                                            const clickable = Boolean(
                                                                                (src.url && /^https?:\/\//i.test(src.url)) ||
                                                                                isDocumentationPath(src.path)
                                                                            )
                                                                            const confidence =
                                                                                typeof src.confidence === "number"
                                                                                    ? Math.max(0, Math.min(100, Math.round(src.confidence * 100)))
                                                                                    : null
                                                                            return (
                                                                                <Box key={`${sourceDisplayText(src)}-hidden-${sidx}`} sx={{ py: 0.2 }}>
                                                                                    <Button
                                                                                        variant="text"
                                                                                        size="small"
                                                                                        onClick={() => {
                                                                                            void handleAnswerSourceClick(src)
                                                                                        }}
                                                                                        disabled={!clickable}
                                                                                        sx={{
                                                                                            justifyContent: "flex-start",
                                                                                            textTransform: "none",
                                                                                            px: 0,
                                                                                            minHeight: "auto",
                                                                                            fontSize: 12,
                                                                                            lineHeight: 1.35,
                                                                                        }}
                                                                                    >
                                                                                        {sourceDisplayText(src)}
                                                                                        {confidence !== null ? ` (${confidence}%)` : ""}
                                                                                    </Button>
                                                                                    {src.snippet ? (
                                                                                        <Typography
                                                                                            variant="caption"
                                                                                            color="text.secondary"
                                                                                            sx={{ display: "block", lineHeight: 1.3, pl: 0.1 }}
                                                                                        >
                                                                                            {src.snippet}
                                                                                        </Typography>
                                                                                    ) : null}
                                                                                </Box>
                                                                            )
                                                                        })}
                                                                    </Stack>
                                                                </Collapse>
                                                                <Button
                                                                    variant="text"
                                                                    size="small"
                                                                    onClick={() => toggleSourceList(messageKey)}
                                                                    endIcon={sourceExpanded ? <ExpandMoreRounded fontSize="small" /> : <ChevronRightRounded fontSize="small" />}
                                                                    sx={{
                                                                        justifyContent: "flex-start",
                                                                        textTransform: "none",
                                                                        px: 0,
                                                                        minHeight: "auto",
                                                                        mt: 0.2,
                                                                        fontSize: 12,
                                                                        lineHeight: 1.35,
                                                                    }}
                                                                >
                                                                    {sourceExpanded
                                                                        ? `Show less (${sources.length} total)`
                                                                        : `Show ${hiddenSources.length} more (${sources.length} total)`}
                                                                </Button>
                                                            </>
                                                        )}
                                                    </Stack>
                                                </Box>
                                            )}
                                        </Stack>
                                    </Paper>
                                </Box>
                            )
                        })}

                        {(sending || loadingMessages) && (
                            <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                                <Paper variant="outlined" sx={{ px: 1.6, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                                    <CircularProgress size={16} />
                                    <Typography variant="body2" color="text.secondary">
                                        Thinking...
                                    </Typography>
                                </Paper>
                            </Box>
                        )}
                    </Stack>
                </Box>

                <Paper
                    square
                    elevation={0}
                    sx={{
                        borderTop: "1px solid",
                        borderColor: "divider",
                        px: { xs: 1.25, md: 3 },
                        pt: { xs: 1.25, md: 1.8 },
                        pb: "calc(10px + env(safe-area-inset-bottom, 0px))",
                    }}
                >
                    <Stack sx={{ maxWidth: 980, mx: "auto" }} spacing={1.2}>
                        <TextField
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault()
                                    void send()
                                }
                            }}
                            multiline
                            minRows={1}
                            maxRows={6}
                            fullWidth
                            placeholder="Ask a project question (Enter to send, Shift+Enter for newline)"
                            disabled={!selectedChatId || sending}
                            InputProps={{
                                sx: {
                                    fontSize: { xs: 14, sm: 15 },
                                },
                            }}
                        />

                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                                variant="outlined"
                                startIcon={<ClearAllRounded />}
                                onClick={() => void clearChat()}
                                disabled={!selectedChatId || sending}
                                sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                            >
                                Clear
                            </Button>
                            <Button
                                variant="contained"
                                endIcon={<SendRounded />}
                                onClick={() => void send()}
                                disabled={sending || !input.trim() || !selectedChatId}
                                sx={{ flex: { xs: 1, sm: "0 0 auto" } }}
                            >
                                Send
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>

                <Dialog
                    open={toolsOpen}
                    onClose={() => setToolsOpen(false)}
                    fullWidth
                    maxWidth="md"
                >
                    <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                        <Stack spacing={0.2}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                Chat Tool Configuration
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Chat: <code>{selectedChatId || "none"}</code>
                            </Typography>
                        </Stack>
                    </DialogTitle>
                    <DialogContent dividers sx={{ pt: 1.2 }}>
                        {toolsLoading && (
                            <Box sx={{ py: 2 }}>
                                <CircularProgress size={18} />
                            </Box>
                        )}
                        {toolsError && (
                            <Box sx={{ pb: 1.2 }}>
                                <Alert severity="error" onClose={() => setToolsError(null)}>
                                    {toolsError}
                                </Alert>
                            </Box>
                        )}
                        <Stack spacing={1.2}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={toolReadOnlyOnly}
                                        onChange={(e) => setToolReadOnlyOnly(e.target.checked)}
                                    />
                                }
                                label="Read-only mode (disable all write/mutating tools)"
                            />
                            <Divider />
                            <List dense>
                                {toolCatalog.map((tool) => {
                                    const enabled = toolEnabledSet.has(tool.name)
                                    const requiresApproval = Boolean(tool.require_approval) && !Boolean(tool.read_only)
                                    const isApproved = approvedTools.has(tool.name)
                                    return (
                                        <ListItemButton key={tool.name} onClick={() => toggleToolEnabled(tool.name)} sx={{ borderRadius: 1.5, mb: 0.35 }}>
                                            <ListItemIcon sx={{ minWidth: 34 }}>
                                                <Switch
                                                    size="small"
                                                    checked={enabled}
                                                    onChange={() => toggleToolEnabled(tool.name)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                            {tool.name}
                                                        </Typography>
                                                        {enabled && <CheckCircleRounded fontSize="inherit" color="success" />}
                                                        {tool.origin === "custom" && (
                                                            <Chip size="small" label="Custom" color="secondary" variant="outlined" />
                                                        )}
                                                        {tool.runtime === "local_typescript" && (
                                                            <Chip size="small" label="Local TS" color="secondary" variant="outlined" />
                                                        )}
                                                        {requiresApproval && (
                                                            <Chip
                                                                size="small"
                                                                label={isApproved ? "Approved" : "Approval required"}
                                                                color={isApproved ? "success" : "warning"}
                                                                variant={isApproved ? "filled" : "outlined"}
                                                            />
                                                        )}
                                                        {requiresApproval && (
                                                            <Button
                                                                size="small"
                                                                variant="text"
                                                                onClick={(e) => {
                                                                    e.preventDefault()
                                                                    e.stopPropagation()
                                                                    void setToolApproval(tool.name, !isApproved)
                                                                }}
                                                                disabled={approvalBusyTool === tool.name}
                                                            >
                                                                {approvalBusyTool === tool.name
                                                                    ? "..."
                                                                    : isApproved
                                                                        ? "Revoke"
                                                                        : "Approve 60m"}
                                                            </Button>
                                                        )}
                                                    </Stack>
                                                }
                                                secondary={`${tool.description || ""}${tool.read_only ? " · read-only" : " · write-enabled"}${tool.version ? ` · v${tool.version}` : ""}`}
                                            />
                                        </ListItemButton>
                                    )
                                })}
                                {!toolCatalog.length && !toolsLoading && (
                                    <ListItemButton disabled>
                                        <ListItemText primary="No tools found." />
                                    </ListItemButton>
                                )}
                            </List>
                        </Stack>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setToolsOpen(false)}>Close</Button>
                        <Button variant="contained" onClick={() => void saveChatToolPolicy()} disabled={toolsSaving || !selectedChatId}>
                            {toolsSaving ? "Saving..." : "Save"}
                        </Button>
                    </DialogActions>
                </Dialog>

                <Dialog
                    open={docsOpen}
                    onClose={() => setDocsOpen(false)}
                    fullWidth
                    maxWidth="lg"
                >
                    <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                        <Stack spacing={0.2}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                Project Documentation
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Branch: {branch} · Source folder: <code>documentation/</code>
                            </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1}>
                            <Button
                                size="small"
                                variant="contained"
                                startIcon={<AutoFixHighRounded />}
                                onClick={() => void generateDocumentation()}
                                disabled={docsGenerating}
                            >
                                {docsGenerating ? "Generating..." : "Regenerate"}
                            </Button>
                            <Button
                                size="small"
                                variant="text"
                                startIcon={<CloseRounded />}
                                onClick={() => setDocsOpen(false)}
                            >
                                Close
                            </Button>
                        </Stack>
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 0 }}>
                        {(docsLoading || docContentLoading) && (
                            <Box sx={{ px: 2, py: 1 }}>
                                <CircularProgress size={18} />
                            </Box>
                        )}
                        {docsError && (
                            <Box sx={{ p: 1.5 }}>
                                <Alert severity="error" onClose={() => setDocsError(null)}>
                                    {docsError}
                                </Alert>
                            </Box>
                        )}
                        {docsNotice && docsOpen && (
                            <Box sx={{ p: 1.5 }}>
                                <Alert severity="success" onClose={() => setDocsNotice(null)}>
                                    {docsNotice}
                                </Alert>
                            </Box>
                        )}

                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px 1fr" }, minHeight: 500 }}>
                            <Box sx={{ borderRight: { md: "1px solid" }, borderColor: "divider", bgcolor: "background.default" }}>
                                <List dense sx={{ maxHeight: 560, overflowY: "auto" }}>
                                    {renderDocTreeNodes(docsTree)}
                                    {!docsFiles.length && !docsLoading && (
                                        <ListItemButton disabled>
                                            <ListItemText primary="No documentation files found." />
                                        </ListItemButton>
                                    )}
                                </List>
                            </Box>

                            <Box sx={{ p: { xs: 1.5, md: 2.2 }, overflowY: "auto", maxHeight: 560 }}>
                                {selectedDocPath ? (
                                    <Stack spacing={1.4}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            {selectedDocPath}
                                        </Typography>
                                        <Divider />
                                        <Box
                                            sx={{
                                                "& h1, & h2, & h3": { mt: 2, mb: 1 },
                                                "& p, & li": { fontSize: "0.93rem" },
                                                "& code": {
                                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                    bgcolor: "action.hover",
                                                    px: 0.5,
                                                    borderRadius: 0.6,
                                                },
                                                "& pre code": {
                                                    display: "block",
                                                    p: 1.2,
                                                    overflowX: "auto",
                                                },
                                            }}
                                        >
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {selectedDocContent || "_No content._"}
                                            </ReactMarkdown>
                                        </Box>
                                    </Stack>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">
                                        Generate documentation or select a file to preview.
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    </DialogContent>
                </Dialog>
            </Stack>
        </ProjectDrawerLayout>
    )
}
