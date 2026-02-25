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
  TextField,
  Tooltip,
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
import { WorkspaceDiagnosticsPanel } from "@/features/workspace/WorkspaceDiagnosticsPanel"
import type {
  WorkspaceCapabilitiesResponse,
  WorkspaceDiagnosticsLatestResponse,
  WorkspaceDiagnosticsRunResponse,
  WorkspaceDiagnostic,
  WorkspaceDraftResponse,
  WorkspaceFileResponse,
  WorkspaceGitCommitResponse,
  WorkspaceGitFetchResponse,
  WorkspaceGitPullResponse,
  WorkspaceGitPushResponse,
  WorkspaceGitStageResponse,
  WorkspaceGitStatusResponse,
  WorkspaceGitUnstageResponse,
  WorkspaceInlineSuggestionResponse,
  WorkspaceOpenTab,
  WorkspacePatch,
  WorkspacePatchApplyResponse,
  WorkspaceSuggestResponse,
  WorkspaceTreeResponse,
} from "@/features/workspace/types"
import { buildWorkspaceTree, extLanguage, modeLabel } from "@/features/workspace/utils"

type WorkspaceShellProps = {
  open: boolean
  docked?: boolean
  allowInlineAi?: boolean
  allowDiagnostics?: boolean
  projectId: string
  projectLabel: string
  branch: string
  chatId: string | null
  userId: string
  requestOpenPath?: string | null
  requestAction?: "suggest" | "apply-last" | null
  requestPatchContent?: string | null
  requestPatchFallbackPath?: string | null
  requestPatchAutoApply?: boolean
  onRequestHandled?: () => void
  onDraftStateChange?: (state: { dirtyCount: number; paths: string[] }) => void
  onContextChange?: (state: {
    activePath: string | null
    openTabs: string[]
    dirtyPaths: string[]
    activePreview: string | null
    draftPreviews: Array<{ path: string; preview: string }>
    cursor: { line: number; column: number } | null
  }) => void
  onRegisterDraftActions?: (actions: { stashAll: () => Promise<void>; discardAll: () => void }) => void
  onClose: () => void
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function shortTextSignature(value: string): string {
  const text = String(value || "")
  if (!text) return "0"
  const head = text.slice(0, 80)
  const tail = text.slice(-80)
  return `${text.length}:${head}:${tail}`
}

function previewText(value: string, maxChars = 320): string {
  const text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  if (!text) return ""
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 15))}... (truncated)`
}

export function WorkspaceShell({
  open,
  docked = false,
  allowInlineAi = true,
  allowDiagnostics = true,
  projectId,
  projectLabel,
  branch,
  chatId,
  userId,
  requestOpenPath,
  requestAction,
  requestPatchContent,
  requestPatchFallbackPath,
  requestPatchAutoApply = false,
  onRequestHandled,
  onDraftStateChange,
  onContextChange,
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
  const [busyFileOps, setBusyFileOps] = useState(false)
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
  const [diagnostics, setDiagnostics] = useState<WorkspaceDiagnostic[]>([])
  const [runningDiagnostics, setRunningDiagnostics] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [focusLocation, setFocusLocation] = useState<{ path: string; line: number; column?: number; token: number } | null>(null)
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatusResponse | null>(null)
  const [gitCommitMessage, setGitCommitMessage] = useState("")
  const [gitBusy, setGitBusy] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [inlineSuggestEnabled, setInlineSuggestEnabled] = useState(Boolean(allowInlineAi))
  const [cursorCtx, setCursorCtx] = useState<{ path: string | null; cursor: { line: number; column: number } | null; selectedText: string | null }>({
    path: null,
    cursor: null,
    selectedText: null,
  })
  const idleTimerRef = useRef<number | null>(null)
  const suggestReqSeqRef = useRef(0)
  const suggestAbortRef = useRef<AbortController | null>(null)
  const suggestLastSigRef = useRef<string>("")
  const suggestLastAtRef = useRef<number>(0)
  const inlineReqSeqRef = useRef(0)
  const inlineAbortRef = useRef<AbortController | null>(null)
  const inlineInFlightKeyRef = useRef<string>("")
  const inlineInFlightPromiseRef = useRef<Promise<string | null> | null>(null)
  const inlineResultCacheRef = useRef<Map<string, { at: number; value: string | null }>>(new Map())
  const tabsRef = useRef<WorkspaceOpenTab[]>([])
  const previousBranchRef = useRef<string>(branch)
  const draftStateSignatureRef = useRef<string>("")
  const onDraftStateChangeRef = useRef(onDraftStateChange)
  const onContextChangeRef = useRef(onContextChange)
  const onRegisterDraftActionsRef = useRef(onRegisterDraftActions)
  const focusTokenRef = useRef(0)

  const treeNodes = useMemo(() => buildWorkspaceTree(tree?.entries || []), [tree?.entries])
  const selectedTab = useMemo(() => tabs.find((tab) => tab.path === activePath) || null, [tabs, activePath])
  const isConflictError = useCallback((msg: string) => msg.includes("conflict:file_changed_since_load"), [])
  const canGitLocal = Boolean(caps?.mode === "local")
  const canGitFetch = Boolean(caps?.mode === "local" || caps?.mode === "browser_local")
  const gitDisabledReason = useMemo(() => {
    if (!caps) return "Loading workspace capabilities..."
    if (caps.mode === "local") return null
    if (caps.mode === "browser_local") return "Stage/commit/pull/push are unavailable in browser-local mode."
    if (String(caps.mode || "").startsWith("remote:")) return "Git commands require a local or browser-local repository runtime."
    return "No Git repository is currently available."
  }, [caps])

  useEffect(() => {
    onDraftStateChangeRef.current = onDraftStateChange
  }, [onDraftStateChange])

  useEffect(() => {
    onContextChangeRef.current = onContextChange
  }, [onContextChange])

  useEffect(() => {
    onRegisterDraftActionsRef.current = onRegisterDraftActions
  }, [onRegisterDraftActions])

  useEffect(() => {
    if (!allowInlineAi) {
      setInlineSuggestEnabled(false)
    }
  }, [allowInlineAi])

  useEffect(() => {
    if (!allowDiagnostics) {
      setDiagnostics([])
      setDiagnosticsOpen(false)
    }
  }, [allowDiagnostics])

  useEffect(() => {
    try {
      const key = `pqa.workspace.diagnostics.open.${projectId}.${chatId || "none"}`
      const raw = window.localStorage.getItem(key)
      if (raw === "1") setDiagnosticsOpen(true)
      if (raw === "0") setDiagnosticsOpen(false)
    } catch {
      // ignore local storage errors
    }
  }, [chatId, projectId])

  useEffect(() => {
    try {
      const key = `pqa.workspace.diagnostics.open.${projectId}.${chatId || "none"}`
      window.localStorage.setItem(key, diagnosticsOpen ? "1" : "0")
    } catch {
      // ignore local storage errors
    }
  }, [chatId, diagnosticsOpen, projectId])

  const resetWorkspaceState = useCallback(() => {
    setTabs([])
    setActivePath(null)
    setPatch(null)
    setPatchDrawerOpen(false)
    setSelectedHunks({})
    setDiagnostics([])
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

  const loadGitStatus = useCallback(async () => {
    if (!canGitLocal) {
      setGitStatus(null)
      return
    }
    try {
      const out = await backendJson<WorkspaceGitStatusResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/workspace/git/status`,
        {
          method: "POST",
          body: JSON.stringify({
            user: userId,
            branch,
          }),
        }
      )
      setGitStatus(out)
      setGitError(null)
    } catch (err) {
      setGitStatus(null)
      setGitError(errText(err))
    }
  }, [branch, canGitLocal, projectId, userId])

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

  const createFileAtPath = useCallback(
    async (path: string) => {
      const targetPath = String(path || "").trim().replace(/^\.?\//, "")
      if (!targetPath) return
      setBusyFileOps(true)
      setError(null)
      try {
        await backendJson(`/api/projects/${encodeURIComponent(projectId)}/workspace/file/create`, {
          method: "POST",
          body: JSON.stringify({
            user: userId,
            branch,
            chat_id: chatId,
            path: targetPath,
            content: "",
            overwrite: false,
          }),
        })
        await loadTree()
        await openFile(targetPath, { forceReload: true, allowLarge: true })
        setNotice(`Created file ${targetPath}.`)
      } catch (err) {
        setError(errText(err))
      } finally {
        setBusyFileOps(false)
      }
    },
    [branch, chatId, loadTree, openFile, projectId, userId]
  )

  const createFolderAtPath = useCallback(
    async (path: string) => {
      const targetPath = String(path || "").trim().replace(/^\.?\//, "").replace(/\/+$/, "")
      if (!targetPath) return
      setBusyFileOps(true)
      setError(null)
      try {
        await backendJson(`/api/projects/${encodeURIComponent(projectId)}/workspace/folder/create`, {
          method: "POST",
          body: JSON.stringify({
            user: userId,
            branch,
            chat_id: chatId,
            path: targetPath,
          }),
        })
        setExpandedFolders((prev) => {
          const next = new Set(prev)
          let current = ""
          for (const part of targetPath.split("/")) {
            current = current ? `${current}/${part}` : part
            next.add(current)
          }
          return next
        })
        await loadTree()
        setNotice(`Created folder ${targetPath}.`)
      } catch (err) {
        setError(errText(err))
      } finally {
        setBusyFileOps(false)
      }
    },
    [branch, chatId, loadTree, projectId, userId]
  )

  const renameOrMovePath = useCallback(
    async (path: string, newPath: string) => {
      const srcPath = String(path || "").trim().replace(/^\.?\//, "")
      const targetPath = String(newPath || "").trim().replace(/^\.?\//, "")
      if (!srcPath || !targetPath || srcPath === targetPath) return
      setBusyFileOps(true)
      setError(null)
      try {
        await backendJson(`/api/projects/${encodeURIComponent(projectId)}/workspace/file/rename`, {
          method: "POST",
          body: JSON.stringify({
            user: userId,
            branch,
            chat_id: chatId,
            path: srcPath,
            new_path: targetPath,
            overwrite: false,
          }),
        })
        setTabs((prev) =>
          prev.map((tab) =>
            tab.path === srcPath
              ? {
                  ...tab,
                  path: targetPath,
                  language: extLanguage(targetPath),
                }
              : tab
          )
        )
        setActivePath((prev) => (prev === srcPath ? targetPath : prev))
        await loadTree()
        await openFile(targetPath, { forceReload: true, allowLarge: true })
        setNotice(`Moved ${srcPath} to ${targetPath}.`)
      } catch (err) {
        setError(errText(err))
      } finally {
        setBusyFileOps(false)
      }
    },
    [branch, chatId, loadTree, openFile, projectId, userId]
  )

  const deletePath = useCallback(
    async (path: string) => {
      const targetPath = String(path || "").trim().replace(/^\.?\//, "")
      if (!targetPath) return
      setBusyFileOps(true)
      setError(null)
      try {
        await backendJson(`/api/projects/${encodeURIComponent(projectId)}/workspace/file`, {
          method: "DELETE",
          body: JSON.stringify({
            user: userId,
            branch,
            chat_id: chatId,
            path: targetPath,
            ignore_missing: true,
          }),
        })
        setTabs((prev) => prev.filter((tab) => tab.path !== targetPath))
        setActivePath((prev) => (prev === targetPath ? null : prev))
        await loadTree()
        setNotice(`Deleted ${targetPath}.`)
      } catch (err) {
        setError(errText(err))
      } finally {
        setBusyFileOps(false)
      }
    },
    [branch, chatId, loadTree, projectId, userId]
  )

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
    const dirty = tabs.filter((tab) => tab.dirty || tab.draftDirty).map((tab) => tab.path)
    const activeTab = tabs.find((tab) => tab.path === activePath) || null
    const activePreview = activeTab ? previewText(activeTab.draftContent || "", 900) : ""
    const draftPreviews = tabs
      .filter((tab) => tab.dirty || tab.draftDirty)
      .slice(0, 12)
      .map((tab) => ({ path: tab.path, preview: previewText(tab.draftContent || "", 500) }))
      .filter((row) => Boolean(row.preview))
    const signature = [
      `dirty:${dirty.length}:${dirty.join("\n")}`,
      `active:${activePath || ""}:${shortTextSignature(activePreview)}`,
      `tabs:${tabs.map((t) => t.path).join("\n")}`,
      `draft_previews:${draftPreviews.map((row) => `${row.path}:${shortTextSignature(row.preview)}`).join("\n")}`,
      `cursor:${cursorCtx.path || ""}:${cursorCtx.cursor?.line || 0}:${cursorCtx.cursor?.column || 0}`,
    ].join("|")
    if (signature === draftStateSignatureRef.current) return
    draftStateSignatureRef.current = signature
    onDraftStateChangeRef.current?.({ dirtyCount: dirty.length, paths: dirty })
    onContextChangeRef.current?.({
      activePath,
      openTabs: tabs.map((t) => t.path),
      dirtyPaths: dirty,
      activePreview: activePreview || null,
      draftPreviews,
      cursor: cursorCtx.path === activePath ? cursorCtx.cursor : null,
    })
  }, [activePath, cursorCtx.cursor, cursorCtx.path, tabs])

  useEffect(() => {
    onRegisterDraftActionsRef.current?.({ stashAll: stashAllDrafts, discardAll: discardAllDrafts })
  }, [discardAllDrafts, stashAllDrafts])

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

  const suggestNow = useCallback(async (mode: "manual" | "idle" = "manual") => {
    if (!selectedTab) return
    const selectedText = cursorCtx.path === selectedTab.path ? cursorCtx.selectedText : null
    const cursor = cursorCtx.path === selectedTab.path ? cursorCtx.cursor : null
    const scope: "selection" | "file" | "open_tabs" = selectedText ? "selection" : "open_tabs"
    const requestSig = JSON.stringify({
      mode,
      branch,
      chatId: chatId || "",
      path: selectedTab.path,
      tabs: tabs.map((t) => t.path),
      cursor: cursor || null,
      selectedTextSig: shortTextSignature(selectedText || ""),
      intentSig: shortTextSignature(intent || ""),
      draftSig: shortTextSignature(selectedTab.draftContent || ""),
    })
    const now = Date.now()
    if (mode === "idle" && requestSig === suggestLastSigRef.current && now - suggestLastAtRef.current < 5000) {
      return
    }
    suggestLastSigRef.current = requestSig
    suggestLastAtRef.current = now

    const seq = ++suggestReqSeqRef.current
    suggestAbortRef.current?.abort()
    const ac = new AbortController()
    suggestAbortRef.current = ac
    setSuggesting(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: userId,
          branch,
          chat_id: chatId,
          primary_path: selectedTab.path,
          paths: tabs.map((t) => t.path),
          cursor,
          scope,
          intent,
          selected_text: selectedText,
          max_context_chars: 120000,
        }),
        signal: ac.signal,
      })
      if (!res.ok) {
        const raw = await res.text()
        throw new Error(raw || `Suggestion request failed (${res.status})`)
      }
      const out = (await res.json()) as WorkspaceSuggestResponse
      if (seq !== suggestReqSeqRef.current) return
      setSummary(out.summary || "Suggestion generated.")
      setPatch(out.patch)
      selectAllHunks(out.patch)
      setPatchDrawerOpen(true)
    } catch (err) {
      if (ac.signal.aborted) return
      setError(errText(err))
    } finally {
      if (seq === suggestReqSeqRef.current) {
        setSuggesting(false)
      }
    }
  }, [branch, chatId, cursorCtx.cursor, cursorCtx.path, cursorCtx.selectedText, intent, projectId, selectAllHunks, selectedTab, tabs, userId])

  const selectedTabDirty = Boolean(selectedTab?.dirty)
  const selectedTabPath = selectedTab?.path || null
  const selectedTabDraftContent = selectedTab?.draftContent || ""

  useEffect(() => {
    if (!open || !idleSuggest || !selectedTabDirty) return
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    idleTimerRef.current = window.setTimeout(() => {
      void suggestNow("idle")
    }, 1200)
    return () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [idleSuggest, open, selectedTabDirty, selectedTabDraftContent, selectedTabPath, suggestNow])

  const applyPatchNow = useCallback(async (opts?: { patch?: WorkspacePatch | null; selected?: Record<string, Set<number>> }) => {
    const activePatch = opts?.patch ?? patch
    const activeSelection = opts?.selected ?? selectedHunks
    if (!activePatch) return
    setApplyingPatch(true)
    setError(null)
    try {
      const selection = Object.entries(activeSelection).map(([file, ids]) => ({ file, hunk_ids: Array.from(ids) }))
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/patch/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: userId,
          branch,
          chat_id: chatId,
          patch: activePatch,
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

  const requestInlineSuggestion = useCallback(
    async (args: { path: string; cursor: { line: number; column: number } | null; selectedText: string | null }) => {
      if (!allowInlineAi || !inlineSuggestEnabled) return null
      const key = JSON.stringify({
        branch,
        chatId: chatId || "",
        path: args.path,
        cursor: args.cursor || null,
        selectedTextSig: shortTextSignature(args.selectedText || ""),
        intentSig: shortTextSignature(intent || ""),
      })
      const now = Date.now()
      const cached = inlineResultCacheRef.current.get(key)
      if (cached && now - cached.at < 1500) {
        return cached.value
      }
      if (inlineInFlightPromiseRef.current && inlineInFlightKeyRef.current === key) {
        return inlineInFlightPromiseRef.current
      }

      const seq = ++inlineReqSeqRef.current
      inlineAbortRef.current?.abort()
      const ac = new AbortController()
      inlineAbortRef.current = ac

      const reqPromise = (async (): Promise<string | null> => {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/suggest-inline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user: userId,
              branch,
              chat_id: chatId,
              path: args.path,
              cursor: args.cursor,
              selected_text: args.selectedText,
              intent,
              llm_profile_id: null,
            }),
            signal: ac.signal,
          })
          if (!res.ok) return null
          const out = (await res.json()) as WorkspaceInlineSuggestionResponse
          if (seq !== inlineReqSeqRef.current) return null
          const text = String(out.suggestion || "").trim() || null
          inlineResultCacheRef.current.set(key, { at: Date.now(), value: text })
          if (inlineResultCacheRef.current.size > 60) {
            const items = Array.from(inlineResultCacheRef.current.entries()).sort((a, b) => a[1].at - b[1].at)
            for (const [oldKey] of items.slice(0, 20)) {
              inlineResultCacheRef.current.delete(oldKey)
            }
          }
          return text
        } catch {
          return null
        } finally {
          if (inlineInFlightKeyRef.current === key) {
            inlineInFlightKeyRef.current = ""
            inlineInFlightPromiseRef.current = null
          }
        }
      })()

      inlineInFlightKeyRef.current = key
      inlineInFlightPromiseRef.current = reqPromise
      return reqPromise
    },
    [allowInlineAi, branch, chatId, inlineSuggestEnabled, intent, projectId, userId]
  )

  useEffect(() => {
    if (open) return
    suggestAbortRef.current?.abort()
    suggestAbortRef.current = null
    inlineAbortRef.current?.abort()
    inlineAbortRef.current = null
    inlineInFlightKeyRef.current = ""
    inlineInFlightPromiseRef.current = null
  }, [open])

  useEffect(() => {
    return () => {
      suggestAbortRef.current?.abort()
      suggestAbortRef.current = null
      inlineAbortRef.current?.abort()
      inlineAbortRef.current = null
      inlineInFlightKeyRef.current = ""
      inlineInFlightPromiseRef.current = null
    }
  }, [])

  const runDiagnostics = useCallback(async () => {
    if (!allowDiagnostics) return
    setRunningDiagnostics(true)
    try {
      const out = await backendJson<WorkspaceDiagnosticsRunResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/workspace/diagnostics/run`,
        {
          method: "POST",
          body: JSON.stringify({
            user: userId,
            branch,
            chat_id: chatId,
            target: selectedTab ? "active_file" : "open_tabs",
            paths: selectedTab ? [selectedTab.path] : tabs.map((t) => t.path),
          }),
        }
      )
      setDiagnostics(out.markers || [])
      if ((out.markers || []).length > 0) {
        setDiagnosticsOpen(true)
      }
      setNotice(`Diagnostics finished. ${out.markers_count || 0} marker(s) detected.`)
    } catch (err) {
      setError(errText(err))
    } finally {
      setRunningDiagnostics(false)
    }
  }, [allowDiagnostics, branch, chatId, projectId, selectedTab, tabs, userId])

  const clearDiagnostics = useCallback(() => {
    setDiagnostics([])
  }, [])

  const focusDiagnostic = useCallback(
    async (marker: WorkspaceDiagnostic) => {
      const path = String(marker.path || "").trim()
      if (!path) return
      const line = Math.max(1, Number(marker.line || 1))
      const column = Math.max(1, Number(marker.column || 1))
      if (activePath !== path) {
        await openFile(path, { forceReload: false, allowLarge: true })
      }
      focusTokenRef.current += 1
      setFocusLocation({ path, line, column, token: focusTokenRef.current })
    },
    [activePath, openFile]
  )

  const loadLatestDiagnostics = useCallback(async () => {
    if (!allowDiagnostics) return
    try {
      const out = await backendJson<WorkspaceDiagnosticsLatestResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/workspace/diagnostics/latest?branch=${encodeURIComponent(branch)}&chat_id=${encodeURIComponent(chatId || "")}&user=${encodeURIComponent(userId)}`
      )
      if (out && "found" in out && out.found) {
        setDiagnostics(out.markers || [])
      }
    } catch {
      // ignore diagnostics fetch failures
    }
  }, [allowDiagnostics, branch, chatId, projectId, userId])

  useEffect(() => {
    if (!open) return
    void loadCapabilities()
    void loadTree()
    void loadLatestDiagnostics()
    void loadGitStatus()
  }, [loadCapabilities, loadGitStatus, loadLatestDiagnostics, loadTree, open])

  useEffect(() => {
    if (previousBranchRef.current === branch) return
    previousBranchRef.current = branch
    resetWorkspaceState()
    if (open) {
      void loadTree()
    }
  }, [branch, loadTree, open, resetWorkspaceState])

  useEffect(() => {
    if (!open) return
    if (!canGitLocal) {
      setGitStatus(null)
      return
    }
    void loadGitStatus()
  }, [canGitLocal, loadGitStatus, open])

  const runGitAction = useCallback(
    async <T,>(path: string, body: Record<string, unknown>, successNotice: string): Promise<T | null> => {
      setGitBusy(true)
      setGitError(null)
      try {
        const out = await backendJson<T>(`/api/projects/${encodeURIComponent(projectId)}/workspace/git/${path}`, {
          method: "POST",
          body: JSON.stringify({
            user: userId,
            branch,
            ...body,
          }),
        })
        setNotice(successNotice)
        await loadGitStatus()
        return out
      } catch (err) {
        setGitError(errText(err))
        return null
      } finally {
        setGitBusy(false)
      }
    },
    [branch, loadGitStatus, projectId, userId]
  )

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
    if (!open || !requestPatchContent) return
    void (async () => {
      try {
        const out = await backendJson<{ kind: string; patch: WorkspacePatch }>(
          `/api/projects/${encodeURIComponent(projectId)}/workspace/patch/normalize`,
          {
            method: "POST",
            body: JSON.stringify({
              user: userId,
              branch,
              chat_id: chatId,
              content: requestPatchContent,
              fallback_path: requestPatchFallbackPath || selectedTab?.path || null,
            }),
          }
        )
        setPatch(out.patch || null)
        if (out.patch) {
          const nextSelection: Record<string, Set<number>> = {}
          for (const file of out.patch.files || []) {
            nextSelection[file.path] = new Set((file.hunks || []).map((h) => h.id))
          }
          setSelectedHunks(nextSelection)
          setPatchDrawerOpen(true)
          setNotice(`Loaded ${out.kind || "assistant"} patch for review.`)
          if (requestPatchAutoApply) {
            await applyPatchNow({ patch: out.patch, selected: nextSelection })
          }
        }
      } catch (err) {
        setError(errText(err))
      } finally {
        onRequestHandled?.()
      }
    })()
  }, [applyPatchNow, branch, chatId, onRequestHandled, open, projectId, requestPatchAutoApply, requestPatchContent, requestPatchFallbackPath, selectedTab?.path, userId])

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

  if (!open && docked) return null

  const content = (
    <>
      {(loadingTree || busyOpenFile || busyFileOps || savingFile || suggesting || applyingPatch || gitBusy) && <LinearProgress />}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.1, py: 0.8, borderBottom: "1px solid", borderColor: "divider" }}>
        <Chip size="small" variant="outlined" label={modeLabel(caps?.mode || "none")} />
        <Typography variant="caption" color="text.secondary">
          Branch: {branch}
        </Typography>
        <Box sx={{ ml: "auto", display: "flex", gap: 0.7 }}>
          <Button
            size="small"
            variant={inlineSuggestEnabled ? "contained" : "outlined"}
            onClick={() => setInlineSuggestEnabled((v) => (allowInlineAi ? !v : false))}
            disabled={!allowInlineAi}
          >
            Inline AI {inlineSuggestEnabled ? "On" : "Off"}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void runDiagnostics()}
            disabled={!allowDiagnostics || runningDiagnostics}
          >
            {runningDiagnostics ? "Diagnostics..." : "Run Diagnostics"}
          </Button>
          <Button
            size="small"
            variant={diagnosticsOpen ? "contained" : "outlined"}
            onClick={() => setDiagnosticsOpen((v) => (allowDiagnostics ? !v : false))}
            disabled={!allowDiagnostics}
          >
            Diagnostics ({diagnostics.length})
          </Button>
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
      {gitError && (
        <Box sx={{ px: 1.1, pt: 0.8 }}>
          <Alert severity="warning" onClose={() => setGitError(null)}>
            {gitError}
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

      <Stack
        direction="row"
        spacing={0.7}
        alignItems="center"
        sx={{ px: 1.1, py: 0.65, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}
      >
        <Typography variant="caption" color="text.secondary">
          Git
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={
            canGitLocal
              ? gitStatus
                ? `${gitStatus.branch}${gitStatus.clean ? " · clean" : " · dirty"}`
                : "status unavailable"
              : caps?.mode === "browser_local"
                ? "browser-local"
                : "disabled"
          }
          color={canGitLocal ? (gitStatus?.clean ? "success" : "warning") : "default"}
        />
        <Chip
          size="small"
          variant="outlined"
          label={`staged:${gitStatus?.staged?.length || 0} modified:${gitStatus?.modified?.length || 0} untracked:${gitStatus?.untracked?.length || 0}`}
        />
        <Box sx={{ ml: "auto", display: "flex", gap: 0.7, alignItems: "center", flexWrap: "wrap" }}>
          <Tooltip title={gitDisabledReason || ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGitLocal || gitBusy}
                onClick={() => {
                  void loadGitStatus()
                }}
              >
                Status
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={gitDisabledReason || ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGitLocal || gitBusy}
                onClick={() => {
                  void runGitAction<WorkspaceGitStageResponse>("stage", { all: true, paths: [] }, "Staged all changes.")
                }}
              >
                Stage All
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={gitDisabledReason || ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGitLocal || gitBusy}
                onClick={() => {
                  void runGitAction<WorkspaceGitUnstageResponse>("unstage", { all: true, paths: [] }, "Unstaged all changes.")
                }}
              >
                Unstage All
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={canGitFetch ? "" : "Fetch is unavailable for this repository mode."}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGitFetch || gitBusy}
                onClick={() => {
                  void runGitAction<WorkspaceGitFetchResponse>("fetch", { remote: "origin", prune: false }, "Fetch completed.")
                }}
              >
                Fetch
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={gitDisabledReason || ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGitLocal || gitBusy}
                onClick={() => {
                  void runGitAction<WorkspaceGitPullResponse>("pull", { remote: "origin", rebase: false }, "Pull completed.")
                }}
              >
                Pull
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={gitDisabledReason || ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGitLocal || gitBusy}
                onClick={() => {
                  void runGitAction<WorkspaceGitPushResponse>("push", { remote: "origin", set_upstream: false, force_with_lease: false }, "Push completed.")
                }}
              >
                Push
              </Button>
            </span>
          </Tooltip>
          <TextField
            size="small"
            placeholder="Commit message"
            value={gitCommitMessage}
            onChange={(e) => setGitCommitMessage(e.target.value)}
            sx={{ minWidth: 220 }}
            disabled={!canGitLocal || gitBusy}
          />
          <Tooltip title={gitDisabledReason || ""}>
            <span>
              <Button
                size="small"
                variant="contained"
                disabled={!canGitLocal || gitBusy || !gitCommitMessage.trim()}
                onClick={() => {
                  const message = gitCommitMessage.trim()
                  if (!message) return
                  void (async () => {
                    const out = await runGitAction<WorkspaceGitCommitResponse>(
                      "commit",
                      { message, all: false, amend: false },
                      "Commit created."
                    )
                    if (out) {
                      setGitCommitMessage("")
                    }
                  })()
                }}
              >
                Commit
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Stack>

      <Stack sx={{ minHeight: 0, flex: 1, overflow: "hidden" }}>
        <Grid container sx={{ flex: 1, minHeight: 0, height: "100%", overflow: "hidden" }}>
        <Grid size={{ xs: 12, md: 3 }} sx={{ minHeight: 0, height: { xs: 240, md: "100%" }, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <FileTreePane
            nodes={treeNodes}
            expandedFolders={expandedFolders}
            selectedPath={activePath}
            onToggleFolder={toggleFolder}
            onOpenFile={(path) => {
              void openFile(path)
            }}
            onCreateFile={(path) => {
              void createFileAtPath(path)
            }}
            onCreateFolder={(path) => {
              void createFolderAtPath(path)
            }}
            onRenamePath={(path, nextPath) => {
              void renameOrMovePath(path, nextPath)
            }}
            onDeletePath={(path) => {
              void deletePath(path)
            }}
          />
        </Grid>
        <Grid
          size={{ xs: 12, md: 7 }}
          sx={{
            minHeight: 0,
            height: { xs: 420, md: "100%" },
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRight: { md: "1px solid" },
            borderColor: "divider",
          }}
        >
          <EditorTabs
            tabs={tabs}
            activePath={activePath}
            onSelectTab={setActivePath}
            onCloseTab={closeTab}
            onChangeContent={onChangeContent}
            onCursorContextChange={({ path, cursor, selectedText }) => {
              setCursorCtx({ path, cursor, selectedText })
            }}
            onRequestInlineSuggestion={allowInlineAi ? requestInlineSuggestion : undefined}
            diagnostics={diagnostics}
            focusLocation={focusLocation}
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
        <Grid size={{ xs: 12, md: 2 }} sx={{ minHeight: 0, height: { xs: 220, md: "100%" }, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
        {allowDiagnostics && (
          <WorkspaceDiagnosticsPanel
            open={diagnosticsOpen}
            diagnostics={diagnostics}
            running={runningDiagnostics}
            onToggleOpen={() => setDiagnosticsOpen((v) => !v)}
            onRerun={() => {
              void runDiagnostics()
            }}
            onClear={clearDiagnostics}
            onSelectDiagnostic={(marker) => {
              void focusDiagnostic(marker)
            }}
          />
        )}
      </Stack>
    </>
  )

  return docked ? (
    <Box sx={{ minHeight: 0, height: "100%", display: "flex", flexDirection: "column", borderLeft: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.6, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">
          {projectLabel} Workspace
        </Typography>
        <Box sx={{ ml: "auto" }}>
          <Button size="small" variant="text" onClick={onClose}>
            Close
          </Button>
        </Box>
      </Stack>
      <Box sx={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>{content}</Box>
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
    </Box>
  ) : (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppDialogTitle title={`${projectLabel} Workspace`} onClose={onClose} />
      <DialogContent sx={{ p: 0, height: "calc(100vh - 64px)", minHeight: 0, display: "flex", flexDirection: "column" }}>
        {content}
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
