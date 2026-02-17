"use client"

import Link from "next/link"
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Container,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Tooltip,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import PublishRounded from "@mui/icons-material/PublishRounded"
import ScienceRounded from "@mui/icons-material/ScienceRounded"
import AddRounded from "@mui/icons-material/AddRounded"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import UploadFileRounded from "@mui/icons-material/UploadFileRounded"
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import { backendJson } from "@/lib/backend"
import { executeLocalToolJob, type LocalToolJobPayload } from "@/lib/local-custom-tool-runner"

type ProjectRow = {
    id: string
    key: string
    name: string
}

type CustomToolRow = {
    id: string
    projectId?: string | null
    name: string
    slug: string
    description?: string
    runtime: "backend_python" | "local_typescript"
    isEnabled: boolean
    readOnly: boolean
    requireApproval: boolean
    timeoutSec: number
    rateLimitPerMin: number
    maxRetries: number
    cacheTtlSec: number
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    tags?: string[]
    latestVersion: number
    publishedVersion?: number | null
}

type ToolVersionRow = {
    id: string
    toolId: string
    version: number
    status: "draft" | "published" | "archived"
    checksum: string
    changelog?: string
    code?: string
    createdAt?: string
}

type SystemToolRow = {
    id: string
    projectId?: string | null
    name: string
    description?: string
    isEnabled: boolean
    readOnly: boolean
    timeoutSec: number
    rateLimitPerMin: number
    maxRetries: number
    cacheTtlSec: number
    requireApproval: boolean
}

type ToolDetailResponse = {
    tool: CustomToolRow & { secrets?: Record<string, string> }
    versions: ToolVersionRow[]
}

type ToolForm = {
    id?: string
    projectId: string
    name: string
    description: string
    runtime: "backend_python" | "local_typescript"
    isEnabled: boolean
    readOnly: boolean
    requireApproval: boolean
    timeoutSec: number
    rateLimitPerMin: number
    maxRetries: number
    cacheTtlSec: number
    inputSchemaText: string
    outputSchemaText: string
    secretsText: string
    tagsText: string
    codeText: string
}

type LocalToolClaimResponse = {
    job: LocalToolJobPayload | null
}

const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": true
}`

type ToolTemplate = {
    id: string
    runtime: "backend_python" | "local_typescript"
    name: string
    description: string
    code: string
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    testArgs?: Record<string, unknown>
}

const TOOL_TEMPLATES: ToolTemplate[] = [
    {
        id: "py-echo",
        runtime: "backend_python",
        name: "Python: Echo + Metadata",
        description: "Safe starter template that echoes args and core chat/project metadata.",
        inputSchema: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
            additionalProperties: true,
        },
        outputSchema: {
            type: "object",
            properties: {
                ok: { type: "boolean" },
                echo: { type: "object" },
                meta: { type: "object" },
            },
            additionalProperties: true,
        },
        testArgs: { message: "hello from custom tool" },
        code: `def run(args, context):
    return {
        "ok": True,
        "echo": args,
        "meta": {
            "project_id": context.get("project_id"),
            "branch": context.get("branch"),
            "chat_id": context.get("chat_id"),
            "user_id": context.get("user_id"),
        },
    }
`,
    },
    {
        id: "py-http-get",
        runtime: "backend_python",
        name: "Python: HTTP GET JSON",
        description: "Fetches JSON from a URL and returns status + parsed payload snippet.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string" },
                timeout_sec: { type: "number" },
            },
            required: ["url"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            properties: {
                ok: { type: "boolean" },
                status: { type: "number" },
                data: {},
            },
            additionalProperties: true,
        },
        testArgs: { url: "https://httpbin.org/json", timeout_sec: 8 },
        code: `import json
from urllib.request import Request, urlopen


def run(args, context):
    url = str(args.get("url") or "").strip()
    if not url:
        raise ValueError("args.url is required")

    timeout_sec = float(args.get("timeout_sec") or 8)
    req = Request(url, headers={"User-Agent": "ProjectQaAssistant/1.0"})
    with urlopen(req, timeout=timeout_sec) as resp:
        status = int(getattr(resp, "status", 200))
        raw = resp.read().decode("utf-8", errors="replace")

    try:
        data = json.loads(raw)
    except Exception:
        data = {"raw": raw[:2000]}

    return {"ok": True, "status": status, "data": data}
