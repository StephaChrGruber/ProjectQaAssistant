"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material"
import AddRounded from "@mui/icons-material/AddRounded"
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded"
import EditRounded from "@mui/icons-material/EditRounded"
import DeleteRounded from "@mui/icons-material/DeleteRounded"
import TipsAndUpdatesRounded from "@mui/icons-material/TipsAndUpdatesRounded"
import ScienceRounded from "@mui/icons-material/ScienceRounded"
import { backendJson } from "@/lib/backend"
import { buildChatPath, saveLastChat } from "@/lib/last-chat"
import {
  ProjectDrawerLayout,
  type DrawerChat,
  type DrawerChatGroup,
  type DrawerUser,
} from "@/components/ProjectDrawerLayout"
import AutomationEditorDialog from "@/features/automations/AutomationEditorDialog"
import AutomationRunsTimeline from "@/features/automations/AutomationRunsTimeline"
import {
  automationErrText,
  prettyJson,
  type AutomationDoc,
  type AutomationRunDoc,
  type AutomationTemplate,
  type ListAutomationsResponse,
  type ListAutomationRunsResponse,
  type ListAutomationTemplatesResponse,
} from "@/features/automations/types"
import type { ProjectDoc } from "@/features/chat/types"

function dedupeChatsById(chats: DrawerChat[]): DrawerChat[] {
  const out: DrawerChat[] = []
  const seen = new Set<string>()
  for (const item of chats || []) {
    const id = String(item?.chat_id || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

function prettyDate(value?: string | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString()
}

export default function ProjectAutomationsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  const [me, setMe] = useState<DrawerUser | null>(null)
  const [project, setProject] = useState<ProjectDoc | null>(null)
  const [branch, setBranch] = useState("main")
  const [chats, setChats] = useState<DrawerChat[]>([])
  const [chatGroups, setChatGroups] = useState<DrawerChatGroup[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [loadingChats, setLoadingChats] = useState(false)

  const [automations, setAutomations] = useState<AutomationDoc[]>([])
  const [runs, setRuns] = useState<AutomationRunDoc[]>([])
  const [templates, setTemplates] = useState<AutomationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create")
  const [editingAutomation, setEditingAutomation] = useState<AutomationDoc | null>(null)
  const [seedTemplate, setSeedTemplate] = useState<AutomationTemplate | null>(null)
  const [simulateOpen, setSimulateOpen] = useState(false)
  const [simulateTarget, setSimulateTarget] = useState<AutomationDoc | null>(null)
  const [simulatePayloadText, setSimulatePayloadText] = useState("")
  const [simulateResult, setSimulateResult] = useState("")

  const projectLabel = useMemo(
    () => project?.name || project?.key || projectId,
    [project?.name, project?.key, projectId]
  )
  const userId = useMemo(() => me?.email || "dev@local", [me])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 9000)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loadAutomations = useCallback(async () => {
    const [automationsRes, runsRes, templatesRes] = await Promise.all([
      backendJson<ListAutomationsResponse>(`/api/projects/${encodeURIComponent(projectId)}/automations?include_disabled=1&limit=300`),
      backendJson<ListAutomationRunsResponse>(`/api/projects/${encodeURIComponent(projectId)}/automations/runs?limit=200`),
      backendJson<ListAutomationTemplatesResponse>(`/api/projects/${encodeURIComponent(projectId)}/automations/templates`),
    ])
    setAutomations((automationsRes.items || []).filter((x) => x && x.id))
    setRuns((runsRes.items || []).filter((x) => x && x.id))
    setTemplates((templatesRes.items || []).filter((x) => x && x.key))
  }, [projectId])

  const loadProjectShell = useCallback(async () => {
    setLoadingChats(true)
    try {
      const [meRes, projectRes, projectsRes] = await Promise.all([
        backendJson<{ user?: DrawerUser }>("/api/me"),
        backendJson<ProjectDoc>(`/api/projects/${encodeURIComponent(projectId)}`),
        backendJson<ProjectDoc[]>("/api/projects"),
      ])
      setMe(meRes.user || null)
      setProject(projectRes || null)
      const currentBranch = (projectRes?.default_branch || "main").trim() || "main"
      setBranch(currentBranch)

      const groups = await Promise.all(
        (projectsRes || []).map(async (row) => {
          try {
            const docs = await backendJson<DrawerChat[]>(
              `/api/projects/${encodeURIComponent(row._id)}/chats?limit=100&user=${encodeURIComponent(
                meRes.user?.email || "dev@local"
              )}`
            )
            return {
              projectId: row._id,
              projectLabel: row.name || row.key || row._id,
              chats: dedupeChatsById(docs || []),
            } satisfies DrawerChatGroup
          } catch {
            return {
              projectId: row._id,
              projectLabel: row.name || row.key || row._id,
              chats: [],
            } satisfies DrawerChatGroup
          }
        })
      )

      let currentGroup = groups.find((g) => g.projectId === projectId)
      if (!currentGroup) {
        currentGroup = { projectId, projectLabel, chats: [] }
        groups.unshift(currentGroup)
      }
      const currentChats = dedupeChatsById(currentGroup.chats || [])
      setChats(currentChats)
      setChatGroups(groups)
      setSelectedChatId(currentChats[0]?.chat_id || null)
    } finally {
      setLoadingChats(false)
    }
  }, [projectId, projectLabel])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      setLoading(true)
      setError(null)
      try {
        await Promise.all([loadProjectShell(), loadAutomations()])
      } catch (err) {
        if (!cancelled) setError(automationErrText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [loadAutomations, loadProjectShell])

  const openNewAutomation = useCallback(() => {
    setSeedTemplate(null)
    setEditingAutomation(null)
    setEditorMode("create")
    setEditorOpen(true)
  }, [])

  const openFromTemplate = useCallback((template: AutomationTemplate) => {
    setSeedTemplate(template)
    setEditingAutomation(null)
    setEditorMode("create")
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((item: AutomationDoc) => {
    setSeedTemplate(null)
    setEditingAutomation(item)
    setEditorMode("edit")
    setEditorOpen(true)
  }, [])

  const openSimulation = useCallback(
    (item: AutomationDoc) => {
      setSimulateTarget(item)
      setSimulatePayloadText(
        prettyJson({
          project_id: projectId,
          chat_id: selectedChatId,
          branch,
          user_id: userId,
          question: "Sample simulation question",
          tool_errors: 0,
          failed_connectors: 0,
        })
      )
      setSimulateResult("")
      setSimulateOpen(true)
    },
    [branch, projectId, selectedChatId, userId]
  )

  const saveAutomation = useCallback(
    async (payload: {
      name: string
      description: string
      enabled: boolean
      trigger: Record<string, unknown>
      conditions: Record<string, unknown>
      action: Record<string, unknown>
      cooldown_sec: number
      run_access: "member_runnable" | "admin_only"
      tags: string[]
    }) => {
      setSaving(true)
      setError(null)
      try {
        if (editorMode === "edit" && editingAutomation?.id) {
          await backendJson(`/api/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(editingAutomation.id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
          setNotice("Automation updated.")
        } else {
          await backendJson(`/api/projects/${encodeURIComponent(projectId)}/automations`, {
            method: "POST",
            body: JSON.stringify(payload),
          })
          setNotice("Automation created.")
        }
        setEditorOpen(false)
        await loadAutomations()
      } catch (err) {
        setError(automationErrText(err))
      } finally {
        setSaving(false)
      }
    },
    [editingAutomation?.id, editorMode, loadAutomations, projectId]
  )

  const runAutomationNow = useCallback(
    async (
      automationId: string,
      options?: {
        dryRun?: boolean
        payload?: Record<string, unknown>
      }
    ) => {
      setSaving(true)
      setError(null)
      try {
        const payload = {
          project_id: projectId,
          chat_id: selectedChatId,
          branch,
          user_id: userId,
          ...(options?.payload || {}),
        }
        const out = await backendJson<{ run?: AutomationRunDoc }>(
          `/api/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(automationId)}/run`,
          {
            method: "POST",
            body: JSON.stringify({
              dry_run: Boolean(options?.dryRun),
              payload,
            }),
          }
        )
        setNotice(options?.dryRun ? "Automation simulation completed." : "Automation run started.")
        if (options?.dryRun && out?.run) {
          setSimulateResult(prettyJson(out.run))
        }
        await loadAutomations()
      } catch (err) {
        setError(automationErrText(err))
      } finally {
        setSaving(false)
      }
    },
    [branch, loadAutomations, projectId, selectedChatId, userId]
  )

  const toggleEnabled = useCallback(
    async (item: AutomationDoc, nextEnabled: boolean) => {
      setSaving(true)
      setError(null)
      try {
        await backendJson(`/api/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: nextEnabled }),
        })
        setAutomations((prev) => prev.map((row) => (row.id === item.id ? { ...row, enabled: nextEnabled } : row)))
      } catch (err) {
        setError(automationErrText(err))
      } finally {
        setSaving(false)
      }
    },
    [projectId]
  )

  const removeAutomation = useCallback(
    async (item: AutomationDoc) => {
      if (!window.confirm(`Delete automation "${item.name}"?`)) return
      setSaving(true)
      setError(null)
      try {
        await backendJson(`/api/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
        })
        setNotice("Automation deleted.")
        setAutomations((prev) => prev.filter((row) => row.id !== item.id))
        setRuns((prev) => prev.filter((row) => row.automation_id !== item.id))
      } catch (err) {
        setError(automationErrText(err))
      } finally {
        setSaving(false)
      }
    },
    [projectId]
  )

  const runSimulation = useCallback(async () => {
    if (!simulateTarget?.id) return
    let payload: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(simulatePayloadText || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Simulation payload must be a JSON object.")
        return
      }
      payload = parsed as Record<string, unknown>
    } catch {
      setError("Simulation payload JSON is invalid.")
      return
    }
    await runAutomationNow(simulateTarget.id, { dryRun: true, payload })
  }, [runAutomationNow, simulatePayloadText, simulateTarget?.id])

  const onSelectChat = useCallback(
    (chat: DrawerChat, fromProjectId: string) => {
      const nextBranch = (chat.branch || branch).trim() || branch
      const nextPath = buildChatPath(fromProjectId, nextBranch, chat.chat_id)
      saveLastChat({
        projectId: fromProjectId,
        branch: nextBranch,
        chatId: chat.chat_id,
        path: nextPath,
        ts: Date.now(),
      })
      router.push(nextPath)
    },
    [branch, router]
  )

  const onNewChat = useCallback(() => {
    const chatId = `${projectId}::${branch}::${userId}::${Date.now().toString(36)}`
    const path = buildChatPath(projectId, branch, chatId)
    saveLastChat({ projectId, branch, chatId, path, ts: Date.now() })
    router.push(path)
  }, [branch, projectId, router, userId])

  const runsByAutomation = useMemo(() => {
    const out: Record<string, AutomationRunDoc[]> = {}
    for (const row of runs || []) {
      const key = row.automation_id
      if (!key) continue
      if (!out[key]) out[key] = []
      out[key].push(row)
    }
    return out
  }, [runs])

  return (
    <ProjectDrawerLayout
      projectId={projectId}
      projectLabel={projectLabel}
      branch={branch}
      chatGroups={chatGroups}
      selectedChatId={selectedChatId}
      onSelectChat={onSelectChat}
      onNewChat={onNewChat}
      user={me}
      loadingChats={loadingChats}
      activeSection="automations"
    >
      <Box sx={{ minHeight: 0, flex: 1, overflow: "auto", px: { xs: 1.1, md: 1.6 }, pb: { xs: 1.2, md: 1.6 }, pt: { xs: 0.8, md: 1 } }}>
        <Stack spacing={1.1}>
          <Paper variant="outlined" sx={{ p: { xs: 1, md: 1.3 }, borderRadius: 1.5 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ md: "center" }}>
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.1em", fontSize: 10.5 }}>
                  Project Automations
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: "1rem", md: "1.12rem" } }}>
                  {projectLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Trigger actions automatically from chat events, connector health checks, or schedules.
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                <Button size="small" variant="outlined" startIcon={<TipsAndUpdatesRounded />} onClick={() => void loadAutomations()}>
                  Refresh
                </Button>
                <Button size="small" variant="contained" startIcon={<AddRounded />} onClick={openNewAutomation}>
                  New Automation
                </Button>
              </Stack>
            </Stack>
          </Paper>

          {error && <Alert severity="error">{error}</Alert>}
          {notice && <Alert severity="success">{notice}</Alert>}
          {loading && <Alert severity="info">Loading automations...</Alert>}

          <Box
            sx={{
              display: "grid",
              gap: 1,
              gridTemplateColumns: { xs: "1fr", xl: "1.7fr 1fr" },
            }}
          >
            <Paper variant="outlined" sx={{ p: { xs: 1, md: 1.2 }, borderRadius: 1.5 }}>
              <Stack spacing={0.8}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Configured Automations
                  </Typography>
                  <Chip size="small" label={automations.length} />
                </Stack>
                <Divider />
                <List dense sx={{ py: 0 }}>
                  {automations.map((item) => {
                    const itemRuns = runsByAutomation[item.id] || []
                    const latest = itemRuns[0]
                    return (
                      <Paper key={item.id} variant="outlined" sx={{ mb: 0.7, p: 0.8, borderRadius: 1.2 }}>
                        <Stack spacing={0.55}>
                          <Stack direction="row" spacing={0.7} alignItems="center" justifyContent="space-between">
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {item.name}
                            </Typography>
                            <FormControlLabel
                              sx={{ m: 0 }}
                              control={
                                <Switch
                                  size="small"
                                  checked={Boolean(item.enabled)}
                                  onChange={(e) => void toggleEnabled(item, e.target.checked)}
                                  disabled={saving}
                                />
                              }
                              label=""
                            />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {item.description || "No description"}
                          </Typography>
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                            <Chip size="small" label={`trigger:${item.trigger?.type || "-"}`} variant="outlined" />
                            <Chip size="small" label={`action:${item.action?.type || "-"}`} variant="outlined" />
                            <Chip
                              size="small"
                              label={item.run_access === "admin_only" ? "admin only" : "member runnable"}
                              variant="outlined"
                            />
                            {item.last_status ? (
                              <Chip
                                size="small"
                                label={item.last_status}
                                color={item.last_status === "succeeded" ? "success" : item.last_status === "failed" ? "error" : "default"}
                                variant={item.last_status === "succeeded" ? "filled" : "outlined"}
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            Last run: {prettyDate(item.last_run_at)} · Next run: {prettyDate(item.next_run_at)}
                          </Typography>
                          {item.last_error ? (
                            <Alert severity="error" sx={{ py: 0.2 }}>
                              {item.last_error}
                            </Alert>
                          ) : null}
                          {latest ? (
                            <Typography variant="caption" color="text.secondary">
                              Latest event: {latest.event_type} · {prettyDate(latest.started_at)} · {latest.status}
                            </Typography>
                          ) : null}
                          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<PlayArrowRounded />}
                              onClick={() => void runAutomationNow(item.id)}
                              disabled={saving}
                            >
                              Run
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<ScienceRounded />}
                              onClick={() => openSimulation(item)}
                              disabled={saving}
                            >
                              Simulate
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<EditRounded />}
                              onClick={() => openEdit(item)}
                              disabled={saving}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<DeleteRounded />}
                              onClick={() => void removeAutomation(item)}
                              disabled={saving}
                            >
                              Delete
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    )
                  })}
                  {!automations.length && !loading && (
                    <ListItemButton disabled>
                      <ListItemText primary="No automations configured." />
                    </ListItemButton>
                  )}
                </List>
              </Stack>
            </Paper>

            <Stack spacing={1}>
              <Paper variant="outlined" sx={{ p: { xs: 1, md: 1.2 }, borderRadius: 1.5 }}>
                <Stack spacing={0.8}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Templates
                    </Typography>
                    <Chip size="small" label={templates.length} />
                  </Stack>
                  <Divider />
                  <List dense sx={{ py: 0 }}>
                    {templates.map((tpl) => (
                      <Tooltip title={tpl.description || ""} key={tpl.key}>
                        <ListItemButton
                          onClick={() => openFromTemplate(tpl)}
                          sx={{ borderRadius: 1, mb: 0.35 }}
                        >
                          <ListItemText
                            primary={tpl.name}
                            secondary={`${tpl.trigger?.type || "-"} → ${tpl.action?.type || "-"} · ${tpl.run_access === "admin_only" ? "admin only" : "member runnable"}`}
                            primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
                            secondaryTypographyProps={{ fontSize: 11 }}
                          />
                        </ListItemButton>
                      </Tooltip>
                    ))}
                    {!templates.length && (
                      <ListItemButton disabled>
                        <ListItemText primary="No templates available." />
                      </ListItemButton>
                    )}
                  </List>
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: { xs: 1, md: 1.2 }, borderRadius: 1.5 }}>
                <Stack spacing={0.8}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Recent Runs
                    </Typography>
                    <Chip size="small" label={runs.length} />
                  </Stack>
                  <Divider />
                  <AutomationRunsTimeline runs={runs} />
                  <Divider />
                  <List dense sx={{ py: 0, maxHeight: 360, overflowY: "auto" }}>
                    {runs.map((row) => (
                      <ListItemButton key={row.id} disabled sx={{ borderRadius: 1, mb: 0.25 }}>
                        <ListItemText
                          primary={`${row.status} · ${row.triggered_by} · ${row.event_type}`}
                          secondary={`${prettyDate(row.started_at)} · ${row.duration_ms || 0}ms${row.error ? ` · ${row.error}` : ""}`}
                          primaryTypographyProps={{ fontSize: 12.5 }}
                          secondaryTypographyProps={{ fontSize: 11 }}
                        />
                      </ListItemButton>
                    ))}
                    {!runs.length && (
                      <ListItemButton disabled>
                        <ListItemText primary="No automation runs yet." />
                      </ListItemButton>
                    )}
                  </List>
                </Stack>
              </Paper>
            </Stack>
          </Box>
        </Stack>
      </Box>

      <AutomationEditorDialog
        open={editorOpen}
        mode={editorMode}
        initial={editingAutomation}
        template={seedTemplate}
        saving={saving}
        error={error}
        onClose={() => setEditorOpen(false)}
        onSave={saveAutomation}
      />

      <Dialog open={simulateOpen} onClose={() => setSimulateOpen(false)} fullWidth maxWidth="md">
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Dry-run Simulation
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Automation: {simulateTarget?.name || "-"}
            </Typography>
            <TextField
              label="Sample Event Payload (JSON)"
              value={simulatePayloadText}
              onChange={(e) => setSimulatePayloadText(e.target.value)}
              fullWidth
              multiline
              minRows={10}
              sx={{
                "& .MuiInputBase-input": {
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12.5,
                },
              }}
            />
            <TextField
              label="Simulation Result"
              value={simulateResult}
              fullWidth
              multiline
              minRows={8}
              InputProps={{ readOnly: true }}
              sx={{
                "& .MuiInputBase-input": {
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12.5,
                },
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSimulateOpen(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ScienceRounded />}
            onClick={() => void runSimulation()}
            disabled={saving || !simulateTarget?.id}
          >
            {saving ? "Running..." : "Run Dry-Run"}
          </Button>
        </DialogActions>
      </Dialog>
    </ProjectDrawerLayout>
  )
}
