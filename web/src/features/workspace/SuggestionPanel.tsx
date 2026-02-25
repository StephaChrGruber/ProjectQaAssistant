"use client"

import { Box, Button, Stack, Switch, TextField, Typography } from "@mui/material"
import AutoFixHighRounded from "@mui/icons-material/AutoFixHighRounded"

type SuggestionPanelProps = {
  intent: string
  enableIdleSuggest: boolean
  busy: boolean
  summary: string | null
  onIntentChange: (next: string) => void
  onToggleIdleSuggest: (next: boolean) => void
  onSuggestNow: () => void
}

export function SuggestionPanel({
  intent,
  enableIdleSuggest,
  busy,
  summary,
  onIntentChange,
  onToggleIdleSuggest,
  onSuggestNow,
}: SuggestionPanelProps) {
  return (
    <Stack sx={{ borderLeft: "1px solid", borderColor: "divider", minHeight: 0, p: 1.1 }} spacing={1.1}>
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.04em" }}>
        AI SUGGESTIONS
      </Typography>
      <TextField
        size="small"
        label="Intent"
        value={intent}
        onChange={(e) => onIntentChange(e.target.value)}
        placeholder="What change should AI propose?"
        multiline
        minRows={3}
      />
      <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={0.6} alignItems="center">
          <Switch
            size="small"
            checked={enableIdleSuggest}
            onChange={(e) => onToggleIdleSuggest(e.target.checked)}
          />
          <Typography variant="caption" color="text.secondary">
            Idle suggest
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="contained"
          startIcon={<AutoFixHighRounded />}
          onClick={onSuggestNow}
          disabled={busy}
        >
          {busy ? "Suggesting..." : "Suggest"}
        </Button>
      </Stack>
      <Box
        sx={{
          mt: 0.6,
          p: 0.8,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "rgba(15,23,42,0.45)",
          minHeight: 80,
          maxHeight: 240,
          overflow: "auto",
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
          {summary || "No suggestion yet."}
        </Typography>
      </Box>
    </Stack>
  )
}
