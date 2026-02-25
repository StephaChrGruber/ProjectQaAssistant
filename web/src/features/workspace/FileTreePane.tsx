"use client"

import { Fragment } from "react"
import { Box, Collapse, List, ListItemButton, ListItemText, Typography } from "@mui/material"
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
}

export function FileTreePane({
  nodes,
  expandedFolders,
  selectedPath,
  onToggleFolder,
  onOpenFile,
}: FileTreePaneProps) {
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
    <Box sx={{ borderRight: "1px solid", borderColor: "divider", minHeight: 0, overflow: "auto" }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.2, py: 0.8, display: "block", letterSpacing: "0.04em" }}>
        FILES
      </Typography>
      <List dense disablePadding>
        {renderNodes(nodes)}
      </List>
    </Box>
  )
}
