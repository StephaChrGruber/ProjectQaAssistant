"use client"

import dynamic from "next/dynamic"
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import type { OnMount } from "@monaco-editor/react"
import type { editor as MonacoEditorNS } from "monaco-editor"
import { Box } from "@mui/material"

type CodeComposerEditorProps = {
    value: string
    language: string
    disabled?: boolean
    placeholder?: string
    slashCommands?: SlashCommand[]
    onChange: (next: string) => void
    onSubmit?: () => void
}

export type SlashCommand = {
    command: string
    description: string
    template: string
}

export type CodeComposerEditorHandle = {
    focus: () => void
    insertSnippetAtCursor: (snippet: string, cursorOffset?: number) => void
}

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

export const CodeComposerEditor = forwardRef<CodeComposerEditorHandle, CodeComposerEditorProps>(function CodeComposerEditor(
    {
        value,
        language,
        disabled = false,
        placeholder = "Write code here",
        slashCommands = [],
        onChange,
        onSubmit,
    }: CodeComposerEditorProps,
    ref
) {
    const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
    const completionProviderRef = useRef<{ dispose: () => void } | null>(null)
    const slashCommandsRef = useRef<SlashCommand[]>(slashCommands)
    slashCommandsRef.current = slashCommands

    const expandTemplate = (template: string, indent: string, keepMarker = false) => {
        const marker = "__CURSOR__"
        const withIndent = template
            .split("\n")
            .map((line) => (line.length ? `${indent}${line}` : line))
            .join("\n")
        const markerIndex = withIndent.indexOf(marker)
        if (markerIndex < 0) return { text: withIndent, cursorOffset: withIndent.length }
        return {
            text: keepMarker ? withIndent : withIndent.replace(marker, ""),
            cursorOffset: markerIndex,
        }
    }

    const tryExpandSlashCommand = (
        editor: MonacoEditorNS.IStandaloneCodeEditor,
        monaco: any
    ): boolean => {
        const model = editor.getModel()
        const position = editor.getPosition()
        const activeCommands = slashCommandsRef.current || []
        if (!model || !position || !activeCommands.length) return false
        const lineNumber = position.lineNumber
        const lineText = model.getLineContent(lineNumber)
        const match = lineText.match(/^(\s*)\/([a-zA-Z][a-zA-Z0-9_-]*)\s*$/)
        if (!match) return false
        const indent = match[1] || ""
        const name = String(match[2] || "").toLowerCase()
        const cmd = activeCommands.find((c) => c.command.toLowerCase() === name)
        if (!cmd) return false
        const expanded = expandTemplate(cmd.template, indent)
        const range = new monaco.Range(lineNumber, 1, lineNumber, lineText.length + 1)
        editor.executeEdits("code-composer-slash-expand", [{ range, text: expanded.text, forceMoveMarkers: true }])
        const startOffset = model.getOffsetAt({ lineNumber, column: 1 })
        const cursor = model.getPositionAt(startOffset + expanded.cursorOffset)
        editor.setPosition(cursor)
        editor.focus()
        return true
    }

    const handleMount: OnMount = (editor, monaco) => {
        editorRef.current = editor
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onSubmit?.())
        editor.addCommand(
            monaco.KeyCode.Enter,
            () => {
                if (tryExpandSlashCommand(editor, monaco)) return
                editor.trigger("keyboard", "type", { text: "\n" })
            },
            "!suggestWidgetVisible && !inSnippetMode"
        )

        if (language) {
            completionProviderRef.current?.dispose()
            completionProviderRef.current = monaco.languages.registerCompletionItemProvider(language, {
                triggerCharacters: ["/"],
                provideCompletionItems(model: any, position: any) {
                    const activeCommands = slashCommandsRef.current || []
                    if (!activeCommands.length) return { suggestions: [] }
                    const fullLine = String(model.getLineContent(position.lineNumber) || "")
                    const before = fullLine.slice(0, position.column - 1)
                    const match = before.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/)
                    if (!match) return { suggestions: [] }

                    const leading = match[1] || ""
                    const typed = String(match[2] || "").toLowerCase()
                    const wordStart = position.column - typed.length - 1
                    const range = new monaco.Range(position.lineNumber, wordStart, position.lineNumber, position.column)

                    const suggestions = activeCommands
                        .filter((cmd) => cmd.command.toLowerCase().startsWith(typed))
                        .map((cmd, idx) => {
                            const expanded = expandTemplate(cmd.template, leading, true)
                            const snippetText = expanded.text.replace("__CURSOR__", "$0")
                            return {
                                label: `/${cmd.command}`,
                                kind: monaco.languages.CompletionItemKind.Snippet,
                                detail: cmd.description,
                                sortText: `0${idx}`,
                                documentation: `${cmd.description}`,
                                insertText: snippetText,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                range,
                            }
                        })
                    return { suggestions }
                },
            })
        }
    }

    useEffect(() => {
        return () => {
            editorRef.current = null
            completionProviderRef.current?.dispose()
            completionProviderRef.current = null
        }
    }, [])

    useImperativeHandle(
        ref,
        () => ({
            focus() {
                editorRef.current?.focus()
            },
            insertSnippetAtCursor(snippet: string, cursorOffset?: number) {
                const editor = editorRef.current
                if (!editor || disabled) return
                const model = editor.getModel()
                const selection = editor.getSelection()
                if (!model || !selection) return
                editor.executeEdits("code-composer-insert-snippet", [{ range: selection, text: snippet, forceMoveMarkers: true }])
                const nextOffset = Math.max(0, Number(cursorOffset || 0))
                const pos = model.getPositionAt(model.getOffsetAt(selection.getStartPosition()) + nextOffset)
                editor.setPosition(pos)
                editor.focus()
            },
        }),
        [disabled]
    )

    return (
        <Box
            onClick={() => editorRef.current?.focus()}
            sx={{
                position: "relative",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.2,
                backgroundColor: "rgba(255,255,255,0.98)",
                height: { xs: 190, sm: 220 },
                overflow: "hidden",
            }}
        >
            <MonacoEditor
                height="100%"
                language={language || "plaintext"}
                theme="vs"
                value={value}
                onMount={handleMount}
                onChange={(next) => onChange(next || "")}
                options={{
                    readOnly: disabled,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    fontSize: 13,
                    lineHeight: 20,
                    lineNumbers: "off",
                    folding: false,
                    glyphMargin: false,
                    lineDecorationsWidth: 0,
                    overviewRulerLanes: 0,
                    bracketPairColorization: { enabled: true },
                    renderLineHighlight: "none",
                    padding: { top: 10, bottom: 10 },
                    scrollbar: {
                        verticalScrollbarSize: 8,
                        horizontalScrollbarSize: 8,
                    },
                    ...(placeholder ? ({ placeholder } as any) : {}),
                }}
            />
        </Box>
    )
})
