"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material"
import AppDialogTitle from "@/components/AppDialogTitle"
import {
  ACTION_DEFINITIONS,
  CONDITION_TUTORIAL_LINES,
  EVENT_OPTIONS,
  PARAMETER_TUTORIAL_LINES,
  TRIGGER_OPTIONS,
  defaultActionParams,
  getActionDefinition,
  type ActionDefinition,
  type ActionField,
  type TriggerType,
} from "@/features/automations/catalog"
import { prettyJson, type AutomationDoc, type AutomationTemplate } from "@/features/automations/types"

type SavePayload = {
  name: string
  description: string
  enabled: boolean
  trigger: Record<string, unknown>
  conditions: Record<string, unknown>
  action: Record<string, unknown>
  cooldown_sec: number
  run_access: "member_runnable" | "admin_only"
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

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
}

function buildActionInputs(def: ActionDefinition, params: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...def.defaults, ...params }
  const out: Record<string, unknown> = {}
  for (const field of def.fields) {
    const raw = merged[field.key]
    if (field.type === "boolean") {
      out[field.key] = Boolean(raw)
      continue
    }
    if (field.type === "csv") {
      if (Array.isArray(raw)) {
        out[field.key] = raw.map((x) => String(x)).join(", ")
      } else {
        out[field.key] = toStringValue(raw)
      }
      continue
    }
    if (field.type === "json") {
      out[field.key] = prettyJson(raw ?? {})
      continue
    }
    if (field.type === "number") {
      out[field.key] = raw === undefined || raw === null || raw === "" ? "" : String(raw)
      continue
    }
    out[field.key] = toStringValue(raw)
  }
  return out
}

function hasUnknownActionParams(def: ActionDefinition, params: Record<string, unknown>): boolean {
  const known = new Set(def.fields.map((f) => f.key))
  return Object.keys(params || {}).some((key) => !known.has(key))
}

