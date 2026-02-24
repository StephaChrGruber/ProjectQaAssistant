"use client"

import { isValidElement } from "react"
import { Box, Typography } from "@mui/material"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { normalizeLanguage, tokenColor, tokenizeCode } from "@/features/chat/code-highlighting"

type Props = {
    value: string
    isUser: boolean
}

export function ChatMarkdownContent({ value, isUser }: Props) {
    return (
        <Box
            sx={{
                fontSize: "0.86rem",
                "& p": { my: 0.5, lineHeight: 1.48 },
                "& ul, & ol": { my: 0.5, pl: 2.2 },
                "& li": { my: 0.2 },
                "& a": { color: "inherit", textDecoration: "underline" },
                "& img": {
                    maxWidth: "100%",
                    borderRadius: 1.5,
                    display: "block",
                    my: 0.75,
                },
                "& code": {
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "0.8em",
                    bgcolor: isUser ? "rgba(255,255,255,0.32)" : "rgba(148,163,184,0.16)",
                    px: 0.45,
                    borderRadius: 0.6,
                },
                "& .chat-code-block": {
                    my: 0.75,
                    overflow: "hidden",
                    borderRadius: 1,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: isUser ? "rgba(0,0,0,0.22)" : "rgba(2,6,23,0.3)",
                },
                "& .chat-code-header": {
                    px: 0.8,
                    py: 0.35,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    bgcolor: isUser ? "rgba(255,255,255,0.09)" : "rgba(148,163,184,0.09)",
                },
                "& .chat-code-content": {
                    display: "block",
                    whiteSpace: "pre",
                    overflowX: "auto",
                    p: 0.9,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "0.82em",
                    lineHeight: 1.5,
                    bgcolor: "transparent",
                    borderRadius: 0,
                    px: 0.9,
                },
            }}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    pre(props: any) {
                        const child = Array.isArray(props.children) ? props.children[0] : props.children
                        if (!isValidElement(child)) {
                            return <Box component="pre">{props.children}</Box>
                        }
                        const className = String((child.props as any)?.className || "")
                        const match = /language-([a-zA-Z0-9_-]+)/.exec(className)
                        const rawLanguage = String(match?.[1] || "text").toLowerCase()
                        const language = normalizeLanguage(rawLanguage)
                        const content = String((child.props as any)?.children ?? "")
                        const tokens = tokenizeCode(content.replace(/\n$/, ""), language)
                        return (
                            <Box className="chat-code-block">
                                <Box className="chat-code-header">
                                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", fontSize: 10.5 }}>
                                        {rawLanguage}
                                    </Typography>
                                </Box>
                                <Box component="code" className={`chat-code-content ${className}`.trim()}>
                                    {tokens.map((t, tidx) => (
                                        <span key={tidx} style={{ color: tokenColor(t.kind, isUser) }}>
                                            {t.text}
                                        </span>
                                    ))}
                                </Box>
                            </Box>
                        )
                    },
                    code(props: any) {
                        const { inline, className, children, ...rest } = props
                        const content = String(children ?? "")
                        if (inline) {
                            return (
                                <code className={className} {...rest}>
                                    {children}
                                </code>
                            )
                        }
                        return (
                            <code className={className} {...rest}>
                                {content}
                            </code>
                        )
                    },
                }}
            >
                {value}
            </ReactMarkdown>
        </Box>
    )
}
