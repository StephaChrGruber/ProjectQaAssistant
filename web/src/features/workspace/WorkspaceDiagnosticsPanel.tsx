"use client"

import { useMemo, useState } from "react"
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import ClearRounded from "@mui/icons-material/ClearRounded"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ExpandLessRounded from "@mui/icons-material/ExpandLessRounded"
import type { WorkspaceDiagnostic } from "@/features/workspace/types"

type DiagnosticsPanelProps = {
  open: boolean
  diagnostics: WorkspaceDiagnostic[]
  running: boolean
  onToggleOpen: () => void
  onRerun: () => void
  onClear: () => void
  onSelectDiagnostic: (marker: WorkspaceDiagnostic) => void
}

type SeverityFilter = "all" | "error" | "warning" | "info"

function markerSeverity(marker: WorkspaceDiagnostic): "error" | "warning" | "info" {
  const raw = String(marker.severity || "").toLowerCase()
  if (raw === "error") return "error"
  if (raw === "warning") return "warning"
  return "info"
}

export function WorkspaceDiagnosticsPanel({
  open,
  diagnostics,
  running,
  onToggleOpen,
  onRerun,
  onClear,
  onSelectDiagnostic,
}: DiagnosticsPanelProps) {
  const [filter, setFilter] = useState<SeverityFilter>("all")

  const counts = useMemo(() => {
    const out = { error: 0, warning: 0, info: 0 }
    for (const marker of diagnostics) {
      out[markerSeverity(marker)] += 1
    }
    return out
  }, [diagnostics])

  const filtered = useMemo(() => {
    if (filter === "all") return diagnostics
    return diagnostics.filter((m) => markerSeverity(m) === filter)
  }, [diagnostics, filter])

  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", minHeight: 0, maxHeight: open ? 260 : 46, display: "flex", flexDirection: "column" }}>
      <Stack direction="row" alignItems="center" spacing={0.7} sx={{ px: 1, py: 0.55, borderBottom: open ? "1px solid" : "none", borderColor: "divider" }}>
        <IconButton size="small" onClick={onToggleOpen}>
          {open ? <ExpandMoreRounded fontSize="small" /> : <ExpandLessRounded fontSize="small" />}
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          Diagnostics
        </Typography>
        <Chip size="small" label={`E ${counts.error}`} color={counts.error ? "error" : "default"} />
        <Chip size="small" label={`W ${counts.warning}`} color={counts.warning ? "warning" : "default"} />
        <Chip size="small" label={`I ${counts.info}`} color={counts.info ? "info" : "default"} />
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.7 }}>
          {open && (
            <Select
              size="small"
              value={filter}
              onChange={(e) => setFilter(String(e.target.value || "all") as SeverityFilter)}
              sx={{ minWidth: 112 }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="error">Errors</MenuItem>
              <MenuItem value="warning">Warnings</MenuItem>
              <MenuItem value="info">Info</MenuItem>
            </Select>
          )}
          <Button size="small" variant="outlined" startIcon={<RefreshRounded />} onClick={onRerun} disabled={running}>
            {running ? "Running..." : "Rerun"}
          </Button>
          <Button size="small" variant="outlined" startIcon={<ClearRounded />} onClick={onClear} disabled={!diagnostics.length}>
            Clear
          </Button>
        </Box>
      </Stack>
      {open && (
        <List dense disablePadding sx={{ minHeight: 0, overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <Box sx={{ px: 1.2, py: 1 }}>
              <Typography variant="caption" color="text.secondary">
                No diagnostics for the selected filter.
              </Typography>
            </Box>
          ) : (
            filtered.map((marker, idx) => {
              const severity = markerSeverity(marker)
              return (
                <ListItemButton
                  key={`${marker.path}:${marker.line}:${marker.column || 1}:${idx}`}
                  onClick={() => onSelectDiagnostic(marker)}
                  sx={{ alignItems: "flex-start", py: 0.55 }}
                >
                  <ListItemText
                    primary={`${marker.path}:${Math.max(1, Number(marker.line || 1))}:${Math.max(1, Number(marker.column || 1))}`}
                    secondary={marker.message || ""}
                    primaryTypographyProps={{ noWrap: true, fontSize: 12 }}
                    secondaryTypographyProps={{
                      noWrap: true,
                      fontSize: 11,
                      color: severity === "error" ? "error.main" : severity === "warning" ? "warning.main" : "text.secondary",
                    }}
                  />
                </ListItemButton>
              )
            })
          )}
        </List>
      )}
    </Box>
  )
}
