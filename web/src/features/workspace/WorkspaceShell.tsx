"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material"
import RefreshRounded from "@mui/icons-material/RefreshRounded"
import RuleRounded from "@mui/icons-material/RuleRounded"
import AppDialogTitle from "@/components/AppDialogTitle"
import { backendJson } from "@/lib/backend"
import { EditorTabs } from "@/features/workspace/EditorTabs"
import { FileTreePane } from "@/features/workspace/FileTreePane"
import { PatchReviewDrawer } from "@/features/workspace/PatchReviewDrawer"
import { SuggestionPanel } from "@/features/workspace/SuggestionPanel"
import type {
  WorkspaceCapabilitiesResponse,
  WorkspaceDraftResponse,
  WorkspaceFileResponse,
  WorkspaceOpenTab,
  WorkspacePatch,
  WorkspacePatchApplyResponse,
  WorkspaceSuggestResponse,
  WorkspaceTreeResponse,
} from "@/features/workspace/types"
import { buildWorkspaceTree, extLanguage, modeLabel } from "@/features/workspace/utils"

type WorkspaceShellProps = {
  open: boolean
  projectId: string
  projectLabel: string
  branch: string
  chatId: string | null
  userId: string
  requestOpenPath?: string | null
  requestAction?: "suggest" | "apply-last" | null
  onRequestHandled?: () => void
  onDraftStateChange?: (state: { dirtyCount: number; paths: string[] }) => void
  onRegisterDraftActions?: (actions: { stashAll: () => Promise<void>; discardAll: () => void }) => void
  onClose: () => void
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function WorkspaceShell({
  open,
  projectId,
  projectLabel,
  branch,
  chatId,
  userId,
  requestOpenPath,
  requestAction,
  onRequestHandled,
  onDraftStateChange,
  onRegisterDraftActions,
  onClose,
}: WorkspaceShellProps) {
  const [caps, setCaps] = useState<WorkspaceCapabilitiesResponse | null>(null)
  const [tree, setTree] = useState<WorkspaceTreeResponse | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [tabs, setTabs] = useState<WorkspaceOpenTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [busyOpenFile, setBusyOpenFile] = useState(false)
  const [savingFile, setSavingFile] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [applyingPatch, setApplyingPatch] = useState(false)
  const [intent, setIntent] = useState("")
  const [idleSuggest, setIdleSuggest] = useState(true)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const [patch, setPatch] = useState<WorkspacePatch | null>(null)
  const [patchDrawerOpen, setPatchDrawerOpen] = useState(false)
  const [selectedHunks, setSelectedHunks] = useState<Record<string, Set<number>>>({})
  const idleTimerRef = useRef<number | null>(null)
  const tabsRef = useRef<WorkspaceOpenTab[]>([])
  const previousBranchRef = useRef<string>(branch)

  const treeNodes = useMemo(() => buildWorkspaceTree(tree?.entries || []), [tree?.entries])
  const selectedTab = useMemo(() => tabs.find((tab) => tab.path === activePath) || null, [tabs, activePath])
  const isConflictError = useCallback((msg: string) => msg.includes("conflict:file_changed_since_load"), [])

  const resetWorkspaceState = useCallback(() => {
    setTabs([])
    setActivePath(null)
    setPatch(null)
    setPatchDrawerOpen(false)
    setSelectedHunks({})
    setSummary(null)
    setConflictPath(null)
    setError(null)
  }, [])

  const loadCapabilities = useCallback(async () => {
    const out = await backendJson<WorkspaceCapabilitiesResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/workspace/capabilities?branch=${encodeURIComponent(branch)}&user=${encodeURIComponent(userId)}`
    )
    setCaps(out)
  }, [branch, projectId, userId])

  const loadTree = useCallback(async () => {
    setLoadingTree(true)
    setError(null)
    try {
      const out = await backendJson<WorkspaceTreeResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/workspace/tree?branch=${encodeURIComponent(branch)}&max_depth=8&max_entries=2600&include_files=1&include_dirs=1&chat_id=${encodeURIComponent(chatId || "")}&user=${encodeURIComponent(userId)}`
      )
      setTree(out)
      if (!expandedFolders.size) {
        const next = new Set<string>()
        for (const row of out.entries || []) {
          if (row.type !== "dir") continue
          const top = String(row.path || "").split("/")[0]
          if (top) next.add(top)
        }
        setExpandedFolders(next)
      }
    } catch (err) {
      setError(errText(err))
      setTree(null)
    } finally {
      setLoadingTree(false)
    }
  }, [branch, chatId, expandedFolders.size, projectId, userId])

  const openFile = useCallback(
    async (path: string, opts?: { allowLarge?: boolean; forceReload?: boolean }) => {
      const targetPath = String(path || "").trim()
      if (!targetPath) return

      const allowLarge = Boolean(opts?.allowLarge)
      const forceReload = Boolean(opts?.forceReload)
      const existing = tabs.find((tab) => tab.path === targetPath)
      if (existing && !forceReload) {
        setActivePath(targetPath)
        return
      }

      setBusyOpenFile(true)
      setError(null)
      try {
        const [fileRes, draftRes] = await Promise.all([
          backendJson<WorkspaceFileResponse>(
            `/api/projects/${encodeURIComponent(projectId)}/workspace/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(targetPath)}&chat_id=${encodeURIComponent(chatId || "")}&allow_large=${allowLarge ? "1" : "0"}&user=${encodeURIComponent(userId)}`
          ),
          chatId
            ? backendJson<WorkspaceDraftResponse>(
                `/api/projects/${encodeURIComponent(projectId)}/workspace/draft?branch=${encodeURIComponent(branch)}&chat_id=${encodeURIComponent(chatId)}&path=${encodeURIComponent(targetPath)}&user=${encodeURIComponent(userId)}`
              )
            : Promise.resolve({ found: false } as WorkspaceDraftResponse),
        ])

        const savedContent = String(fileRes.content || "")
        const draftContent = draftRes?.found ? String(draftRes.content || savedContent) : savedContent
        const next: WorkspaceOpenTab = {
          path: targetPath,
          savedContent,
          draftContent,
          savedHash: String(fileRes.content_hash || "") || undefined,
          dirty: draftContent !== savedContent,
          draftDirty: false,
          mode: fileRes.mode,
          language: extLanguage(targetPath),
          readOnly: Boolean(fileRes.read_only),
          readOnlyReason: fileRes.read_only_reason || null,
          sizeBytes: typeof fileRes.size_bytes === "number" ? fileRes.size_bytes : null,
          webUrl: fileRes.web_url,
          allowLarge,
        }
        setTabs((prev) => {
          const without = prev.filter((tab) => tab.path !== targetPath)
          return [...without, next]
        })
        setActivePath(targetPath)

        const parts = targetPath.split("/")
        if (parts.length > 1) {
          setExpandedFolders((prev) => {
            const nextFolders = new Set(prev)
            let current = ""
            for (let i = 0; i < parts.length - 1; i += 1) {
              current = current ? `${current}/${parts[i]}` : parts[i]
              nextFolders.add(current)
            }
            return nextFolders
          })
        }
      } catch (err) {
        setError(errText(err))
      } finally {
        setBusyOpenFile(false)
      }
    },
    [branch, chatId, projectId, tabs, userId]
  )

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => prev.filter((tab) => tab.path !== path))
    setActivePath((prev) => {
      if (prev !== path) return prev
      const remaining = tabs.filter((tab) => tab.path !== path)
      return remaining[remaining.length - 1]?.path || null
    })
  }, [tabs])

  const onChangeContent = useCallback((path: string, next: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.path !== path) return tab
        if (tab.readOnly) return tab
        const dirty = next !== tab.savedContent
        return {
          ...tab,
          draftContent: next,
          dirty,
          draftDirty: true,
        }
      })
    )
  }, [])

  const saveDraftForTab = useCallback(async (tab: WorkspaceOpenTab) => {
    if (!chatId) return
    await backendJson(`/api/projects/${encodeURIComponent(projectId)}/workspace/draft/save`, {
      method: "POST",
      body: JSON.stringify({
        user: userId,
        branch,
        chat_id: chatId,
        path: tab.path,
        content: tab.draftContent,
      }),
    })
  }, [branch, chatId, projectId, userId])

  const stashAllDrafts = useCallback(async () => {
    if (!chatId) {
      resetWorkspaceState()
      return
    }
    const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty || tab.draftDirty)
    for (const tab of dirtyTabs) {
      await saveDraftForTab(tab)
    }
    resetWorkspaceState()
  }, [chatId, resetWorkspaceState, saveDraftForTab])

  const discardAllDrafts = useCallback(() => {
    resetWorkspaceState()
  }, [resetWorkspaceState])

  useEffect(() => {
    if (!open || !chatId) return
    const dirtyTab = tabs.find((tab) => tab.draftDirty)
    if (!dirtyTab) return

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await saveDraftForTab(dirtyTab)
          setTabs((prev) => prev.map((tab) => (tab.path === dirtyTab.path ? { ...tab, draftDirty: false } : tab)))
        } catch {
          // Keep silent; explicit save will still work.
        }
      })()
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [chatId, open, saveDraftForTab, tabs])

  useEffect(() => {
    tabsRef.current = tabs
    if (!onDraftStateChange) return
    const dirty = tabs.filter((tab) => tab.dirty || tab.draftDirty).map((tab) => tab.path)
    onDraftStateChange({ dirtyCount: dirty.length, paths: dirty })
  }, [onDraftStateChange, tabs])

  useEffect(() => {
    if (!onRegisterDraftActions) return
    onRegisterDraftActions({ stashAll: stashAllDrafts, discardAll: discardAllDrafts })
  }, [discardAllDrafts, onRegisterDraftActions, stashAllDrafts])

  const saveActiveFile = useCallback(async () => {
    if (!selectedTab) return
    if (selectedTab.readOnly) {
      setError("This file is currently read-only in workspace editor.")
      return
    }
    setSavingFile(true)
    setError(null)
    setConflictPath(null)
    try {
      const out = await backendJson<any>(`/api/projects/${encodeURIComponent(projectId)}/workspace/file`, {
        method: "POST",
        body: JSON.stringify({
          user: userId,
          branch,
          chat_id: chatId,
          path: selectedTab.path,
          content: selectedTab.draftContent,
          expected_hash: selectedTab.savedHash || null,
        }),
      })

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.path !== selectedTab.path) return tab
          return {
            ...tab,
            savedContent: tab.draftContent,
            savedHash: String(out.content_hash || tab.savedHash || "") || undefined,
            dirty: false,
            draftDirty: false,
          }
        })
      )
      setNotice(`Saved ${selectedTab.path} to repository.`)
    } catch (err) {
      const message = errText(err)
      if (isConflictError(message)) {
        setConflictPath(selectedTab.path)
        setError("File changed outside the editor. Reload it and re-apply your edits.")
      } else {
        setError(message)
      }
    } finally {
      setSavingFile(false)
    }
  }, [branch, chatId, isConflictError, projectId, selectedTab, userId])

  const selectAllHunks = useCallback((nextPatch: WorkspacePatch) => {
    const map: Record<string, Set<number>> = {}
    for (const file of nextPatch.files || []) {
      map[file.path] = new Set((file.hunks || []).map((h) => h.id))
    }
    setSelectedHunks(map)
  }, [])

  const suggestNow = useCallback(async () => {
    if (!selectedTab) return
    setSuggesting(true)
    setError(null)
    try {
      const out = await backendJson<WorkspaceSuggestResponse>(`/api/projects/${encodeURIComponent(projectId)}/workspace/suggest`, {
        method: "POST",
        body: JSON.stringify({
          user: userId,
          branch,
          chat_id: chatId,
          primary_path: selectedTab.path,
          paths: tabs.map((t) => t.path),
          intent,
          selected_text: null,
          max_context_chars: 120000,
        }),
      })
      setSummary(out.summary || "Suggestion generated.")
      setPatch(out.patch)
      selectAllHunks(out.patch)
      setPatchDrawerOpen(true)
    } catch (err) {
      setError(errText(err))
    } finally {
      setSuggesting(false)
    }
  }, [branch, chatId, intent, projectId, selectAllHunks, selectedTab, tabs, userId])

  useEffect(() => {
    if (!open || !idleSuggest || !selectedTab || !selectedTab.dirty) return
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    idleTimerRef.current = window.setTimeout(() => {
      void suggestNow()
    }, 1200)
    return () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [open, idleSuggest, selectedTab?.path, selectedTab?.draftContent, selectedTab?.dirty, suggestNow])

  const applyPatchNow = useCallback(async () => {
    if (!patch) return
    setApplyingPatch(true)
    setError(null)
    try {
      const selection = Object.entries(selectedHunks).map(([file, ids]) => ({ file, hunk_ids: Array.from(ids) }))
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/patch/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: userId,
          branch,
          chat_id: chatId,
          patch,
          selection,
        }),
      })
      const raw = await res.text()
      const parsed = raw ? (JSON.parse(raw) as any) : {}
      let out: WorkspacePatchApplyResponse
      if (res.status === 409) {
        out = (parsed?.detail || {}) as WorkspacePatchApplyResponse
      } else if (!res.ok) {
        throw new Error(raw || `Patch apply failed (${res.status})`)
      } else {
        out = parsed as WorkspacePatchApplyResponse
      }

      if (out.conflict_count > 0) {
        setError(`Patch applied with conflicts: ${out.conflict_count}. Reload conflicted file(s) and retry.`)
        const firstConflict = out.conflicts?.[0]?.path
        if (firstConflict) {
          setConflictPath(String(firstConflict))
        }
        setPatchDrawerOpen(true)
      } else {
        setNotice(`Patch applied to ${out.applied_count} file(s).`)
        setPatchDrawerOpen(false)
        setPatch(null)
      }

      for (const item of out.applied || []) {
        const path = String(item.path || "").trim()
        if (!path) continue
        try {
          const file = await backendJson<any>(
            `/api/projects/${encodeURIComponent(projectId)}/workspace/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&chat_id=${encodeURIComponent(chatId || "")}&user=${encodeURIComponent(userId)}`
          )
          const content = String(file.content || "")
          const contentHash = String(file.content_hash || "")
          setTabs((prev) =>
            prev.map((tab) =>
              tab.path === path
                ? {
                    ...tab,
                    savedContent: content,
                    draftContent: content,
                    savedHash: contentHash || tab.savedHash,
                    dirty: false,
                    draftDirty: false,
                  }
                : tab
            )
          )
        } catch {
          // Ignore refresh failures for individual files.
        }
      }

    } catch (err) {
      setError(errText(err))
    } finally {
      setApplyingPatch(false)
    }
  }, [branch, chatId, patch, projectId, selectedHunks, userId])

  useEffect(() => {
    if (!open) return
    void loadCapabilities()
    void loadTree()
  }, [loadCapabilities, loadTree, open])

  useEffect(() => {
    if (previousBranchRef.current === branch) return
    previousBranchRef.current = branch
    resetWorkspaceState()
    if (open) {
      void loadTree()
    }
  }, [branch, loadTree, open, resetWorkspaceState])

  useEffect(() => {
    if (!open || !requestOpenPath) return
    void openFile(requestOpenPath)
    onRequestHandled?.()
  }, [onRequestHandled, open, openFile, requestOpenPath])

  useEffect(() => {
    if (!open || !requestAction) return
    if (requestAction === "suggest") {
      void suggestNow()
    } else if (requestAction === "apply-last") {
      if (patch) {
        void applyPatchNow()
      }
    }
    onRequestHandled?.()
  }, [applyPatchNow, onRequestHandled, open, patch, requestAction, suggestNow])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleHunk = useCallback((path: string, hunkId: number, checked: boolean) => {
    setSelectedHunks((prev) => {
      const next = { ...prev }
      const set = new Set(next[path] || [])
      if (checked) set.add(hunkId)
      else set.delete(hunkId)
      next[path] = set
      return next
    })
  }, [])

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppDialogTitle title={`${projectLabel} Workspace`} onClose={onClose} />
      <DialogContent sx={{ p: 0, height: "calc(100vh - 64px)", display: "flex", flexDirection: "column" }}>
        {(loadingTree || busyOpenFile || savingFile || suggesting || applyingPatch) && <LinearProgress />}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.1, py: 0.8, borderBottom: "1px solid", borderColor: "divider" }}>
          <Chip size="small" variant="outlined" label={modeLabel(caps?.mode || "none")} />
          <Typography variant="caption" color="text.secondary">
            Branch: {branch}
          </Typography>
          <Box sx={{ ml: "auto", display: "flex", gap: 0.7 }}>
            <Button size="small" variant="outlined" startIcon={<RefreshRounded />} onClick={() => void loadTree()}>
              Refresh Tree
            </Button>
            <Button size="small" variant="outlined" startIcon={<RuleRounded />} onClick={() => setPatchDrawerOpen(true)} disabled={!patch}>
              Review Patch
            </Button>
          </Box>
        </Stack>

        {error && (
          <Box sx={{ px: 1.1, pt: 0.8 }}>
            <Alert
              severity="error"
              onClose={() => {
                setError(null)
                setConflictPath(null)
              }}
              action={
                conflictPath ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      void openFile(conflictPath, { forceReload: true, allowLarge: true })
                    }}
                  >
                    Reload
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          </Box>
        )}
        {notice && (
          <Box sx={{ px: 1.1, pt: 0.8 }}>
            <Alert severity="success" onClose={() => setNotice(null)}>
              {notice}
            </Alert>
          </Box>
        )}

        <Grid container sx={{ flex: 1, minHeight: 0 }}>
          <Grid size={{ xs: 12, md: 3 }} sx={{ minHeight: 0 }}>
            <FileTreePane
              nodes={treeNodes}
              expandedFolders={expandedFolders}
              selectedPath={activePath}
              onToggleFolder={toggleFolder}
              onOpenFile={(path) => {
                void openFile(path)
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 7 }} sx={{ minHeight: 0, borderRight: { md: "1px solid" }, borderColor: "divider" }}>
            <EditorTabs
              tabs={tabs}
              activePath={activePath}
              onSelectTab={setActivePath}
              onCloseTab={closeTab}
              onChangeContent={onChangeContent}
              onSaveActive={saveActiveFile}
              saving={savingFile}
              onOpenFullFile={
                selectedTab && selectedTab.readOnlyReason === "large_file"
                  ? () => {
                      void openFile(selectedTab.path, { allowLarge: true, forceReload: true })
                    }
                  : undefined
              }
            />
          </Grid>
          <Grid size={{ xs: 12, md: 2 }} sx={{ minHeight: 0 }}>
            <SuggestionPanel
              intent={intent}
              enableIdleSuggest={idleSuggest}
              busy={suggesting}
              summary={summary}
              onIntentChange={setIntent}
              onToggleIdleSuggest={setIdleSuggest}
              onSuggestNow={() => {
                void suggestNow()
              }}
            />
          </Grid>
        </Grid>
      </DialogContent>

      <PatchReviewDrawer
        open={patchDrawerOpen}
        patch={patch}
        selected={selectedHunks}
        applying={applyingPatch}
        onClose={() => setPatchDrawerOpen(false)}
        onToggleHunk={toggleHunk}
        onApply={() => {
          void applyPatchNow()
        }}
      />
    </Dialog>
  )
}
