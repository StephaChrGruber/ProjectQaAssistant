"use client"

import type { RefObject, UIEvent } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Box, Button, CircularProgress, Collapse, Paper, Stack, Typography } from "@mui/material"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import type { ChatAnswerSource, ChatMessage } from "@/features/chat/types"
import {
    SOURCE_PREVIEW_LIMIT,
    isDocumentationPath,
    sourceDisplayText,
    splitChartBlocks,
} from "@/features/chat/utils"

const LazyMarkdown = dynamic(
    () => import("@/features/chat/ChatMarkdownContent").then((m) => m.ChatMarkdownContent),
    { ssr: false }
)

const LazyChart = dynamic(
    () => import("@/features/chat/ChatChartBlock").then((m) => m.ChatChartBlock),
    { ssr: false }
)

const VIRTUALIZE_THRESHOLD = 100
const ESTIMATED_ROW_HEIGHT = 280
const OVERSCAN_ROWS = 6

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

function computeWindow(scrollTop: number, viewportHeight: number, total: number): { start: number; end: number } {
    const firstVisible = Math.max(0, Math.floor(scrollTop / ESTIMATED_ROW_HEIGHT))
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / ESTIMATED_ROW_HEIGHT))
    const start = Math.max(0, firstVisible - OVERSCAN_ROWS)
    const end = Math.min(total, firstVisible + visibleCount + OVERSCAN_ROWS)
    return { start, end }
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
    const shouldVirtualize = messages.length > VIRTUALIZE_THRESHOLD
    const [windowStart, setWindowStart] = useState(0)
    const [windowEnd, setWindowEnd] = useState(messages.length)

    const recomputeWindow = useCallback(
        (scrollTop: number, viewportHeight: number) => {
            if (!shouldVirtualize) {
                setWindowStart(0)
                setWindowEnd(messages.length)
                return
            }
            const next = computeWindow(scrollTop, viewportHeight, messages.length)
            setWindowStart((prev) => (prev === next.start ? prev : next.start))
            setWindowEnd((prev) => (prev === next.end ? prev : next.end))
        },
        [messages.length, shouldVirtualize]
    )

    useEffect(() => {
        if (!shouldVirtualize) {
            setWindowStart(0)
            setWindowEnd(messages.length)
            return
        }
        const el = scrollRef.current
        if (!el) {
            setWindowStart(0)
            setWindowEnd(Math.min(messages.length, 24))
            return
        }
        recomputeWindow(el.scrollTop, el.clientHeight)
    }, [messages.length, recomputeWindow, scrollRef, shouldVirtualize])

    const handleScroll = useCallback(
        (event: UIEvent<HTMLDivElement>) => {
            if (!shouldVirtualize) return
            const el = event.currentTarget
            recomputeWindow(el.scrollTop, el.clientHeight)
        },
        [recomputeWindow, shouldVirtualize]
    )

    const renderStart = shouldVirtualize ? windowStart : 0
    const renderEnd = shouldVirtualize ? windowEnd : messages.length

    const visibleMessages = useMemo(
        () => messages.slice(renderStart, renderEnd),
        [messages, renderEnd, renderStart]
    )

    const topSpacerHeight = shouldVirtualize ? renderStart * ESTIMATED_ROW_HEIGHT : 0
    const bottomSpacerHeight = shouldVirtualize ? Math.max(0, (messages.length - renderEnd) * ESTIMATED_ROW_HEIGHT) : 0

    return (
        <Box
            ref={scrollRef}
            onScroll={handleScroll}
            sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 1.1, md: 3.2 }, py: { xs: 1.25, md: 2.1 } }}
        >
            <Stack spacing={1.4} sx={{ maxWidth: 1060, mx: "auto" }}>
                {booting && (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            display: "flex",
                            alignItems: "center",
                            gap: 1.2,
                            borderRadius: 2,
                            bgcolor: "rgba(15,23,42,0.52)",
                        }}
                    >
                        <CircularProgress size={18} />
                        <Typography variant="body2">Loading workspace...</Typography>
                    </Paper>
                )}

                {!booting && !loadingMessages && messages.length === 0 && (
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2.2,
                            borderRadius: 2,
                            background: "linear-gradient(150deg, rgba(15,23,42,0.62), rgba(15,23,42,0.42))",
                        }}
                    >
                        <Typography variant="body2" color="text.secondary">
                            Start with a question about this project. The assistant can use GitHub/Bitbucket/Azure DevOps,
                            local repository, Confluence, and Jira context.
                        </Typography>
                    </Paper>
                )}

                {topSpacerHeight > 0 && <Box sx={{ height: topSpacerHeight }} />}

                {visibleMessages.map((m, localIdx) => {
                    const idx = renderStart + localIdx
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
                                elevation={isUser ? 2 : 0}
                                sx={{
                                    maxWidth: { xs: "97%", sm: "92%" },
                                    px: { xs: 1.5, sm: 2 },
                                    py: { xs: 1.1, sm: 1.4 },
                                    borderRadius: 2.4,
                                    border: "1px solid",
                                    borderColor: isUser ? "rgba(103,232,249,0.42)" : "divider",
                                    bgcolor: isUser ? "transparent" : "rgba(15,23,42,0.45)",
                                    background: isUser
                                        ? "linear-gradient(135deg, rgba(34,211,238,0.95) 0%, rgba(52,211,153,0.9) 100%)"
                                        : "linear-gradient(160deg, rgba(15,23,42,0.68), rgba(15,23,42,0.45))",
                                    color: isUser ? "#04231c" : "text.primary",
                                    boxShadow: isUser ? "0 10px 20px rgba(15,23,42,0.3)" : "none",
                                    animation: "page-rise 220ms ease-out both",
                                }}
                            >
                                <Stack spacing={1}>
                                    {splitChartBlocks(m.content || "").map((part, i) =>
                                        part.type === "chart" ? (
                                            <LazyChart key={`${messageKey}-part-${i}`} value={part.value} />
                                        ) : (
                                            <LazyMarkdown key={`${messageKey}-part-${i}`} value={part.value} isUser={isUser} />
                                        )
                                    )}

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
                                                                        fontSize: 12.25,
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
                                                                fontSize: 12.25,
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

                {bottomSpacerHeight > 0 && <Box sx={{ height: bottomSpacerHeight }} />}

                {(sending || loadingMessages) && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                        <Paper
                            variant="outlined"
                            sx={{
                                px: 1.6,
                                py: 1,
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                borderRadius: 2,
                                bgcolor: "rgba(15,23,42,0.55)",
                            }}
                        >
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
