import type { ToolTemplate } from "./types"

export const DEFAULT_SCHEMA = `{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": true
}`

export const TOOL_TEMPLATES: ToolTemplate[] = [
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

export const TOOL_EDITOR_HELPERS_D_TS = `
type Primitive = string | number | boolean | null
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue }

interface ToolContext {
  project_id?: string
  branch?: string
  user_id?: string
  chat_id?: string
  [key: string]: JsonValue | undefined
}

interface GrepOptions {
  regex?: boolean
  caseSensitive?: boolean
  maxResults?: number
  contextLines?: number
  glob?: string
}

interface GrepHit {
  path: string
  line: number
  column: number
  snippet: string
  before: string[]
  after: string[]
}

interface LocalRepoHelpers {
  hasSnapshot(): boolean
  info(): { rootName: string; indexedAt: string; files: number }
  listFiles(limit?: number): string[]
  readFile(path: string, maxChars?: number): string
  grep(pattern: string, options?: GrepOptions): GrepHit[]
}

interface ToolHelpers {
  localRepo: LocalRepoHelpers
  nowIso(): string
}
`
