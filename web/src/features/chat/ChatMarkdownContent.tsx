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
                "& p": { my: 0.7, lineHeight: 1.55 },
                "& ul, & ol": { my: 0.7, pl: 2.5 },
                "& li": { my: 0.3 },
                "& a": { color: "inherit", textDecoration: "underline" },
                "& img": {
                    maxWidth: "100%",
                    borderRadius: 1.5,
                    display: "block",
                    my: 1,
                },
                "& code": {
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "0.82em",
                    bgcolor: isUser ? "rgba(255,255,255,0.32)" : "rgba(148,163,184,0.16)",
                    px: 0.5,
                    borderRadius: 0.6,
                },
                "& pre": {
                    my: 1,
                    overflowX: "auto",
                    borderRadius: 1.2,
                    p: 1.1,
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

