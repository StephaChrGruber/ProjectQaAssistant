"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { editor as MonacoEditorNS } from "monaco-editor"
import type { OnMount } from "@monaco-editor/react"
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
import { executeLocalToolJob } from "@/lib/local-custom-tool-runner"
import { EditorCodePreview } from "@/features/custom-tools/EditorCodePreview"
import { SystemToolsConfigCard } from "@/features/custom-tools/SystemToolsConfigCard"
import { ToolSelectorCard } from "@/features/custom-tools/ToolSelectorCard"
import {
    emptyForm,
    formatCodeForRuntime,
    normalizeEditorLanguage,
    parseJsonObject,
    prettifyJsonObjectText,
    pythonEditorSuggestions,
} from "@/features/custom-tools/editor-utils"
import { TOOL_EDITOR_HELPERS_D_TS, TOOL_TEMPLATES } from "@/features/custom-tools/templates"
import type {
    CustomToolRow,
    LocalToolClaimResponse,
    ProjectRow,
    SystemToolRow,
    ToolDetailResponse,
    ToolForm,
    ToolVersionRow,
} from "@/features/custom-tools/types"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

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
    const codeEditorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
    const monacoConfiguredRef = useRef(false)

    const runtimeTemplates = useMemo(
        () => TOOL_TEMPLATES.filter((t) => t.runtime === form.runtime),
        [form.runtime]
    )
    const codeLanguage = useMemo(() => normalizeEditorLanguage(form.runtime), [form.runtime])
    const selectedVersionCodeRow = useMemo(
        () => versionCodeRows.find((v) => v.version === selectedVersionCode) || null,
        [versionCodeRows, selectedVersionCode]
    )

    const handleCodeEditorMount = useCallback<OnMount>((editor, monaco) => {
        codeEditorRef.current = editor
        if (monacoConfiguredRef.current) return
        monacoConfiguredRef.current = true

        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            module: monaco.languages.typescript.ModuleKind.ESNext,
            allowNonTsExtensions: true,
            allowJs: true,
            checkJs: true,
            noEmit: true,
            strict: false,
        })
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
            TOOL_EDITOR_HELPERS_D_TS,
            "ts:filename/tool-runtime-helpers.d.ts"
        )
        monaco.languages.registerCompletionItemProvider("python", {
            provideCompletionItems: () => ({
                suggestions: pythonEditorSuggestions(monaco),
            }),
        })
    }, [])

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

    async function formatCode() {
        try {
            if (!form.codeText.trim()) {
                setNotice("Code editor is empty.")
                return
            }
            if (form.runtime === "local_typescript" && codeEditorRef.current) {
                const action = codeEditorRef.current.getAction("editor.action.formatDocument")
                if (action) {
                    await action.run()
                }
                const value = codeEditorRef.current.getValue()
                setForm((f) => ({ ...f, codeText: value }))
                setNotice("Code formatted.")
                return
            }
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
                    <ToolSelectorCard
                        tools={tools}
                        selectedToolId={selectedToolId}
                        onSelectTool={setSelectedToolId}
                        onCreateNew={() => {
                            setSelectedToolId("")
                            setVersions([])
                            setVersionCodeRows([])
                            setSelectedVersionCode(0)
                            setForm(emptyForm())
                        }}
                    />

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
                                    <Paper variant="outlined" sx={{ minHeight: 380, overflow: "hidden" }}>
                                        <MonacoEditor
                                            height="400px"
                                            language={codeLanguage}
                                            value={form.codeText}
                                            onMount={handleCodeEditorMount}
                                            onChange={(value) => setForm((f) => ({ ...f, codeText: String(value || "") }))}
                                            theme="vs"
                                            options={{
                                                minimap: { enabled: false },
                                                automaticLayout: true,
                                                scrollBeyondLastLine: false,
                                                fontSize: 13,
                                                lineHeight: 20,
                                                tabSize: 4,
                                                insertSpaces: true,
                                                wordWrap: "on",
                                                quickSuggestions: {
                                                    other: true,
                                                    comments: false,
                                                    strings: true,
                                                },
                                                suggestOnTriggerCharacters: true,
                                                parameterHints: { enabled: true },
                                            }}
                                        />
                                    </Paper>
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

                <SystemToolsConfigCard
                    systemTools={systemTools}
                    busy={busy}
                    projectFilter={projectFilter}
                    onUpdateTool={updateSystemTool}
                />
            </Stack>
        </Container>
    )
}