function renderActionField(
  field: ActionField,
  value: unknown,
  onChange: (next: unknown) => void,
  disabled: boolean
) {
  if (field.type === "boolean") {
    return (
      <FormControlLabel
        key={field.key}
        control={<Switch size="small" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />}
        label={field.label}
      />
    )
  }

  if (field.type === "select") {
    return (
      <FormControl key={field.key} size="small" fullWidth>
        <InputLabel id={`action-field-${field.key}`}>{field.label}</InputLabel>
        <Select
          labelId={`action-field-${field.key}`}
          label={field.label}
          value={toStringValue(value)}
          onChange={(e) => onChange(String(e.target.value))}
          disabled={disabled}
        >
          {(field.options || []).map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    )
  }

  if (field.type === "multiline") {
    return (
      <TextField
        key={field.key}
        label={field.label}
        value={toStringValue(value)}
        onChange={(e) => onChange(e.target.value)}
        fullWidth
        size="small"
        multiline
        minRows={3}
        placeholder={field.placeholder}
        disabled={disabled}
        helperText={field.help}
      />
    )
  }

  if (field.type === "json") {
    return (
      <TextField
        key={field.key}
        label={field.label}
        value={toStringValue(value)}
        onChange={(e) => onChange(e.target.value)}
        fullWidth
        size="small"
        multiline
        minRows={4}
        placeholder={field.placeholder}
        disabled={disabled}
        helperText={field.help || "Must be valid JSON."}
        sx={{
          "& .MuiInputBase-input": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
          },
        }}
      />
    )
  }

  return (
    <TextField
      key={field.key}
      label={field.label}
      value={toStringValue(value)}
      onChange={(e) => onChange(e.target.value)}
      fullWidth
      size="small"
      type={field.type === "number" ? "number" : "text"}
      placeholder={field.placeholder}
      disabled={disabled}
      helperText={field.help}
    />
  )
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
        run_access: template.run_access || "member_runnable",
      } as AutomationDoc
    }
    return null
  }, [initial, template])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [enabled, setEnabled] = useState(true)

  const [triggerType, setTriggerType] = useState<TriggerType>("event")
  const [eventType, setEventType] = useState("ask_agent_completed")
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [dailyHour, setDailyHour] = useState(9)
  const [dailyMinute, setDailyMinute] = useState(0)
  const [weeklyDaysText, setWeeklyDaysText] = useState("mon, tue, wed, thu, fri")
  const [onceRunAt, setOnceRunAt] = useState("")

  const [matchMode, setMatchMode] = useState<"all" | "any">("all")
  const [keywordContains, setKeywordContains] = useState("")
  const [keywordExcludes, setKeywordExcludes] = useState("")
  const [answerContains, setAnswerContains] = useState("")
  const [questionRegex, setQuestionRegex] = useState("")
  const [branchIn, setBranchIn] = useState("")
  const [userIn, setUserIn] = useState("")
  const [toolErrorsMin, setToolErrorsMin] = useState<number | "">("")
  const [toolErrorsMax, setToolErrorsMax] = useState<number | "">("")
  const [toolCallsMin, setToolCallsMin] = useState<number | "">("")
  const [toolCallsMax, setToolCallsMax] = useState<number | "">("")
  const [sourcesCountMin, setSourcesCountMin] = useState<number | "">("")
  const [failedConnectorsMin, setFailedConnectorsMin] = useState<number | "">("")
  const [failedConnectorsMax, setFailedConnectorsMax] = useState<number | "">("")
  const [groundedIs, setGroundedIs] = useState<"" | "true" | "false">("")
  const [pendingUserInputIs, setPendingUserInputIs] = useState<"" | "true" | "false">("")
  const [llmProviderIn, setLlmProviderIn] = useState("")
  const [llmModelIn, setLlmModelIn] = useState("")

  const [actionType, setActionType] = useState("create_chat_task")
  const [actionInputs, setActionInputs] = useState<Record<string, unknown>>({})
  const [actionAdvancedEnabled, setActionAdvancedEnabled] = useState(false)
  const [actionAdvancedText, setActionAdvancedText] = useState("{}")

  const [cooldownSec, setCooldownSec] = useState(0)
  const [runAccess, setRunAccess] = useState<"member_runnable" | "admin_only">("member_runnable")
  const [tagsText, setTagsText] = useState("")

  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    const trigger = seed?.trigger || { type: "event", event_type: "ask_agent_completed" }
    const conditions = (seed?.conditions || {}) as Record<string, unknown>
    const action = (seed?.action || { type: "create_chat_task", params: {} }) as Record<string, unknown>

    const triggerTypeSeed = String(trigger.type || "event") as TriggerType
    const actionTypeSeed = String(action.type || "create_chat_task")
    const actionDef = getActionDefinition(actionTypeSeed)
    const actionParamsSeed = (action.params as Record<string, unknown>) || {}

    setName(seed?.name || "")
    setDescription(seed?.description || "")
    setEnabled(seed?.enabled ?? true)

    setTriggerType(triggerTypeSeed)
    setEventType(String(trigger.event_type || "ask_agent_completed"))
    setIntervalMinutes(Number(trigger.interval_minutes || 60))
    setDailyHour(Number(trigger.hour || 9))
    setDailyMinute(Number(trigger.minute || 0))
    setWeeklyDaysText(Array.isArray(trigger.weekdays) ? trigger.weekdays.map((x) => String(x)).join(", ") : "mon, tue, wed, thu, fri")
    setOnceRunAt(String(trigger.run_at || ""))

    setMatchMode(String(conditions.match_mode || "all") === "any" ? "any" : "all")
    setKeywordContains(Array.isArray(conditions.keyword_contains) ? conditions.keyword_contains.map((x) => String(x)).join(", ") : "")
    setKeywordExcludes(Array.isArray(conditions.keyword_excludes) ? conditions.keyword_excludes.map((x) => String(x)).join(", ") : "")
    setAnswerContains(Array.isArray(conditions.answer_contains) ? conditions.answer_contains.map((x) => String(x)).join(", ") : "")
    setQuestionRegex(String(conditions.question_regex || ""))
    setBranchIn(Array.isArray(conditions.branch_in) ? conditions.branch_in.map((x) => String(x)).join(", ") : "")
    setUserIn(Array.isArray(conditions.user_in) ? conditions.user_in.map((x) => String(x)).join(", ") : "")
    setToolErrorsMin(conditions.tool_errors_min != null ? Number(conditions.tool_errors_min) : "")
    setToolErrorsMax(conditions.tool_errors_max != null ? Number(conditions.tool_errors_max) : "")
    setToolCallsMin(conditions.tool_calls_min != null ? Number(conditions.tool_calls_min) : "")
    setToolCallsMax(conditions.tool_calls_max != null ? Number(conditions.tool_calls_max) : "")
    setSourcesCountMin(conditions.sources_count_min != null ? Number(conditions.sources_count_min) : "")
    setFailedConnectorsMin(conditions.failed_connectors_min != null ? Number(conditions.failed_connectors_min) : "")
    setFailedConnectorsMax(conditions.failed_connectors_max != null ? Number(conditions.failed_connectors_max) : "")
    setGroundedIs(
      conditions.grounded_is === true ? "true" : conditions.grounded_is === false ? "false" : ""
    )
    setPendingUserInputIs(
      conditions.pending_user_input_is === true ? "true" : conditions.pending_user_input_is === false ? "false" : ""
    )
    setLlmProviderIn(Array.isArray(conditions.llm_provider_in) ? conditions.llm_provider_in.map((x) => String(x)).join(", ") : "")
    setLlmModelIn(Array.isArray(conditions.llm_model_in) ? conditions.llm_model_in.map((x) => String(x)).join(", ") : "")

    setActionType(actionTypeSeed)
    setActionInputs(buildActionInputs(actionDef, actionParamsSeed))
    setActionAdvancedText(prettyJson(actionParamsSeed && Object.keys(actionParamsSeed).length ? actionParamsSeed : defaultActionParams(actionTypeSeed)))
    setActionAdvancedEnabled(hasUnknownActionParams(actionDef, actionParamsSeed))

    setCooldownSec(Number(seed?.cooldown_sec || 0))
    setRunAccess(String(seed?.run_access || "member_runnable") === "admin_only" ? "admin_only" : "member_runnable")
    setTagsText(Array.isArray(seed?.tags) ? seed?.tags.join(", ") : "")
    setValidationError(null)
  }, [open, seed])

  const title = mode === "edit" ? "Edit Automation" : "Create Automation"
  const selectedActionDef = useMemo(() => getActionDefinition(actionType), [actionType])

  const setActionInput = (key: string, next: unknown) => {
    setActionInputs((prev) => ({ ...prev, [key]: next }))
  }

  const parseActionFromInputs = (): Record<string, unknown> => {
    if (actionAdvancedEnabled) {
      let parsed: unknown
      try {
        parsed = JSON.parse(actionAdvancedText || "{}")
      } catch {
        throw new Error("Advanced Action JSON is invalid.")
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Advanced Action JSON must be an object.")
      }
      return parsed as Record<string, unknown>
    }

    const out: Record<string, unknown> = {}
    for (const field of selectedActionDef.fields) {
      const value = actionInputs[field.key]
      if (field.type === "boolean") {
        out[field.key] = Boolean(value)
        continue
      }
      if (field.type === "number") {
        const raw = toStringValue(value).trim()
        if (!raw) {
          if (field.required) throw new Error(`${field.label} is required.`)
          continue
        }
        const num = Number(raw)
        if (!Number.isFinite(num)) throw new Error(`${field.label} must be a valid number.`)
        out[field.key] = num
        continue
      }
      if (field.type === "csv") {
        const arr = csvToList(toStringValue(value))
        if (field.required && arr.length === 0) throw new Error(`${field.label} is required.`)
        if (arr.length > 0) out[field.key] = arr
        continue
      }
      if (field.type === "json") {
        const raw = toStringValue(value).trim()
        if (!raw) {
          if (field.required) throw new Error(`${field.label} is required.`)
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new Error(`${field.label} must be valid JSON.`)
        }
        out[field.key] = parsed
        continue
      }

      const raw = toStringValue(value).trim()
      if (field.required && !raw) throw new Error(`${field.label} is required.`)
      if (raw || field.required) out[field.key] = raw
    }

    if (selectedActionDef.type === "request_user_input") {
      const modeValue = String(out.answer_mode || "open_text")
      const options = Array.isArray(out.options) ? out.options : []
      if (modeValue === "single_choice" && options.length < 2) {
        throw new Error("request_user_input requires at least two options for single_choice mode.")
      }
    }

    return out
  }

  const handleSave = async () => {
    setValidationError(null)
    const cleanName = name.trim()
    if (!cleanName) {
      setValidationError("Name is required.")
      return
    }

    let actionParams: Record<string, unknown>
    try {
      actionParams = parseActionFromInputs()
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
      return
    }

    const tags = csvToList(tagsText).slice(0, 32)

    const conditions: Record<string, unknown> = { match_mode: matchMode }
    if (csvToList(keywordContains).length) conditions.keyword_contains = csvToList(keywordContains)
    if (csvToList(keywordExcludes).length) conditions.keyword_excludes = csvToList(keywordExcludes)
    if (csvToList(answerContains).length) conditions.answer_contains = csvToList(answerContains)
    if (questionRegex.trim()) conditions.question_regex = questionRegex.trim()
    if (csvToList(branchIn).length) conditions.branch_in = csvToList(branchIn)
    if (csvToList(userIn).length) conditions.user_in = csvToList(userIn)
    if (toolErrorsMin !== "") conditions.tool_errors_min = Number(toolErrorsMin)
    if (toolErrorsMax !== "") conditions.tool_errors_max = Number(toolErrorsMax)
    if (toolCallsMin !== "") conditions.tool_calls_min = Number(toolCallsMin)
    if (toolCallsMax !== "") conditions.tool_calls_max = Number(toolCallsMax)
    if (sourcesCountMin !== "") conditions.sources_count_min = Number(sourcesCountMin)
    if (failedConnectorsMin !== "") conditions.failed_connectors_min = Number(failedConnectorsMin)
    if (failedConnectorsMax !== "") conditions.failed_connectors_max = Number(failedConnectorsMax)
    if (groundedIs) conditions.grounded_is = groundedIs === "true"
    if (pendingUserInputIs) conditions.pending_user_input_is = pendingUserInputIs === "true"
    if (csvToList(llmProviderIn).length) conditions.llm_provider_in = csvToList(llmProviderIn)
    if (csvToList(llmModelIn).length) conditions.llm_model_in = csvToList(llmModelIn)

    let trigger: Record<string, unknown>
    if (triggerType === "schedule") {
      trigger = { type: "schedule", interval_minutes: Math.max(1, Math.min(Number(intervalMinutes || 60), 24 * 30)) }
    } else if (triggerType === "daily") {
      trigger = {
        type: "daily",
        hour: Math.max(0, Math.min(Number(dailyHour || 0), 23)),
        minute: Math.max(0, Math.min(Number(dailyMinute || 0), 59)),
      }
    } else if (triggerType === "weekly") {
      trigger = {
        type: "weekly",
        hour: Math.max(0, Math.min(Number(dailyHour || 0), 23)),
        minute: Math.max(0, Math.min(Number(dailyMinute || 0), 59)),
        weekdays: csvToList(weeklyDaysText),
      }
    } else if (triggerType === "once") {
      const runAt = onceRunAt.trim()
      if (!runAt) {
        setValidationError("One-time trigger requires a UTC run_at datetime.")
        return
      }
      trigger = { type: "once", run_at: runAt }
    } else if (triggerType === "event") {
      const cleanEvent = eventType.trim().toLowerCase()
      if (!cleanEvent) {
        setValidationError("Event trigger requires an event name.")
        return
      }
      trigger = { type: "event", event_type: cleanEvent }
    } else {
      trigger = { type: "manual" }
    }

    await onSave({
      name: cleanName,
      description: description.trim(),
      enabled,
      trigger,
      conditions,
      action: { type: actionType, params: actionParams },
      cooldown_sec: Math.max(0, Math.min(Number(cooldownSec || 0), 24 * 3600)),
      run_access: runAccess,
      tags,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <AppDialogTitle title={title} subtitle="Configure triggers, conditions, and actions." onClose={onClose} />
      <DialogContent dividers sx={{ pt: 1.4 }}>
        <Stack spacing={1.2}>
          {(error || validationError) && <Alert severity="error">{error || validationError}</Alert>}

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" required />
            <TextField label="Tags (CSV)" size="small" value={tagsText} onChange={(e) => setTagsText(e.target.value)} fullWidth />
          </Stack>

          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />

          <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
            <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label="Enabled" />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="automation-run-access">Run Access</InputLabel>
              <Select
                labelId="automation-run-access"
                label="Run Access"
                value={runAccess}
                onChange={(e) => setRunAccess(String(e.target.value) === "admin_only" ? "admin_only" : "member_runnable")}
              >
                <MenuItem value="member_runnable">Member runnable</MenuItem>
                <MenuItem value="admin_only">Admin only</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Cooldown (seconds)"
              type="number"
              size="small"
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value || 0))}
              sx={{ width: 180 }}
            />
          </Stack>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Trigger</Typography>
            <Typography variant="caption" color="text.secondary">Choose when this automation should run.</Typography>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="automation-trigger-type">Trigger Type</InputLabel>
              <Select
                labelId="automation-trigger-type"
                label="Trigger Type"
                value={triggerType}
                onChange={(e) => setTriggerType(String(e.target.value) as TriggerType)}
              >
                {TRIGGER_OPTIONS.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {triggerType === "event" && (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel id="automation-event-type">Event</InputLabel>
                  <Select
                    labelId="automation-event-type"
                    label="Event"
                    value={eventType}
                    onChange={(e) => setEventType(String(e.target.value))}
                  >
                    {EVENT_OPTIONS.map((item) => (
                      <MenuItem key={item.value} value={item.value}>
                        {item.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Or custom event name"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  fullWidth
                />
              </>
            )}
            {triggerType === "schedule" && (
              <TextField
                label="Interval minutes"
                type="number"
                size="small"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value || 60))}
                fullWidth
              />
            )}
            {(triggerType === "daily" || triggerType === "weekly") && (
              <>
                <TextField
                  label="Hour (UTC)"
                  type="number"
                  size="small"
                  value={dailyHour}
                  onChange={(e) => setDailyHour(Number(e.target.value || 0))}
                  fullWidth
                />
                <TextField
                  label="Minute (UTC)"
                  type="number"
                  size="small"
                  value={dailyMinute}
                  onChange={(e) => setDailyMinute(Number(e.target.value || 0))}
                  fullWidth
                />
              </>
            )}
            {triggerType === "weekly" && (
              <TextField
                label="Weekdays (CSV)"
                size="small"
                value={weeklyDaysText}
                onChange={(e) => setWeeklyDaysText(e.target.value)}
                fullWidth
                placeholder="mon, tue, wed"
              />
            )}
            {triggerType === "once" && (
              <TextField
                label="Run at (UTC ISO)"
                size="small"
                value={onceRunAt}
                onChange={(e) => setOnceRunAt(e.target.value)}
                fullWidth
                placeholder="2026-03-01T09:00:00Z"
              />
            )}
          </Stack>

          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
            {TRIGGER_OPTIONS.map((row) => (
              <Chip key={row.value} size="small" label={`${row.label}: ${row.description}`} variant="outlined" />
            ))}
          </Stack>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Conditions</Typography>
            <Typography variant="caption" color="text.secondary">
              Optional filters checked against the trigger payload.
            </Typography>
          </Box>

          <Alert severity="info" sx={{ py: 0.5 }}>
            {CONDITION_TUTORIAL_LINES.map((line) => (
              <Box key={line}>{line}</Box>
            ))}
          </Alert>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="condition-match-mode">Match mode</InputLabel>
              <Select
                labelId="condition-match-mode"
                label="Match mode"
                value={matchMode}
                onChange={(e) => setMatchMode(String(e.target.value) === "any" ? "any" : "all")}
              >
                <MenuItem value="all">all (every condition must pass)</MenuItem>
                <MenuItem value="any">any (at least one condition passes)</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" label="Keyword contains (CSV)" value={keywordContains} onChange={(e) => setKeywordContains(e.target.value)} fullWidth />
            <TextField size="small" label="Keyword excludes (CSV)" value={keywordExcludes} onChange={(e) => setKeywordExcludes(e.target.value)} fullWidth />
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField size="small" label="Answer contains (CSV)" value={answerContains} onChange={(e) => setAnswerContains(e.target.value)} fullWidth />
            <TextField size="small" label="Question regex" value={questionRegex} onChange={(e) => setQuestionRegex(e.target.value)} fullWidth />
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField size="small" label="Branch in (CSV)" value={branchIn} onChange={(e) => setBranchIn(e.target.value)} fullWidth />
            <TextField size="small" label="User in (CSV)" value={userIn} onChange={(e) => setUserIn(e.target.value)} fullWidth />
            <TextField size="small" label="LLM provider in (CSV)" value={llmProviderIn} onChange={(e) => setLlmProviderIn(e.target.value)} fullWidth />
            <TextField size="small" label="LLM model in (CSV)" value={llmModelIn} onChange={(e) => setLlmModelIn(e.target.value)} fullWidth />
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField size="small" label="tool_errors_min" type="number" value={toolErrorsMin} onChange={(e) => setToolErrorsMin(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
            <TextField size="small" label="tool_errors_max" type="number" value={toolErrorsMax} onChange={(e) => setToolErrorsMax(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
            <TextField size="small" label="tool_calls_min" type="number" value={toolCallsMin} onChange={(e) => setToolCallsMin(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
            <TextField size="small" label="tool_calls_max" type="number" value={toolCallsMax} onChange={(e) => setToolCallsMax(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField size="small" label="sources_count_min" type="number" value={sourcesCountMin} onChange={(e) => setSourcesCountMin(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
            <TextField size="small" label="failed_connectors_min" type="number" value={failedConnectorsMin} onChange={(e) => setFailedConnectorsMin(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
            <TextField size="small" label="failed_connectors_max" type="number" value={failedConnectorsMax} onChange={(e) => setFailedConnectorsMax(e.target.value === "" ? "" : Number(e.target.value))} fullWidth />
            <FormControl fullWidth size="small">
              <InputLabel id="condition-grounded-is">grounded_is</InputLabel>
              <Select
                labelId="condition-grounded-is"
                label="grounded_is"
                value={groundedIs}
                onChange={(e) => setGroundedIs(String(e.target.value) as "" | "true" | "false")}
              >
                <MenuItem value="">(ignore)</MenuItem>
                <MenuItem value="true">true</MenuItem>
                <MenuItem value="false">false</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="condition-pending-user">pending_user_input_is</InputLabel>
              <Select
                labelId="condition-pending-user"
                label="pending_user_input_is"
                value={pendingUserInputIs}
                onChange={(e) => setPendingUserInputIs(String(e.target.value) as "" | "true" | "false")}
              >
                <MenuItem value="">(ignore)</MenuItem>
                <MenuItem value="true">true</MenuItem>
                <MenuItem value="false">false</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Action</Typography>
            <Typography variant="caption" color="text.secondary">Select the action type, then fill guided parameters.</Typography>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="automation-action-type">Action Type</InputLabel>
              <Select
                labelId="automation-action-type"
                label="Action Type"
                value={actionType}
                onChange={(e) => {
                  const next = String(e.target.value)
                  const def = getActionDefinition(next)
                  setActionType(next)
                  setActionInputs(buildActionInputs(def, defaultActionParams(next)))
                  setActionAdvancedEnabled(false)
                  setActionAdvancedText(prettyJson(defaultActionParams(next)))
                }}
              >
                {ACTION_DEFINITIONS.map((item) => (
                  <MenuItem key={item.type} value={item.type}>
                    {item.type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={<Switch size="small" checked={actionAdvancedEnabled} onChange={(e) => setActionAdvancedEnabled(e.target.checked)} />}
              label="Advanced JSON"
            />
          </Stack>

          <Alert severity="info" sx={{ py: 0.5 }}>
            <Box sx={{ mb: 0.5, fontWeight: 700 }}>Action parameter tutorial</Box>
            {PARAMETER_TUTORIAL_LINES.map((line) => (
              <Box key={line}>{line}</Box>
            ))}
          </Alert>

          {!actionAdvancedEnabled ? (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                {selectedActionDef.label}: {selectedActionDef.description}
              </Typography>
              <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                {selectedActionDef.fields.map((f) => (
                  <Chip key={f.key} size="small" label={f.label} variant="outlined" />
                ))}
              </Stack>
              {selectedActionDef.fields.map((field) =>
                renderActionField(field, actionInputs[field.key], (next) => setActionInput(field.key, next), saving)
              )}
            </Stack>
          ) : (
            <TextField
              label="Action Params (JSON override)"
              value={actionAdvancedText}
              onChange={(e) => setActionAdvancedText(e.target.value)}
              fullWidth
              multiline
              minRows={10}
              sx={{
                "& .MuiInputBase-input": {
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12,
                },
              }}
            />
          )}
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
