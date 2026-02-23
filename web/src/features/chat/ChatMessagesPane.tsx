"use client"

import type { RefObject } from "react"
import { Box, Button, CircularProgress, Collapse, Paper, Stack, Typography } from "@mui/material"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"
import { normalizeLanguage, tokenColor, tokenizeCode } from "@/features/chat/code-highlighting"
import type { ChatAnswerSource, ChatMessage } from "@/features/chat/types"
import {
    SOURCE_PREVIEW_LIMIT,
    isDocumentationPath,
    parseChartSpec,
    sourceDisplayText,
    splitChartBlocks,
} from "@/features/chat/utils"

type ChatMessagesPaneProps = {
    booting: boolean
    loadingMessages: boolean
    sending: boolean
    messages: ChatMessage[]
    expandedSourceMessages: Record<string, boolean>
    onToggleSourceList: (messageKey: string) => void
    onSourceClick: (src: ChatAnswerSource) => void | Promise<void>
    scrollRef: RefObject<HTMLDivElement | null>
}

export function ChatMessagesPane({
    booting,
    loadingMessages,
    sending,
    messages,
    expandedSourceMessages,
    onToggleSourceList,
    onSourceClick,
    scrollRef,
}: ChatMessagesPaneProps) {
    return (
        <Box
            ref={scrollRef}
            sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 1.25, md: 4 }, py: { xs: 1.6, md: 2.5 } }}
        >
            <Stack spacing={1.5} sx={{ maxWidth: 980, mx: "auto" }}>
                {booting && (
                    <Paper variant="outlined" sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.2 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Loading workspace...</Typography>
                    </Paper>
                )}

                {!booting && !loadingMessages && messages.length === 0 && (
                    <Paper variant="outlined" sx={{ p: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            Start with a question about this project. The assistant can use GitHub/Bitbucket/Azure DevOps,
                            local repository, Confluence, and Jira context.
                        </Typography>
                    </Paper>
                )}

                {messages.map((m, idx) => {
                    const isUser = m.role === "user"
                    const sources = !isUser && m.role === "assistant" ? (m.meta?.sources || []) : []
                    const messageKey = `${m.ts || "na"}-${idx}`
                    const sourceExpanded = Boolean(expandedSourceMessages[messageKey])
                    const hasManySources = sources.length > SOURCE_PREVIEW_LIMIT
                    const previewSources = hasManySources ? sources.slice(0, SOURCE_PREVIEW_LIMIT) : sources
                    const hiddenSources = hasManySources ? sources.slice(SOURCE_PREVIEW_LIMIT) : []
                    return (
                        <Box key={messageKey} sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                            <Paper
                                variant={isUser ? "elevation" : "outlined"}
                                elevation={isUser ? 3 : 0}
                                sx={{
                                    maxWidth: { xs: "96%", sm: "92%" },
                                    px: { xs: 1.5, sm: 2 },
                                    py: { xs: 1.1, sm: 1.4 },
                                    borderRadius: 3,
                                    bgcolor: isUser ? "primary.main" : "background.paper",
                                    color: isUser ? "primary.contrastText" : "text.primary",
                                }}
                            >
                                <Stack spacing={1}>
                                    {splitChartBlocks(m.content || "").map((part, i) => {
                                        if (part.type === "chart") {
                                            const spec = parseChartSpec(part.value)
                                            return (
                                                <Paper key={i} variant="outlined" sx={{ p: 1.2, bgcolor: "rgba(0,0,0,0.16)" }}>
                                                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.12em" }}>
                                                        CHART BLOCK
                                                    </Typography>
                                                    {spec ? (
                                                        <Box sx={{ mt: 1.1, width: "100%", minWidth: 280 }}>
                                                            {spec.title && (
                                                                <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                                                                    {spec.title}
                                                                </Typography>
                                                            )}
                                                            <ResponsiveContainer width="100%" height={spec.height || 280}>
                                                                {spec.type === "bar" ? (
                                                                    <BarChart data={spec.data}>
                                                                        <CartesianGrid strokeDasharray="3 3" />
                                                                        <XAxis dataKey={spec.xKey} />
                                                                        <YAxis />
                                                                        <Tooltip />
                                                                        <Legend />
                                                                        {spec.series.map((s, sidx) => (
                                                                            <Bar
                                                                                key={s.key}
                                                                                dataKey={s.key}
                                                                                name={s.label || s.key}
                                                                                fill={s.color || ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][sidx % 4]}
                                                                            />
                                                                        ))}
                                                                    </BarChart>
                                                                ) : (
                                                                    <LineChart data={spec.data}>
                                                                        <CartesianGrid strokeDasharray="3 3" />
                                                                        <XAxis dataKey={spec.xKey} />
                                                                        <YAxis />
                                                                        <Tooltip />
                                                                        <Legend />
                                                                        {spec.series.map((s, sidx) => (
                                                                            <Line
                                                                                key={s.key}
                                                                                type="monotone"
                                                                                dataKey={s.key}
                                                                                name={s.label || s.key}
                                                                                stroke={s.color || ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][sidx % 4]}
                                                                                strokeWidth={2}
                                                                                dot={false}
                                                                            />
                                                                        ))}
                                                                    </LineChart>
                                                                )}
                                                            </ResponsiveContainer>
                                                        </Box>
                                                    ) : (
                                                        <Box
                                                            component="pre"
                                                            sx={{
                                                                mt: 0.8,
                                                                mb: 0,
                                                                overflowX: "auto",
                                                                whiteSpace: "pre",
                                                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                                fontSize: 12,
                                                            }}
                                                        >
                                                            {part.value}
                                                        </Box>
                                                    )}
                                                </Paper>
                                            )
                                        }

                                        return (
                                            <Box
                                                key={i}
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
                                                        bgcolor: isUser ? "rgba(255,255,255,0.2)" : "action.hover",
                                                        px: 0.5,
                                                        borderRadius: 0.6,
                                                    },
                                                    "& pre": {
                                                        my: 1,
                                                        overflowX: "auto",
                                                        borderRadius: 1.2,
                                                        p: 1.1,
                                                        bgcolor: isUser ? "rgba(0,0,0,0.22)" : "rgba(2,6,23,0.06)",
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
                                                    {part.value}
                                                </ReactMarkdown>
                                            </Box>
                                        )
                                    })}

                                    {!isUser && m.role === "assistant" && (
                                        <Box
                                            sx={{
                                                mt: 0.4,
                                                pt: 0.9,
                                                borderTop: "1px solid",
                                                borderColor: "divider",
                                            }}
                                        >
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{ letterSpacing: "0.08em", display: "block", mb: 0.6 }}
                                            >
                                                SOURCES
                                            </Typography>
                                            {m.meta?.grounded === false && (
                                                <Typography variant="caption" color="warning.main" sx={{ display: "block", mb: 0.6 }}>
                                                    Grounding check failed for this answer.
                                                </Typography>
                                            )}
                                            <Stack spacing={0.2}>
                                                {sources.length > 0 ? (
                                                    previewSources.map((src, sidx) => {
                                                        const clickable = Boolean(
                                                            (src.url && /^https?:\/\//i.test(src.url)) ||
                                                            isDocumentationPath(src.path)
                                                        )
                                                        const confidence =
                                                            typeof src.confidence === "number"
                                                                ? Math.max(0, Math.min(100, Math.round(src.confidence * 100)))
                                                                : null
                                                        return (
                                                            <Box key={`${sourceDisplayText(src)}-${sidx}`} sx={{ py: 0.2 }}>
                                                                <Button
                                                                    variant="text"
                                                                    size="small"
                                                                    onClick={() => {
                                                                        void onSourceClick(src)
                                                                    }}
                                                                    disabled={!clickable}
                                                                    sx={{
                                                                        justifyContent: "flex-start",
                                                                        textTransform: "none",
                                                                        px: 0,
                                                                        minHeight: "auto",
                                                                        fontSize: 12,
                                                                        lineHeight: 1.35,
                                                                    }}
                                                                >
                                                                    {sourceDisplayText(src)}
                                                                    {confidence !== null ? ` (${confidence}%)` : ""}
                                                                </Button>
                                                                {src.snippet ? (
                                                                    <Typography
                                                                        variant="caption"
                                                                        color="text.secondary"
                                                                        sx={{ display: "block", lineHeight: 1.3, pl: 0.1 }}
                                                                    >
                                                                        {src.snippet}
                                                                    </Typography>
                                                                ) : null}
                                                            </Box>
                                                        )
                                                    })
                                                ) : (
                                                    <Typography variant="caption" color="text.secondary">
                                                        No explicit sources were captured for this answer.
                                                    </Typography>
                                                )}
                                                {hasManySources && (
                                                    <>
                                                        <Collapse in={sourceExpanded} timeout="auto" unmountOnExit>
                                                            <Stack spacing={0.2}>
                                                                {hiddenSources.map((src, sidx) => {
                                                                    const clickable = Boolean(
                                                                        (src.url && /^https?:\/\//i.test(src.url)) ||
                                                                        isDocumentationPath(src.path)
                                                                    )
                                                                    const confidence =
                                                                        typeof src.confidence === "number"
                                                                            ? Math.max(0, Math.min(100, Math.round(src.confidence * 100)))
                                                                            : null
                                                                    return (
                                                                        <Box key={`${sourceDisplayText(src)}-hidden-${sidx}`} sx={{ py: 0.2 }}>
                                                                            <Button
                                                                                variant="text"
                                                                                size="small"
                                                                                onClick={() => {
                                                                                    void onSourceClick(src)
                                                                                }}
                                                                                disabled={!clickable}
                                                                                sx={{
                                                                                    justifyContent: "flex-start",
                                                                                    textTransform: "none",
                                                                                    px: 0,
                                                                                    minHeight: "auto",
                                                                                    fontSize: 12,
                                                                                    lineHeight: 1.35,
                                                                                }}
                                                                            >
                                                                                {sourceDisplayText(src)}
                                                                                {confidence !== null ? ` (${confidence}%)` : ""}
                                                                            </Button>
                                                                            {src.snippet ? (
                                                                                <Typography
                                                                                    variant="caption"
                                                                                    color="text.secondary"
                                                                                    sx={{ display: "block", lineHeight: 1.3, pl: 0.1 }}
                                                                                >
                                                                                    {src.snippet}
                                                                                </Typography>
                                                                            ) : null}
                                                                        </Box>
                                                                    )
                                                                })}
                                                            </Stack>
                                                        </Collapse>
                                                        <Button
                                                            variant="text"
                                                            size="small"
                                                            onClick={() => onToggleSourceList(messageKey)}
                                                            endIcon={
                                                                sourceExpanded ? (
                                                                    <ExpandMoreRounded fontSize="small" />
                                                                ) : (
                                                                    <ChevronRightRounded fontSize="small" />
                                                                )
                                                            }
                                                            sx={{
                                                                justifyContent: "flex-start",
                                                                textTransform: "none",
                                                                px: 0,
                                                                minHeight: "auto",
                                                                mt: 0.2,
                                                                fontSize: 12,
                                                                lineHeight: 1.35,
                                                            }}
                                                        >
                                                            {sourceExpanded
                                                                ? `Show less (${sources.length} total)`
                                                                : `Show ${hiddenSources.length} more (${sources.length} total)`}
                                                        </Button>
                                                    </>
                                                )}
                                            </Stack>
                                        </Box>
                                    )}
                                </Stack>
                            </Paper>
                        </Box>
                    )
                })}

                {(sending || loadingMessages) && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                        <Paper variant="outlined" sx={{ px: 1.6, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                            <CircularProgress size={16} />
                            <Typography variant="body2" color="text.secondary">
                                Thinking...
                            </Typography>
                        </Paper>
                    </Box>
                )}
            </Stack>
        </Box>
    )
}
