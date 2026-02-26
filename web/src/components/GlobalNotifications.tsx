"use client"

import NotificationsRounded from "@mui/icons-material/NotificationsRounded"
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Typography,
} from "@mui/material"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import AppDialogTitle from "@/components/AppDialogTitle"
import { OPEN_GLOBAL_NOTIFICATIONS_EVENT } from "@/features/notifications/events"
import { backendJson } from "@/lib/backend"
import type { ListNotificationsResponse, NotificationDoc } from "@/features/notifications/types"

const POLL_INTERVAL_MS = 8000
const MAX_ITEMS = 300
const MAX_QUEUE = 20

function normalizeSeverity(value: string | undefined): "info" | "success" | "warning" | "error" {
  const v = String(value || "info").toLowerCase()
  if (v === "success" || v === "warning" || v === "error") return v
  return "info"
}

function formatNotificationTime(iso?: string | null): string {
  if (!iso) return "-"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString()
}

export default function GlobalNotifications() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<NotificationDoc[]>([])
  const [showDismissed, setShowDismissed] = useState(true)
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({})

  const [toastQueue, setToastQueue] = useState<NotificationDoc[]>([])
  const [toastCurrent, setToastCurrent] = useState<NotificationDoc | null>(null)
  const [toastOpen, setToastOpen] = useState(false)

  const initializedRef = useRef(false)
  const seenIdsRef = useRef<Set<string>>(new Set())

  const loadNotifications = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent)
      if (!silent) setLoading(true)
      try {
        const res = await backendJson<ListNotificationsResponse>(
          `/api/notifications?include_dismissed=1&limit=${MAX_ITEMS}`
        )
        const next = (res.items || []).filter((x): x is NotificationDoc => Boolean(x && x.id))
        if (initializedRef.current) {
          const newLive = next.filter((item) => !item.dismissed && !seenIdsRef.current.has(item.id))
          if (newLive.length > 0) {
            setToastQueue((prev) => [...prev, ...newLive].slice(-MAX_QUEUE))
          }
        }
        const seen = new Set(seenIdsRef.current)
        for (const item of next) seen.add(item.id)
        seenIdsRef.current = seen
        initializedRef.current = true
        setItems(next)
        setError(null)
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    void loadNotifications({ silent: true })
    const timer = window.setInterval(() => {
      void loadNotifications({ silent: true })
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [loadNotifications])

  useEffect(() => {
    if (toastOpen || toastCurrent || toastQueue.length === 0) return
    const [first, ...rest] = toastQueue
    setToastCurrent(first)
    setToastQueue(rest)
    setToastOpen(true)
  }, [toastCurrent, toastOpen, toastQueue])

  const activeCount = useMemo(() => items.filter((x) => !x.dismissed).length, [items])
  const floatingTriggerHidden = useMemo(() => {
    const path = String(pathname || "")
    if (path === "/chat" || path.startsWith("/chat/")) return true
    if (!path.startsWith("/projects/")) return false
    return path !== "/projects"
  }, [pathname])
  const visibleItems = useMemo(
    () => (showDismissed ? items : items.filter((item) => !item.dismissed)),
    [items, showDismissed]
  )

  const setDismissed = useCallback(async (id: string, dismissed: boolean) => {
    if (!id) return
    setUpdatingIds((prev) => ({ ...prev, [id]: true }))
    try {
      const res = await backendJson<{ item?: NotificationDoc }>(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ dismissed }),
      })
      const row = res.item
      if (row?.id) {
        setItems((prev) => prev.map((item) => (item.id === row.id ? row : item)))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdatingIds((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }, [])

  const dismissAll = useCallback(async () => {
    setLoading(true)
    try {
      await backendJson<{ dismissed_count: number }>("/api/notifications/dismiss-all", {
        method: "POST",
        body: JSON.stringify({}),
      })
      setItems((prev) =>
        prev.map((item) =>
          item.dismissed
            ? item
            : {
                ...item,
                dismissed: true,
                dismissed_at: new Date().toISOString(),
              }
        )
      )
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      void loadNotifications()
    }
    window.addEventListener(OPEN_GLOBAL_NOTIFICATIONS_EVENT, onOpen as EventListener)
    return () => {
      window.removeEventListener(OPEN_GLOBAL_NOTIFICATIONS_EVENT, onOpen as EventListener)
    }
  }, [loadNotifications])

  return (
    <>
      {!floatingTriggerHidden ? (
        <Box
          sx={{
            position: "fixed",
            top: { xs: 10, md: 12 },
            right: { xs: 10, md: 14 },
            zIndex: (theme) => theme.zIndex.modal + 10,
          }}
        >
          <Paper
            variant="outlined"
            sx={{
              borderRadius: 999,
              bgcolor: "rgba(9, 14, 28, 0.86)",
              borderColor: "rgba(148,163,184,0.35)",
            }}
          >
            <IconButton
              size="small"
              color="inherit"
              onClick={() => {
                setOpen(true)
                void loadNotifications()
              }}
              aria-label="open notifications"
            >
              <Badge color="error" badgeContent={activeCount} max={99}>
                <NotificationsRounded fontSize="small" />
              </Badge>
            </IconButton>
          </Paper>
        </Box>
      ) : null}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <AppDialogTitle
          title="Notifications"
          subtitle="Automation and system events."
          onClose={() => setOpen(false)}
        />
        <DialogContent dividers sx={{ pt: 1.1 }}>
          <Stack spacing={1}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">
                {activeCount} active · {items.length} total
              </Typography>
              <FormControlLabel
                control={<Switch size="small" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />}
                label={<Typography variant="caption">Show dismissed</Typography>}
              />
            </Stack>
            <Stack spacing={0.75} sx={{ maxHeight: 440, overflowY: "auto" }}>
              {loading ? (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Loading notifications...
                </Alert>
              ) : null}
              {!loading && visibleItems.length === 0 ? (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  No notifications to show.
                </Alert>
              ) : null}
              {visibleItems.map((item) => {
                const severity = normalizeSeverity(item.severity)
                return (
                  <Paper key={item.id} variant="outlined" sx={{ p: 0.9, borderRadius: 1 }}>
                    <Stack spacing={0.6}>
                      <Stack direction="row" spacing={0.6} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                          <Alert severity={severity} icon={false} sx={{ py: 0, px: 0.75 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              {severity}
                            </Typography>
                          </Alert>
                          <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
                            {item.title || "Notification"}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {formatNotificationTime(item.created_at)}
                        </Typography>
                      </Stack>
                      {item.message ? (
                        <Typography variant="caption" color="text.secondary">
                          {item.message}
                        </Typography>
                      ) : null}
                      <Stack direction="row" spacing={0.6} alignItems="center" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {item.source || "system"}
                          {item.project_id ? ` · ${item.project_id}` : ""}
                        </Typography>
                        <Button
                          size="small"
                          variant="text"
                          disabled={Boolean(updatingIds[item.id])}
                          onClick={() => void setDismissed(item.id, !item.dismissed)}
                        >
                          {item.dismissed ? "Restore" : "Dismiss"}
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void loadNotifications()} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={() => void dismissAll()} disabled={loading || activeCount <= 0}>
            Dismiss all active
          </Button>
          <Button variant="contained" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toastOpen}
        autoHideDuration={5600}
        onClose={(_, reason) => {
          if (reason === "clickaway") return
          setToastOpen(false)
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        TransitionProps={{
          onExited: () => setToastCurrent(null),
        }}
      >
        <Alert
          severity={normalizeSeverity(toastCurrent?.severity)}
          variant="filled"
          sx={{ minWidth: 280 }}
          onClose={() => setToastOpen(false)}
        >
          <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 700 }}>
            {toastCurrent?.title || "Notification"}
          </Typography>
          {toastCurrent?.message ? (
            <Typography variant="caption" sx={{ opacity: 0.92 }}>
              {toastCurrent.message}
            </Typography>
          ) : null}
        </Alert>
      </Snackbar>
    </>
  )
}
