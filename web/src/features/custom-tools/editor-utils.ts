import { DEFAULT_SCHEMA } from "./templates"
import type { ToolForm } from "./types"

export function normalizeEditorLanguage(runtime: ToolForm["runtime"] | "json"): "python" | "typescript" | "json" {
    if (runtime === "backend_python") return "python"
    if (runtime === "local_typescript") return "typescript"
    return "json"
}

export function pythonEditorSuggestions(monaco: any) {
    const k = monaco.languages.CompletionItemKind
    const r = monaco.languages.CompletionItemInsertTextRule
    return [
        {
            label: "run(args, context)",
            kind: k.Snippet,
            documentation: "Main tool entrypoint",
            insertText: "def run(args, context):\n    return {\"ok\": True}\n",
            insertTextRules: r.InsertAsSnippet,
        },
        {
            label: "context.project_id",
            kind: k.Variable,
            insertText: 'context.get("project_id")',
        },
        {
            label: "context.branch",
            kind: k.Variable,
            insertText: 'context.get("branch")',
        },
        {
            label: "context.user_id",
            kind: k.Variable,
            insertText: 'context.get("user_id")',
        },
        {
            label: "context.chat_id",
            kind: k.Variable,
            insertText: 'context.get("chat_id")',
        },
    ]
}

export function normalizeCodeText(raw: string): string {
    const normalized = String(raw || "").replace(/\r\n?/g, "\n")
    const trimmedLines = normalized.split("\n").map((line) => line.replace(/[ \t]+$/g, ""))
    return `${trimmedLines.join("\n").trimEnd()}\n`
}

export function formatTypescriptLike(raw: string): string {
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

export function formatCodeForRuntime(runtime: ToolForm["runtime"], code: string): string {
    if (!code.trim()) return ""
    if (runtime === "local_typescript") {
        return formatTypescriptLike(code)
    }
    return normalizeCodeText(code)
}

export function parseJsonObject(label: string, text: string): Record<string, unknown> {
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

export function prettifyJsonObjectText(raw: string): string {
    const parsed = parseJsonObject("JSON", raw)
    return `${JSON.stringify(parsed, null, 2)}\n`
}

export function emptyForm(): ToolForm {
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
