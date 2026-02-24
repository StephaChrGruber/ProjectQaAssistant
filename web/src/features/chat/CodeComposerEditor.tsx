"use client"

import { useMemo, useRef, type ChangeEvent, type KeyboardEvent, type UIEvent } from "react"
import { Box, Typography } from "@mui/material"
import { normalizeLanguage, tokenColor, tokenizeCode } from "@/features/chat/code-highlighting"

type CodeComposerEditorProps = {
    value: string
    language: string
    disabled?: boolean
    placeholder?: string
    onChange: (next: string) => void
    onSubmit?: () => void
}

export function CodeComposerEditor({
    value,
    language,
    disabled = false,
    placeholder = "Write code here",
    onChange,
    onSubmit,
}: CodeComposerEditorProps) {
    const highlightRef = useRef<HTMLPreElement | null>(null)
    const normalizedLanguage = normalizeLanguage(language)

    const tokens = useMemo(() => tokenizeCode(value || "", normalizedLanguage), [value, normalizedLanguage])

    function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
        if (!highlightRef.current) return
        highlightRef.current.scrollTop = event.currentTarget.scrollTop
        highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault()
            onSubmit?.()
            return
        }
        if (event.key !== "Tab") return
        event.preventDefault()
        const target = event.currentTarget
        const start = target.selectionStart ?? 0
        const end = target.selectionEnd ?? 0
        const next = `${value.slice(0, start)}  ${value.slice(end)}`
        onChange(next)
        queueMicrotask(() => {
            target.selectionStart = start + 2
            target.selectionEnd = start + 2
        })
    }

    return (
        <Box
            sx={{
                position: "relative",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.2,
                backgroundColor: "rgba(2,6,23,0.34)",
                minHeight: 170,
                maxHeight: { xs: 280, sm: 340 },
                overflow: "hidden",
            }}
        >
            <Box
                ref={highlightRef}
                component="pre"
                aria-hidden
                sx={{
                    m: 0,
                    p: 1.1,
                    width: "100%",
                    height: "100%",
                    overflow: "auto",
                    whiteSpace: "pre",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    lineHeight: 1.45,
                    pointerEvents: "none",
                }}
            >
                {tokens.length === 0
                    ? "\u00a0"
                    : tokens.map((token, idx) => (
                          <span key={idx} style={{ color: tokenColor(token.kind, false) }}>
                              {token.text}
                          </span>
                      ))}
            </Box>

            {value.length === 0 && (
                <Typography
                    aria-hidden
                    sx={{
                        position: "absolute",
                        left: 12,
                        top: 10,
                        color: "text.disabled",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 13,
                        pointerEvents: "none",
                    }}
                >
                    {placeholder}
                </Typography>
            )}

            <Box
                component="textarea"
                spellCheck={false}
                wrap="off"
                value={value}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                sx={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    p: 1.1,
                    border: "none",
                    outline: "none",
                    resize: "none",
                    overflow: "auto",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    lineHeight: 1.45,
                    letterSpacing: 0,
                    color: "transparent",
                    caretColor: "text.primary",
                    background: "transparent",
                    "&::selection": {
                        backgroundColor: "rgba(59,130,246,0.28)",
                    },
                }}
            />
        </Box>
    )
}
