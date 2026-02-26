"use client"

import React, { useCallback, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { Alert, Box, Button, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import type { WorkspaceOpenTab } from "@/features/workspace/types"
import { extLanguage } from "@/features/workspace/utils"
import type { editor as MonacoEditorNS } from "monaco-editor"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type CursorContext = {
  path: string
  cursor: { line: number; column: number } | null
  selectedText: string | null
}

type InlineSuggestionArgs = {
  path: string
  cursor: { line: number; column: number } | null
  selectedText: string | null
}

type EditorDiagnostic = {
  path: string
  line: number
  column?: number
  severity?: string
  message: string
}

type EditorTabsProps = {
  tabs: WorkspaceOpenTab[]
  activePath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChangeContent: (path: string, next: string) => void
  onCursorContextChange?: (ctx: CursorContext) => void
  onRequestInlineSuggestion?: (args: InlineSuggestionArgs) => Promise<string | null>
  diagnostics?: EditorDiagnostic[]
  focusLocation?: { path: string; line: number; column?: number; token: number } | null
  onSaveActive: () => void
  saving: boolean
  onOpenFullFile?: () => void
}

function tabLabel(tab: WorkspaceOpenTab): string {
  const parts = tab.path.split("/")
  const file = parts[parts.length - 1] || tab.path
  if (tab.dirty) return `${file} *`
  if (tab.draftDirty) return `${file} •`
  return file
}

export function EditorTabs({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onCursorContextChange,
  onRequestInlineSuggestion,
  diagnostics = [],
  focusLocation = null,
  onSaveActive,
  saving,
  onOpenFullFile,
}: EditorTabsProps) {
  const activeTab = tabs.find((tab) => tab.path === activePath) || null
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<any>(null)
  const inlineProviderRef = useRef<{ dispose: () => void } | null>(null)
  const cursorPosListenerRef = useRef<{ dispose: () => void } | null>(null)
  const cursorSelListenerRef = useRef<{ dispose: () => void } | null>(null)
  const activeTabRef = useRef<WorkspaceOpenTab | null>(activeTab)
  const onCursorContextChangeRef = useRef(onCursorContextChange)
  const onRequestInlineSuggestionRef = useRef(onRequestInlineSuggestion)
  const inlineReqRef = useRef(0)

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    onCursorContextChangeRef.current = onCursorContextChange
  }, [onCursorContextChange])

  useEffect(() => {
    onRequestInlineSuggestionRef.current = onRequestInlineSuggestion
  }, [onRequestInlineSuggestion])

  const emitCursorContext = useCallback(() => {
    const tab = activeTabRef.current
    const onCursor = onCursorContextChangeRef.current
    if (!tab || !onCursor) return
    const editor = editorRef.current
    if (!editor) return
    const position = editor.getPosition()
    const model = editor.getModel()
    const selection = editor.getSelection()
    let selectedText = ""
    if (model && selection) {
      selectedText = model.getValueInRange(selection)
    }
    onCursor({
      path: tab.path,
      cursor: position ? { line: position.lineNumber, column: position.column } : null,
      selectedText: selectedText || null,
    })
  }, [])

  useEffect(() => {
    if (!activeTab) return
    emitCursorContext()
  }, [activeTab, emitCursorContext])

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeTab) return
    const monaco = monacoRef.current
    const model = editorRef.current.getModel()
    if (!model) return
    const markers = diagnostics
      .filter((d) => d.path === activeTab.path)
      .map((d) => ({
        startLineNumber: Math.max(1, Number(d.line || 1)),
        startColumn: Math.max(1, Number(d.column || 1)),
        endLineNumber: Math.max(1, Number(d.line || 1)),
        endColumn: Math.max(2, Number(d.column || 1) + 1),
        message: String(d.message || ""),
        severity:
          String(d.severity || "").toLowerCase() === "error"
            ? monaco.MarkerSeverity.Error
            : String(d.severity || "").toLowerCase() === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
      }))
    monaco.editor.setModelMarkers(model, "workspace-diagnostics", markers)
  }, [activeTab, diagnostics])

  useEffect(() => {
    if (!focusLocation || !activeTab || focusLocation.path !== activeTab.path) return
    const editor = editorRef.current
    if (!editor) return
    const line = Math.max(1, Number(focusLocation.line || 1))
    const column = Math.max(1, Number(focusLocation.column || 1))
    editor.setPosition({ lineNumber: line, column })
    editor.revealLineInCenter(line)
    editor.focus()
  }, [activeTab, focusLocation])

  useEffect(() => {
    const monaco = monacoRef.current
    inlineProviderRef.current?.dispose()
    inlineProviderRef.current = null
    inlineReqRef.current += 1
    if (!monaco || !activeTab || !onRequestInlineSuggestionRef.current) return

    const language = activeTab.language || extLanguage(activeTab.path) || "plaintext"
    const provider = monaco.languages.registerInlineCompletionsProvider(language, {
      provideInlineCompletions: async () => {
        const activeEditor = editorRef.current
        const tab = activeTabRef.current
        const requestInline = onRequestInlineSuggestionRef.current
        if (!activeEditor || !tab || !requestInline) return { items: [], dispose: () => {} }
        const position = activeEditor.getPosition()
        const model = activeEditor.getModel()
        const selection = activeEditor.getSelection()
        const selectedText = model && selection ? model.getValueInRange(selection) : null
        const reqId = ++inlineReqRef.current
        const suggestion = await requestInline({
          path: tab.path,
          cursor: position ? { line: position.lineNumber, column: position.column } : null,
          selectedText: selectedText || null,
        })
        if (reqId !== inlineReqRef.current) {
          return { items: [], dispose: () => {} }
        }
        if (!suggestion || !position || !model) {
          return { items: [], dispose: () => {} }
        }
        return {
          items: [
            {
              insertText: suggestion,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
            },
          ],
          dispose: () => {},
        }
      },
      freeInlineCompletions: () => {},
    })
    inlineProviderRef.current = provider

    return () => {
      if (inlineProviderRef.current === provider) {
        inlineProviderRef.current = null
      }
      provider.dispose()
      inlineReqRef.current += 1
    }
  }, [activeTab, onRequestInlineSuggestion])

  useEffect(() => {
    return () => {
      cursorPosListenerRef.current?.dispose()
      cursorPosListenerRef.current = null
      cursorSelListenerRef.current?.dispose()
      cursorSelListenerRef.current = null
      inlineProviderRef.current?.dispose()
      inlineProviderRef.current = null
      inlineReqRef.current += 1
    }
  }, [])

  return (
    <Stack sx={{ minHeight: 0, flex: 1, height: "100%" }}>
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", minHeight: 36 }}>
        <Tabs
          value={activePath || false}
          onChange={(_e, value) => onSelectTab(String(value || ""))}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 34, flex: 1, "& .MuiTab-root": { minHeight: 34, fontSize: 12, textTransform: "none", px: 1.2 } }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.path}
              value={tab.path}
              label={
                <Stack direction="row" spacing={0.4} alignItems="center">
                  <span>{tabLabel(tab)}</span>
                  <IconButton
                    component="span"
                    size="small"
                    aria-label={`Close ${tab.path}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseTab(tab.path)
                    }}
                    sx={{ p: 0.1 }}
                  >
                    <CloseRounded sx={{ fontSize: 13 }} />
                  </IconButton>
                </Stack>
              }
            />
          ))}
        </Tabs>

        <Tooltip title="Save to repository">
          <span>
            <IconButton
              size="small"
              aria-label="Save active file"
              onClick={onSaveActive}
              disabled={!activeTab || saving || Boolean(activeTab?.readOnly)}
              sx={{ mr: 0.6 }}
            >
              <SaveRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {activeTab ? (
          <Stack sx={{ height: "100%" }}>
            {activeTab.readOnly && (
              <Box sx={{ p: 0.8 }}>
                <Alert
                  severity={activeTab.readOnlyReason === "binary_file" ? "warning" : "info"}
                  action={
                    activeTab.readOnlyReason === "large_file" && onOpenFullFile ? (
                      <Button color="inherit" size="small" onClick={onOpenFullFile}>
                        Open full file
                      </Button>
                    ) : undefined
                  }
                >
                  {activeTab.readOnlyReason === "binary_file"
                    ? "Binary files are read-only in workspace editor."
                    : "Large file opened as preview. Open full file to edit."}
                </Alert>
              </Box>
            )}
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <MonacoEditor
                height="100%"
                language={activeTab.language || extLanguage(activeTab.path)}
                theme="vs"
                value={activeTab.draftContent}
                onMount={(editor, monaco) => {
                  editorRef.current = editor
                  monacoRef.current = monaco
                  cursorPosListenerRef.current?.dispose()
                  cursorSelListenerRef.current?.dispose()
                  cursorPosListenerRef.current = editor.onDidChangeCursorPosition(() => emitCursorContext())
                  cursorSelListenerRef.current = editor.onDidChangeCursorSelection(() => emitCursorContext())
                  emitCursorContext()
                }}
                onChange={(value) => onChangeContent(activeTab.path, value || "")}
                options={{
                  minimap: { enabled: false },
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  lineHeight: 20,
                  wordWrap: "off",
                  smoothScrolling: true,
                  readOnly: Boolean(activeTab.readOnly),
                  inlineSuggest: { enabled: Boolean(onRequestInlineSuggestion) },
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </Box>
          </Stack>
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Open a file from the tree to start editing.
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  )
}