`,
    },
    {
        id: "ts-local-grep",
        runtime: "local_typescript",
        name: "Local TS: Repo Grep",
        description: "Searches the browser-local repository snapshot with helper grep().",
        inputSchema: {
            type: "object",
            properties: {
                pattern: { type: "string" },
                glob: { type: "string" },
                maxResults: { type: "number" },
            },
            required: ["pattern"],
            additionalProperties: true,
        },
        outputSchema: {
            type: "object",
            properties: {
                ok: { type: "boolean" },
                total: { type: "number" },
                hits: { type: "array" },
            },
            additionalProperties: true,
        },
        testArgs: { pattern: "TODO", glob: "src/*", maxResults: 20 },
        code: `async function run(args, context, helpers) {
  const pattern = String(args?.pattern || "").trim();
  if (!pattern) throw new Error("args.pattern is required");

  const hits = helpers.localRepo.grep(pattern, {
    regex: args?.regex !== false,
    caseSensitive: !!args?.caseSensitive,
    glob: typeof args?.glob === "string" ? args.glob : undefined,
    maxResults: Number(args?.maxResults || 60),
    contextLines: Number(args?.contextLines || 2),
  });

  return {
    ok: true,
    total: hits.length,
    hits,
    at: helpers.nowIso(),
  };
}
`,
    },
    {
        id: "ts-read-file",
        runtime: "local_typescript",
        name: "Local TS: Read File",
        description: "Reads one file from browser-local snapshot and returns content.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string" },
                maxChars: { type: "number" },
            },
            required: ["path"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            properties: {
                ok: { type: "boolean" },
                path: { type: "string" },
                content: { type: "string" },
            },
            additionalProperties: true,
        },
        testArgs: { path: "README.md", maxChars: 5000 },
        code: `async function run(args, context, helpers) {
  const path = String(args?.path || "").trim();
  if (!path) throw new Error("args.path is required");
  const maxChars = Math.max(200, Math.min(Number(args?.maxChars || 200000), 2000000));

  const content = helpers.localRepo.readFile(path, maxChars);
  return {
    ok: true,
    path,
    content,
    at: helpers.nowIso(),
  };
}
`,
    },
]

type TokenKind = "plain" | "keyword" | "string" | "number" | "comment" | "operator" | "builtin"
type Token = { kind: TokenKind; text: string }
type LangRule = { kind: TokenKind; re: RegExp }

function normalizeEditorLanguage(runtime: ToolForm["runtime"] | "json"): "python" | "typescript" | "json" {
    if (runtime === "backend_python") return "python"
    if (runtime === "local_typescript") return "typescript"
    return "json"
}

function editorKeywordRegex(words: string[]): RegExp {
    return new RegExp(`\\b(?:${words.join("|")})\\b`, "y")
}

function editorRulesForLanguage(language: "python" | "typescript" | "json"): LangRule[] {
    const common = {
        strings: [
            { kind: "string" as const, re: /"(?:\\.|[^"\\])*"/y },
            { kind: "string" as const, re: /'(?:\\.|[^'\\])*'/y },
            { kind: "string" as const, re: /`(?:\\.|[^`\\])*`/y },
        ],
        numbers: [{ kind: "number" as const, re: /\b\d+(?:\.\d+)?\b/y }],
        operators: [{ kind: "operator" as const, re: /[{}()[\].,;:+\-*/%=<>!&|^~?]+/y }],
    }

    if (language === "python") {
        return [
            { kind: "comment", re: /#[^\n]*/y },
            ...common.strings,
            {
                kind: "keyword",
                re: editorKeywordRegex([
                    "def",
                    "class",
                    "if",
                    "elif",
                    "else",
                    "for",
                    "while",
                    "try",
                    "except",
                    "finally",
                    "return",
                    "import",
                    "from",
                    "as",
                    "with",
                    "lambda",
                    "pass",
                    "break",
                    "continue",
                    "yield",
                    "raise",
                    "in",
                    "is",
                    "not",
                    "and",
                    "or",
                ]),
            },
            { kind: "builtin", re: editorKeywordRegex(["True", "False", "None"]) },
            ...common.numbers,
            ...common.operators,
        ]
    }

    if (language === "json") {
        return [
            { kind: "string", re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
            { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
            { kind: "builtin", re: editorKeywordRegex(["true", "false", "null"]) },
            ...common.numbers,
            ...common.operators,
        ]
    }

    return [
        { kind: "comment", re: /\/\/[^\n]*/y },
        { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
        ...common.strings,
        {
            kind: "keyword",
            re: editorKeywordRegex([
                "function",
                "const",
                "let",
                "var",
                "class",
                "interface",
                "type",
                "if",
                "else",
                "switch",
                "case",
                "for",
                "while",
                "do",
                "return",
                "import",
                "from",
                "export",
                "async",
                "await",
                "try",
                "catch",
                "finally",
                "new",
            ]),
        },
        { kind: "builtin", re: editorKeywordRegex(["true", "false", "null", "undefined"]) },
        ...common.numbers,
        ...common.operators,
    ]
}

function tokenizeEditorCode(code: string, language: "python" | "typescript" | "json"): Token[] {
    const rules = editorRulesForLanguage(language)
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

function editorTokenColor(kind: TokenKind): string {
    if (kind === "keyword") return "#5C6BC0"
    if (kind === "string") return "#2E7D32"
    if (kind === "number") return "#EF6C00"
    if (kind === "comment") return "#607D8B"
    if (kind === "operator") return "#C2185B"
    if (kind === "builtin") return "#6A1B9A"
    return "inherit"
}

function normalizeCodeText(raw: string): string {
    const normalized = String(raw || "").replace(/\r\n?/g, "\n")
    const trimmedLines = normalized.split("\n").map((line) => line.replace(/[ \t]+$/g, ""))
    return `${trimmedLines.join("\n").trimEnd()}\n`
}

function formatTypescriptLike(raw: string): string {
    const lines = normalizeCodeText(raw).split("\n")
    const out: string[] = []
    let depth = 0
    for (const src of lines) {
        const line = src.trim()
        if (!line) {
            out.push("")
            continue
        }
        if (/^[\]\})]/.test(line)) depth = Math.max(0, depth - 1)
        out.push(`${"  ".repeat(depth)}${line}`)
        const opens = (line.match(/[\[{(]/g) || []).length
        const closes = (line.match(/[\]})]/g) || []).length
        depth = Math.max(0, depth + opens - closes)
    }
    return `${out.join("\n").trimEnd()}\n`
}

function formatCodeForRuntime(runtime: ToolForm["runtime"], code: string): string {
    if (!code.trim()) return ""
    if (runtime === "local_typescript") {
        return formatTypescriptLike(code)
    }
    return normalizeCodeText(code)
}

function prettifyJsonObjectText(raw: string): string {
    const parsed = parseJsonObject("JSON", raw)
    return `${JSON.stringify(parsed, null, 2)}\n`
}

function EditorCodePreview({
    code,
    language,
    minHeight = 260,
}: {
    code: string
    language: "python" | "typescript" | "json"
    minHeight?: number
}) {
    const tokens = useMemo(() => tokenizeEditorCode(code || "", language), [code, language])
    return (
        <Paper
            variant="outlined"
            sx={{
                minHeight,
                maxHeight: 520,
                overflow: "auto",
                p: 1.2,
                bgcolor: "#fbfcff",
                borderStyle: "dashed",
            }}
        >
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.8 }}>
                Syntax preview
            </Typography>
            <Box
                component="pre"
                sx={{
                    m: 0,
                    whiteSpace: "pre-wrap",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                }}
            >
                {tokens.map((tok, idx) => (
                    <Box key={`${idx}-${tok.kind}`} component="span" sx={{ color: editorTokenColor(tok.kind) }}>
                        {tok.text}
                    </Box>
                ))}
            </Box>
        </Paper>
    )
}

