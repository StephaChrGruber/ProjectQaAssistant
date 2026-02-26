"use client"

import { useMemo, useState } from "react"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import PsychologyRounded from "@mui/icons-material/PsychologyRounded"
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded"
import { Box, Chip, Collapse, IconButton, List, ListItem, ListItemText, Paper, Stack, Tooltip, Typography } from "@mui/material"
import type { ThinkingTrace, ThinkingTraceStep } from "@/features/chat/types"

type ThinkingTracePanelProps = {
  trace: ThinkingTrace | null | undefined
  live?: boolean
  defaultExpanded?: boolean
  compact?: boolean
  expanded?: boolean
  onToggle?: (next: boolean) => void
}

function formatDuration(ms?: number | null): string {
  const n = Number(ms || 0)
  if (!Number.isFinite(n) || n <= 0) return "0ms"
  if (n < 1000) return `${Math.round(n)}ms`
  return `${(n / 1000).toFixed(1)}s`
}

function statusColor(step: ThinkingTraceStep): "default" | "success" | "warning" | "error" | "info" {
  if (step.status === "ok") return "success"
  if (step.status === "error") return "error"
  if (step.status === "running") return "warning"
  return "info"
}

export function ThinkingTracePanel({
  trace,
  live = false,
  defaultExpanded = false,
  compact = false,
  expanded,
  onToggle,
}: ThinkingTracePanelProps) {
  const [localOpen, setLocalOpen] = useState(Boolean(defaultExpanded))
  const [copied, setCopied] = useState(false)
  const open = typeof expanded === "boolean" ? expanded : localOpen
  const steps = useMemo(() => (Array.isArray(trace?.steps) ? trace!.steps : []), [trace])
  if (!trace || steps.length === 0) return null

  const total = formatDuration(trace.total_duration_ms)
  const header = `Thinking (${steps.length} steps · ${total})`

  async function handleCopyTrace() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Ignore clipboard errors; panel remains usable.
    }
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 1.5,
        p: compact ? 0.6 : 0.8,
        bgcolor: "rgba(255,255,255,0.65)",
        borderColor: "rgba(15,23,42,0.12)",
      }}
    >
      <Stack direction="row" spacing={0.6} alignItems="center">
        <PsychologyRounded sx={{ fontSize: 16, color: "text.secondary" }} />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.04em" }}>
          {header}
        </Typography>
        {live && <Chip size="small" color="warning" label="Live" />}
        <Box sx={{ ml: "auto" }}>
          <Tooltip title={copied ? "Copied" : "Copy trace JSON"}>
            <IconButton size="small" onClick={handleCopyTrace}>
              <ContentCopyRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={open ? "Hide thinking" : "Show thinking"}>
            <IconButton
              size="small"
              onClick={() => {
                const next = !open
                if (onToggle) onToggle(next)
                else setLocalOpen(next)
              }}
            >
              <ExpandMoreRounded
                sx={{
                  fontSize: 18,
                  transform: open ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 120ms ease",
                }}
              />
            </IconButton>
          </Tooltip>
        </Box>
      </Stack>
      <Collapse in={open}>
        <List dense sx={{ py: 0.2 }}>
          {steps.map((step, idx) => (
            <ListItem key={`${step.id}-${idx}`} sx={{ px: 0.4, py: 0.2, alignItems: "flex-start" }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={0.6} alignItems="center" useFlexGap flexWrap="wrap">
                    <Chip size="small" color={statusColor(step)} label={step.kind} />
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {step.title}
                    </Typography>
                    {step.tool && <Chip size="small" variant="outlined" label={step.tool} />}
                    {step.duration_ms != null && (
                      <Typography variant="caption" color="text.secondary">
                        {formatDuration(step.duration_ms)}
                      </Typography>
                    )}
                  </Stack>
                }
                secondary={
                  step.summary ? (
                    <Typography variant="caption" color="text.secondary">
                      {step.summary}
                    </Typography>
                  ) : null
                }
              />
            </ListItem>
          ))}
        </List>
      </Collapse>
    </Paper>
  )
}
