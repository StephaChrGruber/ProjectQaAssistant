"use client"

import dynamic from "next/dynamic"
import type { OnMount } from "@monaco-editor/react"
import { Dispatch, SetStateAction } from "react"
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material"
import SaveRounded from "@mui/icons-material/SaveRounded"
import PublishRounded from "@mui/icons-material/PublishRounded"
import ScienceRounded from "@mui/icons-material/ScienceRounded"
import AddRounded from "@mui/icons-material/AddRounded"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"
import UploadFileRounded from "@mui/icons-material/UploadFileRounded"
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import { EditorCodePreview } from "@/features/custom-tools/EditorCodePreview"
import type { ProjectRow, ToolClassRow, ToolForm, ToolVersionRow } from "@/features/custom-tools/types"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type JsonFieldName = "inputSchemaText" | "outputSchemaText" | "secretsText" | "testArgsText"

type RuntimeTemplate = {
    id: string
    name: string
    description?: string
}

type CustomToolEditorCardProps = {
    form: ToolForm
    setForm: Dispatch<SetStateAction<ToolForm>>
    projects: ProjectRow[]
    toolClasses: ToolClassRow[]
    versions: ToolVersionRow[]
    busy: boolean
    runtimeTemplates: RuntimeTemplate[]
    templateId: string
    setTemplateId: (value: string) => void
    codeLanguage: "python" | "typescript" | "json"
    versionCodeLoading: boolean
    selectedVersionCode: number
    setSelectedVersionCode: (value: number) => void
    selectedVersionCodeRow: ToolVersionRow | null
    testArgsText: string
    setTestArgsText: (value: string) => void
    testResult: string
    onCodeEditorMount: OnMount
    onApplyTemplate: () => void
    onFormatCode: () => void
    onFormatJsonField: (field: JsonFieldName) => void
    onCreateTool: () => void
    onUpdateTool: () => void
    onPublishLatest: () => void
    onAddVersion: (publish: boolean) => void
    onRefreshVersionCodes: () => void
    onLoadSelectedVersionIntoEditor: () => void
    onRunTest: () => void
}

export function CustomToolEditorCard({
    form,
    setForm,
    projects,
    toolClasses,
    versions,
    busy,
    runtimeTemplates,
    templateId,
    setTemplateId,
    codeLanguage,
    versionCodeLoading,
    selectedVersionCode,
    setSelectedVersionCode,
    selectedVersionCodeRow,
    testArgsText,
    setTestArgsText,
    testResult,
    onCodeEditorMount,
    onApplyTemplate,
    onFormatCode,
    onFormatJsonField,
    onCreateTool,
    onUpdateTool,
    onPublishLatest,
    onAddVersion,
    onRefreshVersionCodes,
    onLoadSelectedVersionIntoEditor,
    onRunTest,
}: CustomToolEditorCardProps) {
    return (
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
                        <FormControl size="small" fullWidth sx={{ gridColumn: { xs: "auto", md: "1 / span 2" } }}>
                            <InputLabel id="tool-class-label">Tool Class</InputLabel>
                            <Select
                                labelId="tool-class-label"
                                label="Tool Class"
                                value={form.classKey || ""}
                                onChange={(e) => setForm((f) => ({ ...f, classKey: String(e.target.value || "") }))}
                            >
                                <MenuItem value="">Uncategorized (custom/uncategorized)</MenuItem>
                                {toolClasses
                                    .filter((row) => row.key !== "custom.uncategorized")
                                    .map((row) => (
                                        <MenuItem key={row.key} value={row.key}>
                                            {row.path || row.key}
                                        </MenuItem>
                                    ))}
                            </Select>
                        </FormControl>
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
                                    <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => onFormatJsonField("inputSchemaText")}>
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
                                    <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => onFormatJsonField("outputSchemaText")}>
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
                                <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => onFormatJsonField("secretsText")}>
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
                            onClick={() => void (form.id ? onUpdateTool() : onCreateTool())}
                            disabled={busy || !form.name.trim()}
                        >
                            {form.id ? "Save Tool" : "Create Tool"}
                        </Button>
                        {form.id && (
                            <Button variant="outlined" startIcon={<PublishRounded />} onClick={() => void onPublishLatest()} disabled={busy}>
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
                            <Button variant="outlined" startIcon={<UploadFileRounded />} onClick={onApplyTemplate} disabled={!templateId}>
                                Apply Template
                            </Button>
                            <Button variant="outlined" startIcon={<AutoFixHighRounded />} onClick={onFormatCode}>
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
                                onMount={onCodeEditorMount}
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
                            onClick={() => void onAddVersion(false)}
                            disabled={busy || !form.id || !form.codeText.trim()}
                        >
                            Add Draft Version
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={<PublishRounded />}
                            onClick={() => void onAddVersion(true)}
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
                                onClick={() => void onRefreshVersionCodes()}
                                disabled={!form.id || versionCodeLoading}
                            >
                                Refresh Uploaded Code
                            </Button>
                            <Button
                                variant="outlined"
                                startIcon={<ContentCopyRounded />}
                                onClick={onLoadSelectedVersionIntoEditor}
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
                                <Button size="small" startIcon={<AutoFixHighRounded />} onClick={() => onFormatJsonField("testArgsText")}>
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
                        onClick={() => void onRunTest()}
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
    )
}