function emptyForm(): ToolForm {
    return {
        projectId: "",
        name: "",
        description: "",
        runtime: "backend_python",
        isEnabled: true,
        readOnly: true,
        requireApproval: false,
        timeoutSec: 45,
        rateLimitPerMin: 40,
        maxRetries: 0,
        cacheTtlSec: 0,
        inputSchemaText: DEFAULT_SCHEMA,
        outputSchemaText: DEFAULT_SCHEMA,
        secretsText: "{}",
        tagsText: "",
        codeText: `async def run(args, context):
    # args: tool input object
    # context: includes project_id, branch, user_id, chat_id, secrets
    return {"ok": True, "echo": args}
`,
    }
}

function parseJsonObject(label: string, text: string): Record<string, unknown> {
    const raw = (text || "").trim()
    if (!raw) return {}
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error(`${label} must be valid JSON`)
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON object`)
    }
    return parsed as Record<string, unknown>
}

export default function AdminCustomToolsPage() {
    const [projects, setProjects] = useState<ProjectRow[]>([])
    const [projectFilter, setProjectFilter] = useState<string>("")
    const [tools, setTools] = useState<CustomToolRow[]>([])
    const [selectedToolId, setSelectedToolId] = useState<string>("")
    const [versions, setVersions] = useState<ToolVersionRow[]>([])
    const [form, setForm] = useState<ToolForm>(emptyForm())
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [testArgsText, setTestArgsText] = useState<string>('{}')
    const [testResult, setTestResult] = useState<string>("")
    const [systemTools, setSystemTools] = useState<SystemToolRow[]>([])
    const [templateId, setTemplateId] = useState<string>("")
    const [versionCodeRows, setVersionCodeRows] = useState<ToolVersionRow[]>([])
    const [versionCodeLoading, setVersionCodeLoading] = useState(false)
    const [selectedVersionCode, setSelectedVersionCode] = useState<number>(0)

    const runtimeTemplates = useMemo(
        () => TOOL_TEMPLATES.filter((t) => t.runtime === form.runtime),
        [form.runtime]
    )
    const codeLanguage = useMemo(() => normalizeEditorLanguage(form.runtime), [form.runtime])
    const selectedVersionCodeRow = useMemo(
        () => versionCodeRows.find((v) => v.version === selectedVersionCode) || null,
        [versionCodeRows, selectedVersionCode]
    )

    useEffect(() => {
        let stopped = false
        let inFlight = false
        const claimId = `admin-tools-${Math.random().toString(36).slice(2, 10)}`

        async function tick() {
            if (stopped || inFlight) return
            inFlight = true
            try {
                const claim = await backendJson<LocalToolClaimResponse>("/api/local-tools/jobs/claim", {
                    method: "POST",
                    body: JSON.stringify({
                        projectId: projectFilter || undefined,
                        claimId,
                    }),
                })
                const job = claim.job
                if (!job?.id) return
                try {
                    const result = await executeLocalToolJob(job)
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/complete`, {
                        method: "POST",
                        body: JSON.stringify({ claimId, result }),
                    })
                } catch (err) {
                    await backendJson(`/api/local-tools/jobs/${encodeURIComponent(job.id)}/fail`, {
                        method: "POST",
                        body: JSON.stringify({
                            claimId,
                            error: err instanceof Error ? err.message : String(err),
                        }),
                    })
                }
            } catch {
                // silent background worker
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
    }, [projectFilter])

    const loadProjects = useCallback(async () => {
        try {
            const rows = await backendJson<ProjectRow[]>("/api/admin/projects")
            setProjects(rows || [])
        } catch {
            setProjects([])
        }
    }, [])

    const loadTools = useCallback(async () => {
        setError(null)
        const qs = projectFilter ? `?projectId=${encodeURIComponent(projectFilter)}&include_global=true` : ""
        const out = await backendJson<{ items: CustomToolRow[] }>(`/api/admin/custom-tools${qs}`)
        const rows = (out.items || []).sort((a, b) => a.name.localeCompare(b.name))
        setTools(rows)
        if (selectedToolId && rows.some((r) => r.id === selectedToolId)) return
        setSelectedToolId(rows[0]?.id || "")
    }, [projectFilter, selectedToolId])

    const loadSystemTools = useCallback(async () => {
        const qs = projectFilter ? `?projectId=${encodeURIComponent(projectFilter)}` : ""
        const out = await backendJson<{ items: SystemToolRow[] }>(`/api/admin/system-tools${qs}`)
        setSystemTools((out.items || []).sort((a, b) => a.name.localeCompare(b.name)))
    }, [projectFilter])

    const loadVersionCodes = useCallback(async (toolId: string) => {
        if (!toolId) {
            setVersionCodeRows([])
            setSelectedVersionCode(0)
            return
        }
        setVersionCodeLoading(true)
        try {
            const out = await backendJson<{ items: ToolVersionRow[] }>(
                `/api/admin/custom-tools/${encodeURIComponent(toolId)}/versions?include_code=true`
            )
            const rows = (out.items || []).sort((a, b) => b.version - a.version)
            setVersionCodeRows(rows)
            setSelectedVersionCode(rows[0]?.version || 0)
        } finally {
            setVersionCodeLoading(false)
        }
    }, [])

    const loadToolDetail = useCallback(async (toolId: string) => {
        if (!toolId) {
            setVersions([])
            setVersionCodeRows([])
            setSelectedVersionCode(0)
            return
        }
        const detail = await backendJson<ToolDetailResponse>(`/api/admin/custom-tools/${encodeURIComponent(toolId)}`)
        const t = detail.tool
        const rows = detail.versions || []
        setVersions(rows)
        setSelectedVersionCode(rows[0]?.version || 0)
        setVersionCodeRows([])
        setForm({
            id: t.id,
            projectId: t.projectId || "",
            name: t.name || "",
            description: t.description || "",
            runtime: t.runtime || "backend_python",
            isEnabled: t.isEnabled !== false,
            readOnly: t.readOnly !== false,
            requireApproval: Boolean(t.requireApproval),
            timeoutSec: Number(t.timeoutSec || 45),
            rateLimitPerMin: Number(t.rateLimitPerMin || 40),
            maxRetries: Number(t.maxRetries || 0),
            cacheTtlSec: Number(t.cacheTtlSec || 0),
            inputSchemaText: JSON.stringify(t.inputSchema || { type: "object", properties: {}, required: [], additionalProperties: true }, null, 2),
            outputSchemaText: JSON.stringify(t.outputSchema || { type: "object", properties: {}, required: [], additionalProperties: true }, null, 2),
            secretsText: JSON.stringify((detail.tool as any).secrets || {}, null, 2),
            tagsText: Array.isArray(t.tags) ? t.tags.join(", ") : "",
            codeText: "",
        })
        if (rows.length) {
            void loadVersionCodes(toolId).catch((err) => setError(err instanceof Error ? err.message : String(err)))
        }
    }, [loadVersionCodes])

    useEffect(() => {
        void loadProjects()
    }, [loadProjects])

    useEffect(() => {
        void loadTools().catch((err) => setError(String(err)))
    }, [loadTools])

    useEffect(() => {
        void loadSystemTools().catch((err) => setError(String(err)))
    }, [loadSystemTools])

    useEffect(() => {
        if (!selectedToolId) return
        void loadToolDetail(selectedToolId).catch((err) => setError(String(err)))
    }, [loadToolDetail, selectedToolId])

    useEffect(() => {
        if (!runtimeTemplates.length) {
            setTemplateId("")
            return
        }
        if (runtimeTemplates.some((t) => t.id === templateId)) return
        setTemplateId(runtimeTemplates[0].id)
    }, [runtimeTemplates, templateId])

    function applyTemplate() {
        const template = runtimeTemplates.find((t) => t.id === templateId)
        if (!template) return
        setForm((f) => ({
            ...f,
            codeText: template.code,
            inputSchemaText: template.inputSchema ? JSON.stringify(template.inputSchema, null, 2) : f.inputSchemaText,
            outputSchemaText: template.outputSchema ? JSON.stringify(template.outputSchema, null, 2) : f.outputSchemaText,
        }))
        if (template.testArgs) {
            setTestArgsText(JSON.stringify(template.testArgs, null, 2))
        }
        setNotice(`Applied template: ${template.name}`)
    }

    function formatCode() {
        try {
            const formatted = formatCodeForRuntime(form.runtime, form.codeText)
            setForm((f) => ({ ...f, codeText: formatted }))
            setNotice(formatted ? "Code formatted." : "Code editor is empty.")
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        }
    }

    function formatJsonField(field: "inputSchemaText" | "outputSchemaText" | "secretsText" | "testArgsText") {
        try {
            if (field === "testArgsText") {
                setTestArgsText(prettifyJsonObjectText(testArgsText))
            } else if (field === "inputSchemaText") {
                setForm((f) => ({ ...f, inputSchemaText: prettifyJsonObjectText(f.inputSchemaText) }))
            } else if (field === "outputSchemaText") {
                setForm((f) => ({ ...f, outputSchemaText: prettifyJsonObjectText(f.outputSchemaText) }))
            } else {
                setForm((f) => ({ ...f, secretsText: prettifyJsonObjectText(f.secretsText) }))
            }
            setNotice("JSON formatted.")
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        }
    }

    function loadSelectedVersionIntoEditor() {
        const code = String(selectedVersionCodeRow?.code || "")
        if (!code.trim()) {
            setError("Selected version has no code payload available.")
            return
        }
        setForm((f) => ({ ...f, codeText: code }))
        setNotice(`Loaded version v${selectedVersionCode} into editor.`)
    }

    function onCodeEditorKeyDown(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key !== "Tab") return
        e.preventDefault()
        const target = e.target as HTMLTextAreaElement
        const start = target.selectionStart ?? 0
        const end = target.selectionEnd ?? 0
        const next = `${form.codeText.slice(0, start)}    ${form.codeText.slice(end)}`
        setForm((f) => ({ ...f, codeText: next }))
        window.requestAnimationFrame(() => {
            target.selectionStart = target.selectionEnd = start + 4
        })
    }

    async function createTool() {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            const inputSchema = parseJsonObject("Input schema", form.inputSchemaText)
            const outputSchema = parseJsonObject("Output schema", form.outputSchemaText)
            const secrets = parseJsonObject("Secrets", form.secretsText)
            const payload = {
                projectId: form.projectId || null,
                name: form.name,
                description: form.description || null,
                runtime: form.runtime,
                isEnabled: form.isEnabled,
                readOnly: form.readOnly,
                requireApproval: form.requireApproval,
                timeoutSec: form.timeoutSec,
                rateLimitPerMin: form.rateLimitPerMin,
                maxRetries: form.maxRetries,
                cacheTtlSec: form.cacheTtlSec,
                inputSchema,
                outputSchema,
                secrets,
                tags: form.tagsText.split(",").map((v) => v.trim()).filter(Boolean),
                initialCode: form.codeText,
                autoPublish: true,
            }
            const out = await backendJson<{ tool: CustomToolRow }>("/api/admin/custom-tools", {
                method: "POST",
                body: JSON.stringify(payload),
            })
            setNotice("Custom tool created and published.")
            await loadTools()
            setSelectedToolId(out.tool?.id || "")
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    async function updateTool() {
        if (!form.id) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            const inputSchema = parseJsonObject("Input schema", form.inputSchemaText)
            const outputSchema = parseJsonObject("Output schema", form.outputSchemaText)
            const secrets = parseJsonObject("Secrets", form.secretsText)
            await backendJson(`/api/admin/custom-tools/${encodeURIComponent(form.id)}`, {
                method: "PATCH",
                body: JSON.stringify({
                    name: form.name,
                    description: form.description || null,
                    runtime: form.runtime,
                    isEnabled: form.isEnabled,
                    readOnly: form.readOnly,
                    requireApproval: form.requireApproval,
                    timeoutSec: form.timeoutSec,
                    rateLimitPerMin: form.rateLimitPerMin,
                    maxRetries: form.maxRetries,
                    cacheTtlSec: form.cacheTtlSec,
                    inputSchema,
                    outputSchema,
                    secrets,
                    tags: form.tagsText.split(",").map((v) => v.trim()).filter(Boolean),
                }),
            })
            setNotice("Custom tool updated.")
            await loadTools()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    async function addVersion(publish: boolean) {
        if (!form.id || !form.codeText.trim()) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            await backendJson(`/api/admin/custom-tools/${encodeURIComponent(form.id)}/versions`, {
                method: "POST",
                body: JSON.stringify({
                    code: form.codeText,
                    publish,
                }),
            })
            setNotice(publish ? "New version created and published." : "New draft version created.")
            await loadToolDetail(form.id)
            await loadTools()
            setForm((f) => ({ ...f, codeText: "" }))
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    async function publishLatest() {
        if (!form.id) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            await backendJson(`/api/admin/custom-tools/${encodeURIComponent(form.id)}/publish`, {
                method: "POST",
                body: JSON.stringify({}),
            })
            setNotice("Latest version published.")
            await loadToolDetail(form.id)
            await loadTools()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    async function runTest() {
        if (!form.id) return
        setBusy(true)
        setError(null)
        setNotice(null)
        setTestResult("")
        try {
            const args = parseJsonObject("Test args", testArgsText)
            const projectId = form.projectId || projectFilter || projects[0]?.id || ""
            if (!projectId) {
                throw new Error("Select a project scope or set project filter before test run.")
            }
            const out = await backendJson<{ ok: boolean; result: unknown; version: number }>(
                `/api/admin/custom-tools/${encodeURIComponent(form.id)}/test-run`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        projectId,
                        branch: "main",
                        args,
                    }),
                }
            )
            setTestResult(JSON.stringify(out, null, 2))
            setNotice(`Test run completed (version ${out.version}).`)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    async function updateSystemTool(name: string, patch: Partial<SystemToolRow>) {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
            await backendJson(`/api/admin/system-tools/${encodeURIComponent(name)}`, {
                method: "PUT",
                body: JSON.stringify({
                    projectId: projectFilter || null,
                    ...patch,
                }),
            })
            await loadSystemTools()
            setNotice(`Updated system tool: ${name}`)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Button component={Link} href="/admin" startIcon={<ArrowBackRounded />} variant="outlined">
                            Back to Admin
                        </Button>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            Custom Tools
                        </Typography>
                    </Stack>
                    <FormControl size="small" sx={{ minWidth: 280 }}>
                        <InputLabel id="project-filter-label">Project Scope</InputLabel>
                        <Select
                            labelId="project-filter-label"
                            label="Project Scope"
                            value={projectFilter}
                            onChange={(e) => setProjectFilter(e.target.value)}
                        >
                            <MenuItem value="">All (including global)</MenuItem>
                            {projects.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.name} ({p.key})
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>

                {error && <Alert severity="error">{error}</Alert>}
                {notice && <Alert severity="success">{notice}</Alert>}

                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "360px 1fr" }, gap: 2 }}>
                    <Card variant="outlined">
                        <CardContent>
                            <Stack spacing={1.2}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                        Available Tools
                                    </Typography>
                                    <Button
                                        startIcon={<AddRounded />}
                                        size="small"
                                        onClick={() => {
                                            setSelectedToolId("")
                                            setVersions([])
                                            setVersionCodeRows([])
                                            setSelectedVersionCode(0)
                                            setForm(emptyForm())
                                        }}
                                    >
                                        New
                                    </Button>
                                </Stack>
                                <Divider />
                                <Stack spacing={1}>
                                    {tools.map((tool) => (
                                        <Button
                                            key={tool.id}
                                            variant={selectedToolId === tool.id ? "contained" : "outlined"}
                                            onClick={() => setSelectedToolId(tool.id)}
                                            sx={{ justifyContent: "space-between" }}
                                        >
                                            <span>{tool.name}</span>
                                            <Chip
                                                size="small"
                                                label={tool.runtime === "local_typescript" ? "Local TS" : "Backend Py"}
                                                color={tool.runtime === "local_typescript" ? "secondary" : "primary"}
                                                variant="outlined"
                                            />
                                        </Button>
                                    ))}
                                    {!tools.length && (
                                        <Typography variant="body2" color="text.secondary">
                                            No custom tools found for this scope.
                                        </Typography>
                                    )}
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card variant="outlined">
                        <CardContent>
                            <Stack spacing={1.4}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                    {form.id ? `Edit Tool: ${form.name}` : "Create New Tool"}
                                </Typography>

                                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.2 }}>
                                    <FormControl size="small" fullWidth>
                                        <InputLabel id="tool-project-label">Project Scope</InputLabel>
                                        <Select
                                            labelId="tool-project-label"
                                            label="Project Scope"
                                            value={form.projectId}
                                            onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                                        >
                                            <MenuItem value="">Global Tool</MenuItem>
                                            {projects.map((p) => (
                                                <MenuItem key={p.id} value={p.id}>
                                                    {p.name} ({p.key})
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <FormControl size="small" fullWidth>
                                        <InputLabel id="tool-runtime-label">Runtime</InputLabel>
                                        <Select
                                            labelId="tool-runtime-label"
                                            label="Runtime"
                                            value={form.runtime}
                                            onChange={(e) =>
                                                setForm((f) => ({ ...f, runtime: e.target.value as ToolForm["runtime"] }))
                                            }
                                        >
                                            <MenuItem value="backend_python">Backend Python</MenuItem>
                                            <MenuItem value="local_typescript">Local TypeScript (browser)</MenuItem>
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        label="Tool Name"
                                        size="small"
                                        value={form.name}
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        label="Description"
                                        size="small"
                                        value={form.description}
                                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        label="Timeout (sec)"
                                        size="small"
                                        type="number"
                                        value={form.timeoutSec}
                                        onChange={(e) => setForm((f) => ({ ...f, timeoutSec: Number(e.target.value || 45) }))}
                                    />
                                    <TextField
                                        label="Rate Limit (/min)"
                                        size="small"
                                        type="number"
                                        value={form.rateLimitPerMin}
                                        onChange={(e) => setForm((f) => ({ ...f, rateLimitPerMin: Number(e.target.value || 40) }))}
                                    />
                                    <TextField
                                        label="Retries"
                                        size="small"
                                        type="number"
                                        value={form.maxRetries}
                                        onChange={(e) => setForm((f) => ({ ...f, maxRetries: Number(e.target.value || 0) }))}
                                    />
                                    <TextField
                                        label="Cache TTL (sec)"
                                        size="small"
                                        type="number"
                                        value={form.cacheTtlSec}
                                        onChange={(e) => setForm((f) => ({ ...f, cacheTtlSec: Number(e.target.value || 0) }))}
                                    />
                                    <TextField
                                        label="Tags (comma-separated)"
                                        size="small"
                                        value={form.tagsText}
                                        onChange={(e) => setForm((f) => ({ ...f, tagsText: e.target.value }))}
                                        fullWidth
                                        sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}
                                    />
                                </Box>

                                <Stack direction="row" spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Switch checked={form.isEnabled} onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))} />
                                        <Typography variant="body2">Enabled</Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Switch checked={form.readOnly} onChange={(e) => setForm((f) => ({ ...f, readOnly: e.target.checked }))} />
                                        <Typography variant="body2">Read-only</Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Switch
                                            checked={form.requireApproval}
                                            onChange={(e) => setForm((f) => ({ ...f, requireApproval: e.target.checked }))}
                                        />
                                        <Typography variant="body2">Require per-chat approval</Typography>
                                    </Stack>
                                </Stack>

                                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 1 }}>
                                    <Box>
                                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                Input JSON Schema
                                            </Typography>
                                            <Tooltip title="Auto-format JSON">
                                                <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => formatJsonField("inputSchemaText")}>
                                                    Format
                                                </Button>
                                            </Tooltip>
                                        </Stack>
                                        <TextField
                                            size="small"
                                            value={form.inputSchemaText}
                                            onChange={(e) => setForm((f) => ({ ...f, inputSchemaText: e.target.value }))}
                                            fullWidth
                                            multiline
                                            minRows={10}
                                            sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                        />
                                    </Box>
                                    <Box>
                                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                Output JSON Schema
                                            </Typography>
                                            <Tooltip title="Auto-format JSON">
                                                <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => formatJsonField("outputSchemaText")}>
                                                    Format
                                                </Button>
                                            </Tooltip>
                                        </Stack>
                                        <TextField
                                            size="small"
                                            value={form.outputSchemaText}
                                            onChange={(e) => setForm((f) => ({ ...f, outputSchemaText: e.target.value }))}
                                            fullWidth
                                            multiline
                                            minRows={10}
                                            sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                        />
                                    </Box>
                                </Box>

                                <Box>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary">
                                            Secrets (JSON object)
                                        </Typography>
                                        <Tooltip title="Auto-format JSON">
                                            <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => formatJsonField("secretsText")}>
                                                Format
                                            </Button>
                                        </Tooltip>
                                    </Stack>
                                    <TextField
                                        size="small"
                                        value={form.secretsText}
                                        onChange={(e) => setForm((f) => ({ ...f, secretsText: e.target.value }))}
                                        fullWidth
                                        multiline
                                        minRows={4}
                                        sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                    />
                                </Box>

                                <Stack direction="row" spacing={1}>
                                    <Button
                                        variant="contained"
                                        startIcon={<SaveRounded />}
                                        onClick={() => void (form.id ? updateTool() : createTool())}
                                        disabled={busy || !form.name.trim()}
                                    >
                                        {form.id ? "Save Tool" : "Create Tool"}
                                    </Button>
                                    {form.id && (
                                        <Button variant="outlined" startIcon={<PublishRounded />} onClick={() => void publishLatest()} disabled={busy}>
                                            Publish Latest
                                        </Button>
                                    )}
                                </Stack>

                                <Divider />

                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    New Version Code
                                </Typography>
                                <Paper variant="outlined" sx={{ p: 1 }}>
                                    <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
                                        <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 340 } }}>
                                            <InputLabel id="tool-template-label">Code Template</InputLabel>
                                            <Select
                                                labelId="tool-template-label"
                                                label="Code Template"
                                                value={templateId}
                                                onChange={(e) => setTemplateId(e.target.value)}
                                            >
                                                {runtimeTemplates.map((tpl) => (
                                                    <MenuItem key={tpl.id} value={tpl.id}>
                                                        {tpl.name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <Button variant="outlined" startIcon={<UploadFileRounded />} onClick={applyTemplate} disabled={!templateId}>
                                            Apply Template
                                        </Button>
                                        <Button variant="outlined" startIcon={<AutoFixHighRounded />} onClick={formatCode}>
                                            Format Code
                                        </Button>
                                    </Stack>
                                    {templateId && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                                            {runtimeTemplates.find((t) => t.id === templateId)?.description || ""}
                                        </Typography>
                                    )}
                                </Paper>
                                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, gap: 1 }}>
                                    <TextField
                                        label={form.runtime === "local_typescript" ? "TypeScript code (define function run(args, context, helpers))" : "Python code (define run(args, context))"}
                                        size="small"
                                        value={form.codeText}
                                        onChange={(e) => setForm((f) => ({ ...f, codeText: e.target.value }))}
                                        onKeyDown={onCodeEditorKeyDown}
                                        fullWidth
                                        multiline
                                        minRows={16}
                                        sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                    />
                                    <EditorCodePreview code={form.codeText} language={codeLanguage} minHeight={360} />
                                </Box>
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        variant="outlined"
                                        startIcon={<AddRounded />}
                                        onClick={() => void addVersion(false)}
                                        disabled={busy || !form.id || !form.codeText.trim()}
                                    >
                                        Add Draft Version
                                    </Button>
                                    <Button
                                        variant="contained"
                                        startIcon={<PublishRounded />}
                                        onClick={() => void addVersion(true)}
                                        disabled={busy || !form.id || !form.codeText.trim()}
                                    >
                                        Add + Publish
                                    </Button>
                                </Stack>

                                <Box>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.6 }}>
                                        Versions
                                    </Typography>
                                    <Stack direction="row" gap={1} flexWrap="wrap">
                                        {versions.map((v) => (
                                            <Chip
                                                key={v.id}
                                                label={`v${v.version} · ${v.status}`}
                                                color={v.status === "published" ? "primary" : "default"}
                                                variant={v.status === "published" ? "filled" : "outlined"}
                                                onClick={() => setSelectedVersionCode(v.version)}
                                            />
                                        ))}
                                        {!versions.length && (
                                            <Typography variant="body2" color="text.secondary">
                                                No versions yet.
                                            </Typography>
                                        )}
                                    </Stack>
                                </Box>

                                <Paper variant="outlined" sx={{ p: 1.2 }}>
                                    <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
                                        <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 220 } }}>
                                            <InputLabel id="tool-version-code-label">Version Code</InputLabel>
                                            <Select
                                                labelId="tool-version-code-label"
                                                label="Version Code"
                                                value={selectedVersionCode || ""}
                                                onChange={(e) => setSelectedVersionCode(Number(e.target.value || 0))}
                                                disabled={!versions.length}
                                            >
                                                {versions.map((v) => (
                                                    <MenuItem key={`view-${v.id}`} value={v.version}>
                                                        v{v.version} ({v.status})
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <Button
                                            variant="outlined"
                                            startIcon={<RefreshRounded />}
                                            onClick={() =>
                                                void loadVersionCodes(form.id || "").catch((err) =>
                                                    setError(err instanceof Error ? err.message : String(err))
                                                )
                                            }
                                            disabled={!form.id || versionCodeLoading}
                                        >
                                            Refresh Uploaded Code
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            startIcon={<ContentCopyRounded />}
                                            onClick={loadSelectedVersionIntoEditor}
                                            disabled={!selectedVersionCodeRow?.code}
                                        >
                                            Load Into Editor
                                        </Button>
                                    </Stack>
                                    {versionCodeLoading && (
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                            Loading uploaded version code...
                                        </Typography>
                                    )}
                                    {!versionCodeLoading && !!selectedVersionCodeRow?.code && (
                                        <Box sx={{ mt: 1 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.6 }}>
                                                Uploaded version v{selectedVersionCodeRow.version}
                                            </Typography>
                                            <EditorCodePreview code={String(selectedVersionCodeRow.code || "")} language={codeLanguage} minHeight={220} />
                                        </Box>
                                    )}
                                </Paper>

                                <Divider />
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Test Run
                                </Typography>
                                <Box>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary">
                                            Test Args (JSON object)
                                        </Typography>
                                        <Tooltip title="Auto-format JSON">
                                            <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => formatJsonField("testArgsText")}>
                                                Format
                                            </Button>
                                        </Tooltip>
                                    </Stack>
                                    <TextField
                                        size="small"
                                        value={testArgsText}
                                        onChange={(e) => setTestArgsText(e.target.value)}
                                        fullWidth
                                        multiline
                                        minRows={3}
                                        sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                    />
                                </Box>
                                <Button
                                    variant="outlined"
                                    startIcon={<ScienceRounded />}
                                    onClick={() => void runTest()}
                                    disabled={busy || !form.id}
                                >
                                    Run Test
                                </Button>
                                {!!testResult && (
                                    <TextField
                                        label="Test Result"
                                        size="small"
                                        value={testResult}
                                        fullWidth
                                        multiline
                                        minRows={8}
                                        InputProps={{ readOnly: true }}
                                    />
                                )}
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                <Card variant="outlined">
                    <CardContent>
                        <Stack spacing={1.1}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                Built-in Tool Load Config
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Built-in tools are now loaded from configuration, just like custom tools.
                                {projectFilter
                                    ? " You are editing project-specific overrides."
                                    : " Select a project scope to create project-specific overrides."}
                            </Typography>
                            <Divider />
                            <Stack spacing={1}>
                                {systemTools.map((tool) => (
                                    <Paper
                                        key={`${tool.projectId || "global"}:${tool.name}`}
                                        variant="outlined"
                                        sx={{ p: 1, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr auto auto" }, gap: 1, alignItems: "center" }}
                                    >
                                        <Box>
                                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                                {tool.name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {tool.description || "No description"}
                                            </Typography>
                                        </Box>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="caption">Enabled</Typography>
                                            <Switch
                                                size="small"
                                                checked={tool.isEnabled}
                                                onChange={(e) => void updateSystemTool(tool.name, { isEnabled: e.target.checked })}
                                                disabled={busy || !projectFilter}
                                            />
                                        </Stack>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="caption">Approval</Typography>
                                            <Switch
                                                size="small"
                                                checked={tool.requireApproval}
                                                onChange={(e) => void updateSystemTool(tool.name, { requireApproval: e.target.checked })}
                                                disabled={busy || !projectFilter}
                                            />
                                        </Stack>
                                    </Paper>
                                ))}
                                {!systemTools.length && (
                                    <Typography variant="body2" color="text.secondary">
                                        No system tools loaded.
                                    </Typography>
                                )}
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </Container>
    )
}
