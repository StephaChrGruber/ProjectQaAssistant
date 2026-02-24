"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from "@mui/material"
import AppDialogTitle from "@/components/AppDialogTitle"
import { prettyJson, type AutomationDoc, type AutomationTemplate } from "@/features/automations/types"

type SavePayload = {
  name: string
  description: string
  enabled: boolean
  trigger: Record<string, unknown>
  conditions: Record<string, unknown>
  action: Record<string, unknown>
  cooldown_sec: number
  tags: string[]
}

type Props = {
  open: boolean
  mode: "create" | "edit"
  initial?: AutomationDoc | null
  template?: AutomationTemplate | null
  saving?: boolean
  error?: string | null
  onClose: () => void
  onSave: (payload: SavePayload) => Promise<void> | void
}

const EVENT_TYPES = ["ask_agent_completed", "connector_health_checked"]
const ACTION_TYPES = [
  "create_chat_task",
  "append_chat_message",
  "request_user_input",
  "run_incremental_ingestion",
  "generate_documentation",
]

function defaultActionParams(actionType: string): Record<string, unknown> {
  if (actionType === "create_chat_task") {
    return { title: "Automation task", details: "", status: "open", chat_id: "{{chat_id}}" }
  }
  if (actionType === "append_chat_message") {
    return { chat_id: "{{chat_id}}", role: "assistant", content: "Automation note." }
  }
  if (actionType === "request_user_input") {
    return {
      chat_id: "{{chat_id}}",
      question: "Can you clarify this request?",
      answer_mode: "single_choice",
      options: ["Option 1", "Option 2"],
    }
  }
  if (actionType === "run_incremental_ingestion") {
    return { connectors: [] }
  }
  return { branch: "main" }
}

