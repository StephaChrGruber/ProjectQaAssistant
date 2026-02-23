"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { editor as MonacoEditorNS } from "monaco-editor"
import type { OnMount } from "@monaco-editor/react"
import {
    Alert,
    Box,
    Button,
    Container,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from "@mui/material"
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import { backendJson } from "@/lib/backend"
import { SystemToolsConfigCard } from "@/features/custom-tools/SystemToolsConfigCard"
import { ToolSelectorCard } from "@/features/custom-tools/ToolSelectorCard"
import { CustomToolEditorCard } from "@/features/custom-tools/CustomToolEditorCard"
import { useLocalToolJobWorker } from "@/features/local-tools/useLocalToolJobWorker"
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
    ProjectRow,
    SystemToolRow,
    ToolDetailResponse,
    ToolForm,
    ToolVersionRow,
} from "@/features/custom-tools/types"

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

    const buildLocalToolClaimPayload = useCallback(
        () => ({
            projectId: projectFilter || undefined,
        }),
        [projectFilter]
    )

    useLocalToolJobWorker({
        claimIdPrefix: "admin-tools",
        buildClaimPayload: buildLocalToolClaimPayload,
    })

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

                    <CustomToolEditorCard
                        form={form}
                        setForm={setForm}
                        projects={projects}
                        versions={versions}
                        busy={busy}
                        runtimeTemplates={runtimeTemplates}
                        templateId={templateId}
                        setTemplateId={setTemplateId}
                        codeLanguage={codeLanguage}
                        versionCodeLoading={versionCodeLoading}
                        selectedVersionCode={selectedVersionCode}
                        setSelectedVersionCode={setSelectedVersionCode}
                        selectedVersionCodeRow={selectedVersionCodeRow}
                        testArgsText={testArgsText}
                        setTestArgsText={setTestArgsText}
                        testResult={testResult}
                        onCodeEditorMount={handleCodeEditorMount}
                        onApplyTemplate={applyTemplate}
                        onFormatCode={formatCode}
                        onFormatJsonField={formatJsonField}
                        onCreateTool={createTool}
                        onUpdateTool={updateTool}
                        onPublishLatest={publishLatest}
                        onAddVersion={addVersion}
                        onRefreshVersionCodes={() =>
                            void loadVersionCodes(form.id || "").catch((err) =>
                                setError(err instanceof Error ? err.message : String(err))
                            )
                        }
                        onLoadSelectedVersionIntoEditor={loadSelectedVersionIntoEditor}
                        onRunTest={runTest}
                    />
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
