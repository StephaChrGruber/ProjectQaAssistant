"use client"

import { useMemo } from "react"
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material"
import type { WorkspacePatch } from "@/features/workspace/types"
import { selectedHunksMap } from "@/features/workspace/utils"

type PatchReviewDrawerProps = {
  open: boolean
  patch: WorkspacePatch | null
  selected: Record<string, Set<number>>
  applying: boolean
  onClose: () => void
  onToggleHunk: (path: string, hunkId: number, checked: boolean) => void
  onApply: () => void
}

export function PatchReviewDrawer({
  open,
  patch,
  selected,
  applying,
  onClose,
  onToggleHunk,
  onApply,
}: PatchReviewDrawerProps) {
  const selectedCount = useMemo(() => selectedHunksMap(patch?.files || [], selected), [patch?.files, selected])

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", md: 480 } } }}>
      <Stack sx={{ height: "100%", minHeight: 0 }}>
        <Box sx={{ px: 1.2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Patch Review
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {patch ? `${patch.changed_files} file(s), ${patch.changed_hunks} hunk(s)` : "No patch loaded"}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.1 }}>
          {!patch?.files?.length ? (
            <Typography variant="body2" color="text.secondary">
              Generate a suggestion to review changes.
            </Typography>
          ) : (
            <Stack spacing={1.1}>
              {patch.files.map((file) => (
                <Box key={file.path} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
                  <Box sx={{ px: 1, py: 0.7, bgcolor: "rgba(15,23,42,0.5)", borderBottom: "1px solid", borderColor: "divider" }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {file.path}
                    </Typography>
                  </Box>
                  <Stack spacing={0}>
                    {(file.hunks || []).map((hunk) => {
                      const checked = Boolean(selected[file.path]?.has(hunk.id))
                      return (
                        <Box key={`${file.path}-${hunk.id}`} sx={{ p: 0.8, borderBottom: "1px solid", borderColor: "divider" }}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={checked}
                                onChange={(e) => onToggleHunk(file.path, hunk.id, e.target.checked)}
                              />
                            }
                            label={
                              <Stack spacing={0.2}>
                                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                  {hunk.summary}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  old:{hunk.old_start}+{hunk.old_count} / new:{hunk.new_start}+{hunk.new_count}
                                </Typography>
                              </Stack>
                            }
                            sx={{ alignItems: "flex-start", m: 0 }}
                          />
                          {(hunk.preview_old || hunk.preview_new) && (
                            <Box
                              sx={{
                                mt: 0.4,
                                p: 0.7,
                                borderRadius: 0.8,
                                bgcolor: "rgba(2,6,23,0.65)",
                                maxHeight: 220,
                                overflow: "auto",
                              }}
                            >
                              {!!hunk.preview_old && (
                                <Typography component="pre" variant="caption" sx={{ m: 0, color: "error.light", whiteSpace: "pre-wrap" }}>
                                  - {hunk.preview_old}
                                </Typography>
                              )}
                              {!!hunk.preview_new && (
                                <Typography component="pre" variant="caption" sx={{ m: 0, color: "success.light", whiteSpace: "pre-wrap" }}>
                                  + {hunk.preview_new}
                                </Typography>
                              )}
                            </Box>
                          )}
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />
        <Stack direction="row" spacing={0.8} justifyContent="space-between" alignItems="center" sx={{ p: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Selected hunks: {selectedCount}
          </Typography>
          <Stack direction="row" spacing={0.8}>
            <Button size="small" variant="outlined" onClick={onClose}>
              Close
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={onApply}
              disabled={!patch || applying}
            >
              {applying ? "Applying..." : "Apply Selected"}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  )
}
