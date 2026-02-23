"use client"

import dynamic from "next/dynamic"
import { Paper } from "@mui/material"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

export function EditorCodePreview({
    code,
    language,
    minHeight = 260,
}: {
    code: string
    language: "python" | "typescript" | "json"
    minHeight?: number
}) {
    return (
        <Paper
            variant="outlined"
            sx={{
                minHeight,
                maxHeight: 520,
                overflow: "auto",
                borderStyle: "dashed",
            }}
        >
            <MonacoEditor
                height={`${Math.max(220, minHeight)}px`}
                language={language}
                value={code}
                theme="vs"
                options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    lineNumbersMinChars: 3,
                    fontSize: 13,
                }}
            />
        </Paper>
    )
}
