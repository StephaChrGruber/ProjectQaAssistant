"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Collapse, List, ListItemButton, ListItemText, Stack, TextField, Typography } from "@mui/material"
import FolderRounded from "@mui/icons-material/FolderRounded"
import DescriptionRounded from "@mui/icons-material/DescriptionRounded"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import type { WorkspaceTreeNode } from "@/features/workspace/utils"

type FileTreePaneProps = {
  nodes: WorkspaceTreeNode[]
  expandedFolders: Set<string>
  selectedPath: string | null
  onToggleFolder: (path: string) => void
  onOpenFile: (path: string) => void
  onCreateFile?: (path: string) => void
  onCreateFolder?: (path: string) => void
  onRenamePath?: (path: string, nextPath: string) => void
  onDeletePath?: (path: string) => void
}

export function FileTreePane({
  nodes,
  expandedFolders,
  selectedPath,
  onToggleFolder,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRenamePath,
  onDeletePath,
}: FileTreePaneProps) {
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "p") {
        ev.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const visibleNodes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return nodes
    const filter = (items: WorkspaceTreeNode[]): WorkspaceTreeNode[] => {
      const out: WorkspaceTreeNode[] = []
      for (const node of items) {
        if (node.kind === "file") {
          if (node.path.toLowerCase().includes(q)) out.push(node)
          continue
        }
        const children = filter(node.children || [])
        if (node.path.toLowerCase().includes(q) || children.length) {
          out.push({ ...node, children })
        }
      }
      return out
    }
    return filter(nodes)
  }, [nodes, query])

  const renderNodes = (items: WorkspaceTreeNode[], depth = 0) =>
    items.map((node) => {
      if (node.kind === "folder") {
        const open = expandedFolders.has(node.path)
        return (
          <Fragment key={node.path}>
            <ListItemButton onClick={() => onToggleFolder(node.path)} sx={{ pl: 1 + depth * 1.5, py: 0.45 }}>
              {open ? <ExpandMoreRounded fontSize="small" /> : <ChevronRightRounded fontSize="small" />}
              <FolderRounded fontSize="small" sx={{ ml: 0.4, mr: 0.8 }} color="action" />
              <ListItemText
                primary={node.name}
                primaryTypographyProps={{ noWrap: true, fontSize: 12.5, fontWeight: 600 }}
              />
            </ListItemButton>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <List dense disablePadding>
                {renderNodes(node.children || [], depth + 1)}
              </List>
            </Collapse>
          </Fragment>
        )
      }

      const selected = selectedPath === node.path
      return (
        <ListItemButton
          key={node.path}
          selected={selected}
          onClick={() => onOpenFile(node.path)}
          sx={{ pl: 2.4 + depth * 1.5, py: 0.4 }}
        >
          <DescriptionRounded fontSize="small" sx={{ mr: 0.8 }} color={selected ? "primary" : "action"} />
          <ListItemText
            primary={node.name}
            primaryTypographyProps={{ noWrap: true, fontSize: 12.5 }}
            secondary={typeof node.entry?.size === "number" ? `${Math.max(1, Math.round(node.entry.size / 1024))} KB` : undefined}
            secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
          />
        </ListItemButton>
      )
    })

  return (
    <Box sx={{ borderRight: "1px solid", borderColor: "divider", minHeight: 0, height: "100%", overflow: "auto" }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.2, py: 0.6, display: "block", letterSpacing: "0.04em" }}>
        FILES
      </Typography>
      <Box sx={{ px: 1, pb: 0.8 }}>
        <TextField
          inputRef={searchRef}
          size="small"
          placeholder="Quick file search (Ctrl/Cmd+P)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          fullWidth
        />
        <Stack direction="row" spacing={0.6} sx={{ mt: 0.6 }} useFlexGap flexWrap="wrap">
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              const name = window.prompt("New file path", selectedPath ? selectedPath.replace(/[^/]+$/, "") : "")
              const value = String(name || "").trim()
              if (value) onCreateFile?.(value)
            }}
          >
            New File
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              const name = window.prompt("New folder path", selectedPath ? selectedPath.replace(/[^/]+$/, "") : "")
              const value = String(name || "").trim()
              if (value) onCreateFolder?.(value)
            }}
          >
            New Folder
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={!selectedPath}
            onClick={() => {
              if (!selectedPath) return
              const next = window.prompt("Rename/move to", selectedPath)
              const value = String(next || "").trim()
              if (value && value !== selectedPath) onRenamePath?.(selectedPath, value)
            }}
          >
            Rename/Move
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={!selectedPath}
            onClick={() => {
              if (!selectedPath) return
              if (window.confirm(`Delete ${selectedPath}?`)) {
                onDeletePath?.(selectedPath)
              }
            }}
          >
            Delete
          </Button>
        </Stack>
      </Box>
      <List dense disablePadding>
        {renderNodes(visibleNodes)}
      </List>
    </Box>
  )
}
