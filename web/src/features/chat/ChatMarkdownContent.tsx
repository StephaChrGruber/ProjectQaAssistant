"use client"

import { Box } from "@mui/material"
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
                "& pre": {
                    my: 0.75,
                    overflowX: "auto",
                    borderRadius: 1,
                    p: 0.9,
                    bgcolor: isUser ? "rgba(0,0,0,0.22)" : "rgba(2,6,23,0.3)",
                },
                "& pre code": {
                    display: "block",
                    whiteSpace: "pre",
                },
            }}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
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

                        const match = /language-([a-zA-Z0-9_-]+)/.exec(className || "")
                        const language = normalizeLanguage(match?.[1] || "")
                        const tokens = tokenizeCode(content.replace(/\n$/, ""), language)
                        return (
                            <code className={className} {...rest}>
                                {tokens.map((t, tidx) => (
                                    <span key={tidx} style={{ color: tokenColor(t.kind, isUser) }}>
                                        {t.text}
                                    </span>
                                ))}
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