export default function AutomationEditorDialog(props: Props) {
  const { open, mode, initial, template, saving = false, error, onClose, onSave } = props

  const seed = useMemo(() => {
    if (initial) return initial
    if (template) {
      return {
        id: "",
        project_id: "",
        name: template.name,
        description: template.description || "",
        enabled: true,
        trigger: template.trigger,
        conditions: template.conditions || {},
        action: template.action,
        cooldown_sec: template.cooldown_sec || 0,
        tags: template.tags || [],
      } as AutomationDoc
    }
    return null
  }, [initial, template])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [triggerType, setTriggerType] = useState<"event" | "schedule" | "manual">("event")
  const [eventType, setEventType] = useState("ask_agent_completed")
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [keywordContains, setKeywordContains] = useState("")
  const [toolErrorsMin, setToolErrorsMin] = useState<number | "">("")
  const [failedConnectorsMin, setFailedConnectorsMin] = useState<number | "">("")
  const [actionType, setActionType] = useState("create_chat_task")
  const [actionParamsText, setActionParamsText] = useState("{}")
  const [cooldownSec, setCooldownSec] = useState(0)
  const [tagsText, setTagsText] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const trigger = seed?.trigger || { type: "event", event_type: "ask_agent_completed" }
    const conditions = (seed?.conditions || {}) as Record<string, unknown>
    const action = (seed?.action || { type: "create_chat_task", params: {} }) as Record<string, unknown>
    const triggerTypeSeed = String(trigger.type || "event") as "event" | "schedule" | "manual"
    const actionTypeSeed = String(action.type || "create_chat_task")
    setName(seed?.name || "")
    setDescription(seed?.description || "")
    setEnabled(seed?.enabled ?? true)
    setTriggerType(triggerTypeSeed)
    setEventType(String(trigger.event_type || "ask_agent_completed"))
    setIntervalMinutes(Number(trigger.interval_minutes || 60))
    const keywords = Array.isArray(conditions.keyword_contains) ? conditions.keyword_contains : []
    setKeywordContains(keywords.map((x) => String(x)).join(", "))
    setToolErrorsMin(
      conditions.tool_errors_min != null && Number.isFinite(Number(conditions.tool_errors_min))
        ? Number(conditions.tool_errors_min)
        : ""
    )
    setFailedConnectorsMin(
      conditions.failed_connectors_min != null && Number.isFinite(Number(conditions.failed_connectors_min))
        ? Number(conditions.failed_connectors_min)
        : ""
    )
    setActionType(actionTypeSeed)
    setActionParamsText(prettyJson((action.params as Record<string, unknown>) || defaultActionParams(actionTypeSeed)))
    setCooldownSec(Number(seed?.cooldown_sec || 0))
    setTagsText(Array.isArray(seed?.tags) ? seed?.tags.join(", ") : "")
    setValidationError(null)
  }, [open, seed])

  const title = mode === "edit" ? "Edit Automation" : "Create Automation"

  const handleSave = async () => {
    setValidationError(null)
    const cleanName = name.trim()
    if (!cleanName) {
      setValidationError("Name is required.")
      return
    }
    let actionParams: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(actionParamsText || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setValidationError("Action params must be a JSON object.")
        return
      }
      actionParams = parsed as Record<string, unknown>
    } catch {
      setValidationError("Action params JSON is invalid.")
      return
    }
    const tags = tagsText
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 32)
    const conditions: Record<string, unknown> = {}
    const keywordValues = keywordContains
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
    if (keywordValues.length) conditions.keyword_contains = keywordValues
    if (toolErrorsMin !== "") conditions.tool_errors_min = Number(toolErrorsMin)
    if (failedConnectorsMin !== "") conditions.failed_connectors_min = Number(failedConnectorsMin)

    const trigger: Record<string, unknown> =
      triggerType === "schedule"
        ? { type: "schedule", interval_minutes: Math.max(1, Math.min(Number(intervalMinutes || 60), 24 * 30)) }
        : triggerType === "event"
          ? { type: "event", event_type: eventType }
          : { type: "manual" }

    await onSave({
      name: cleanName,
      description: description.trim(),
      enabled,
      trigger,
      conditions,
      action: { type: actionType, params: actionParams },
      cooldown_sec: Math.max(0, Math.min(Number(cooldownSec || 0), 24 * 3600)),
      tags,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <AppDialogTitle title={title} subtitle="Configure trigger conditions and actions." onClose={onClose} />
      <DialogContent dividers sx={{ pt: 1.4 }}>
        <Stack spacing={1.2}>
          {(error || validationError) && <Alert severity="error">{error || validationError}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label="Enabled"
          />
          <Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <FormControl fullWidth size="small">
                <InputLabel id="automation-trigger-type">Trigger Type</InputLabel>
                <Select
                  labelId="automation-trigger-type"
                  label="Trigger Type"
                  value={triggerType}
                  onChange={(e) => setTriggerType(String(e.target.value) as "event" | "schedule" | "manual")}
                >
                  <MenuItem value="event">Event</MenuItem>
                  <MenuItem value="schedule">Schedule</MenuItem>
                  <MenuItem value="manual">Manual</MenuItem>
                </Select>
              </FormControl>
              {triggerType === "event" && (
                <FormControl fullWidth size="small">
                  <InputLabel id="automation-event-type">Event</InputLabel>
                  <Select
                    labelId="automation-event-type"
                    label="Event"
                    value={eventType}
                    onChange={(e) => setEventType(String(e.target.value))}
                  >
                    {EVENT_TYPES.map((item) => (
                      <MenuItem key={item} value={item}>
                        {item}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {triggerType === "schedule" && (
                <TextField
                  label="Interval (minutes)"
                  type="number"
                  size="small"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value || 60))}
                  fullWidth
                />
              )}
            </Stack>
          </Box>
          <Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                size="small"
                label="Condition: keyword_contains (CSV)"
                value={keywordContains}
                onChange={(e) => setKeywordContains(e.target.value)}
                fullWidth
              />
              <TextField
                size="small"
                label="Condition: tool_errors_min"
                type="number"
                value={toolErrorsMin}
                onChange={(e) => setToolErrorsMin(e.target.value === "" ? "" : Number(e.target.value))}
                fullWidth
              />
              <TextField
                size="small"
                label="Condition: failed_connectors_min"
                type="number"
                value={failedConnectorsMin}
                onChange={(e) => setFailedConnectorsMin(e.target.value === "" ? "" : Number(e.target.value))}
                fullWidth
              />
            </Stack>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="automation-action-type">Action Type</InputLabel>
              <Select
                labelId="automation-action-type"
                label="Action Type"
                value={actionType}
                onChange={(e) => {
                  const next = String(e.target.value)
                  setActionType(next)
                  setActionParamsText(prettyJson(defaultActionParams(next)))
                }}
              >
                {ACTION_TYPES.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Cooldown (seconds)"
              type="number"
              size="small"
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value || 0))}
              fullWidth
            />
            <TextField
              label="Tags (CSV)"
              size="small"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              fullWidth
            />
          </Stack>
          <TextField
            label="Action Params (JSON)"
            value={actionParamsText}
            onChange={(e) => setActionParamsText(e.target.value)}
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Create Automation"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

