"use client"

import React from "react"
import dynamic from "next/dynamic"
import { Alert, Box, Button, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material"
import CloseRounded from "@mui/icons-material/CloseRounded"
import SaveRounded from "@mui/icons-material/SaveRounded"
import type { WorkspaceOpenTab } from "@/features/workspace/types"
import { extLanguage } from "@/features/workspace/utils"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type EditorTabsProps = {
  tabs: WorkspaceOpenTab[]
  activePath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChangeContent: (path: string, next: string) => void
  onSaveActive: () => void
  saving: boolean
  onOpenFullFile?: () => void
}

function tabLabel(tab: WorkspaceOpenTab): string {
  const parts = tab.path.split("/")
  const file = parts[parts.length - 1] || tab.path
  if (tab.dirty) return `${file} *`
  if (tab.draftDirty) return `${file} •`
  return file
}

export function EditorTabs({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSaveActive,
  saving,
  onOpenFullFile,
}: EditorTabsProps) {
  const activeTab = tabs.find((tab) => tab.path === activePath) || null

  return (
    <Stack sx={{ minHeight: 0, flex: 1 }}>
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", minHeight: 36 }}>
        <Tabs
          value={activePath || false}
          onChange={(_e, value) => onSelectTab(String(value || ""))}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 34, flex: 1, "& .MuiTab-root": { minHeight: 34, fontSize: 12, textTransform: "none", px: 1.2 } }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.path}
              value={tab.path}
              label={
                <Stack direction="row" spacing={0.4} alignItems="center">
                  <span>{tabLabel(tab)}</span>
                  <IconButton
                    component="span"
                    size="small"
                    aria-label={`Close ${tab.path}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseTab(tab.path)
                    }}
                    sx={{ p: 0.1 }}
                  >
                    <CloseRounded sx={{ fontSize: 13 }} />
                  </IconButton>
                </Stack>
              }
            />
          ))}
        </Tabs>

        <Tooltip title="Save to repository">
          <span>
            <IconButton
              size="small"
              aria-label="Save active file"
              onClick={onSaveActive}
              disabled={!activeTab || saving || Boolean(activeTab?.readOnly)}
              sx={{ mr: 0.6 }}
            >
              <SaveRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {activeTab ? (
          <Stack sx={{ height: "100%" }}>
            {activeTab.readOnly && (
              <Box sx={{ p: 0.8 }}>
                <Alert
                  severity={activeTab.readOnlyReason === "binary_file" ? "warning" : "info"}
                  action={
                    activeTab.readOnlyReason === "large_file" && onOpenFullFile ? (
                      <Button color="inherit" size="small" onClick={onOpenFullFile}>
                        Open full file
                      </Button>
                    ) : undefined
                  }
                >
                  {activeTab.readOnlyReason === "binary_file"
                    ? "Binary files are read-only in workspace editor."
                    : "Large file opened as preview. Open full file to edit."}
                </Alert>
              </Box>
            )}
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <MonacoEditor
                height="100%"
                language={activeTab.language || extLanguage(activeTab.path)}
                theme="vs-dark"
                value={activeTab.draftContent}
                onChange={(value) => onChangeContent(activeTab.path, value || "")}
                options={{
                  minimap: { enabled: false },
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  lineHeight: 20,
                  wordWrap: "off",
                  smoothScrolling: true,
                  readOnly: Boolean(activeTab.readOnly),
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </Box>
          </Stack>
        ) : (
          <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Open a file from the tree to start editing.
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  )
}
