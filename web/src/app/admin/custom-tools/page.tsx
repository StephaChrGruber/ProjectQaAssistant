"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
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
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material"
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import PublishRounded from "@mui/icons-material/PublishRounded"
import ScienceRounded from "@mui/icons-material/ScienceRounded"
import AddRounded from "@mui/icons-material/AddRounded"
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
    createdAt?: string
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

    const loadToolDetail = useCallback(async (toolId: string) => {
        if (!toolId) {
            setVersions([])
            return
        }
        const detail = await backendJson<ToolDetailResponse>(`/api/admin/custom-tools/${encodeURIComponent(toolId)}`)
        const t = detail.tool
        setVersions(detail.versions || [])
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
    }, [])

    useEffect(() => {
        void loadProjects()
    }, [loadProjects])

    useEffect(() => {
        void loadTools().catch((err) => setError(String(err)))
    }, [loadTools])

    useEffect(() => {
        if (!selectedToolId) return
        void loadToolDetail(selectedToolId).catch((err) => setError(String(err)))
    }, [loadToolDetail, selectedToolId])

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

                                <TextField
                                    label="Input JSON Schema"
                                    size="small"
                                    value={form.inputSchemaText}
                                    onChange={(e) => setForm((f) => ({ ...f, inputSchemaText: e.target.value }))}
                                    fullWidth
                                    multiline
                                    minRows={6}
                                    sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                />
                                <TextField
                                    label="Output JSON Schema"
                                    size="small"
                                    value={form.outputSchemaText}
                                    onChange={(e) => setForm((f) => ({ ...f, outputSchemaText: e.target.value }))}
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                                />
                                <TextField
                                    label="Secrets (JSON object)"
                                    size="small"
                                    value={form.secretsText}
                                    onChange={(e) => setForm((f) => ({ ...f, secretsText: e.target.value }))}
                                    fullWidth
                                    multiline
                                    minRows={3}
                                />

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
                                <TextField
                                    label={form.runtime === "local_typescript" ? "TypeScript code (define function run(args, context, helpers))" : "Python code (define run(args, context))"}
                                    size="small"
                                    value={form.codeText}
                                    onChange={(e) => setForm((f) => ({ ...f, codeText: e.target.value }))}
                                    fullWidth
                                    multiline
                                    minRows={10}
                                />
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
                                            />
                                        ))}
                                        {!versions.length && (
                                            <Typography variant="body2" color="text.secondary">
                                                No versions yet.
                                            </Typography>
                                        )}
                                    </Stack>
                                </Box>

                                <Divider />
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Test Run
                                </Typography>
                                <TextField
                                    label="Test Args (JSON object)"
                                    size="small"
                                    value={testArgsText}
                                    onChange={(e) => setTestArgsText(e.target.value)}
                                    fullWidth
                                    multiline
                                    minRows={3}
                                />
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
            </Stack>
        </Container>
    )
}
