"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material"
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded"
import AppDialogTitle from "@/components/AppDialogTitle"
import {
  ACTION_PRESETS,
  ACTION_DEFINITIONS,
  CONDITION_PRESETS,
  CONDITION_TUTORIAL_LINES,
  EVENT_OPTIONS,
  PARAMETER_TUTORIAL_LINES,
  TRIGGER_PRESETS,
  TRIGGER_OPTIONS,
  defaultActionParams,
  getActionDefinition,
  type ActionDefinition,
  type ActionField,
  type TriggerType,
} from "@/features/automations/catalog"
import {
  prettyJson,
  type AutomationDoc,
  type AutomationPreset,
  type AutomationPresetVersion,
  type AutomationTemplate,
} from "@/features/automations/types"

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
  customPresets?: AutomationPreset[]
  saving?: boolean
  error?: string | null
  onClose: () => void
  onSave: (payload: SavePayload) => Promise<void> | void
  onSaveCustomPreset?: (payload: Omit<SavePayload, "enabled">) => Promise<void> | void
  onDeleteCustomPreset?: (presetId: string) => Promise<void> | void
  onUpdateCustomPreset?: (presetId: string, payload: Omit<SavePayload, "enabled">) => Promise<void> | void
  onLoadCustomPresetVersions?: (presetId: string) => Promise<AutomationPresetVersion[]>
  onRollbackCustomPresetVersion?: (presetId: string, versionId: string) => Promise<void> | void
}

type PresetSnapshot = NonNullable<AutomationPresetVersion["snapshot"]>

type SnapshotDiffRow = {
  path: string
  kind: "changed" | "added" | "removed"
  currentValue: unknown
  targetValue: unknown
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

function toDiffSnapshotFromPreset(preset: AutomationPreset): PresetSnapshot {
  return {
    name: String(preset.name || ""),
    description: String(preset.description || ""),
    trigger: (preset.trigger && typeof preset.trigger === "object" ? preset.trigger : {}) as PresetSnapshot["trigger"],
    conditions: (preset.conditions && typeof preset.conditions === "object" ? preset.conditions : {}) as PresetSnapshot["conditions"],
    action: (preset.action && typeof preset.action === "object" ? preset.action : {}) as PresetSnapshot["action"],
    cooldown_sec: Number(preset.cooldown_sec || 0),
    run_access: String(preset.run_access || "member_runnable"),
    tags: Array.isArray(preset.tags) ? preset.tags.map((x) => String(x)) : [],
  }
}

function toDiffSnapshotFromVersion(version: AutomationPresetVersion): PresetSnapshot {
  const snap = version.snapshot && typeof version.snapshot === "object" ? version.snapshot : {}
  return {
    name: String(snap.name || ""),
    description: String(snap.description || ""),
    trigger: (snap.trigger && typeof snap.trigger === "object" ? snap.trigger : {}) as PresetSnapshot["trigger"],
    conditions: (snap.conditions && typeof snap.conditions === "object" ? snap.conditions : {}) as PresetSnapshot["conditions"],
    action: (snap.action && typeof snap.action === "object" ? snap.action : {}) as PresetSnapshot["action"],
    cooldown_sec: Number(snap.cooldown_sec || 0),
    run_access: String(snap.run_access || "member_runnable"),
    tags: Array.isArray(snap.tags) ? snap.tags.map((x) => String(x)) : [],
  }
}

function normalizeJsonForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeJsonForCompare(item))
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const out: Record<string, unknown> = {}
    for (const [key, v] of entries) out[key] = normalizeJsonForCompare(v)
    return out
  }
  return value
}

function valueEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJsonForCompare(left)) === JSON.stringify(normalizeJsonForCompare(right))
}

function flattenSnapshot(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    if (entries.length === 0) {
      out[prefix] = {}
      return
    }
    for (const [key, nested] of entries) {
      flattenSnapshot(nested, prefix ? `${prefix}.${key}` : key, out)
    }
    return
  }
  out[prefix] = value
}

function buildSnapshotDiffRows(current: PresetSnapshot, target: PresetSnapshot): SnapshotDiffRow[] {
  const left: Record<string, unknown> = {}
  const right: Record<string, unknown> = {}
  flattenSnapshot(current, "", left)
  flattenSnapshot(target, "", right)

  const paths = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort((a, b) => a.localeCompare(b))
  const rows: SnapshotDiffRow[] = []
  for (const path of paths) {
    const hasLeft = Object.prototype.hasOwnProperty.call(left, path)
    const hasRight = Object.prototype.hasOwnProperty.call(right, path)
    const currentValue = hasLeft ? left[path] : undefined
    const targetValue = hasRight ? right[path] : undefined
    if (hasLeft && hasRight && valueEquals(currentValue, targetValue)) continue
    rows.push({
      path,
      kind: !hasLeft ? "added" : !hasRight ? "removed" : "changed",
      currentValue,
      targetValue,
    })
  }
  return rows
}

function diffValueText(value: unknown): string {
  if (value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value)
  return prettyJson(value)
}

function getDiffTopLevel(path: string): string {
  if (!path) return "(root)"
  const [first] = path.split(".")
  return first || "(root)"
}

export default function AutomationEditorDialog(props: Props) {
  const {
    open,
    mode,
    initial,
    template,
    customPresets = [],
    saving = false,
    error,
    onClose,
    onSave,
    onSaveCustomPreset,
    onDeleteCustomPreset,
    onUpdateCustomPreset,
    onLoadCustomPresetVersions,
    onRollbackCustomPresetVersion,
  } = props

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
  const [triggerPresetKey, setTriggerPresetKey] = useState("")

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
  const [conditionPresetKey, setConditionPresetKey] = useState("")

  const [actionType, setActionType] = useState("create_chat_task")
  const [actionInputs, setActionInputs] = useState<Record<string, unknown>>({})
  const [actionAdvancedEnabled, setActionAdvancedEnabled] = useState(false)
  const [actionAdvancedText, setActionAdvancedText] = useState("{}")
  const [actionPresetKey, setActionPresetKey] = useState("")
  const [customPresetKey, setCustomPresetKey] = useState("")
  const [customPresetName, setCustomPresetName] = useState("")
  const [customPresetDescription, setCustomPresetDescription] = useState("")
  const [customPresetVersions, setCustomPresetVersions] = useState<AutomationPresetVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [rollbackPreviewOpen, setRollbackPreviewOpen] = useState(false)
  const [rollbackPreviewVersion, setRollbackPreviewVersion] = useState<AutomationPresetVersion | null>(null)
  const [rollbackDiffRows, setRollbackDiffRows] = useState<SnapshotDiffRow[]>([])
  const [rollbackDiffKindFilter, setRollbackDiffKindFilter] = useState<"all" | SnapshotDiffRow["kind"]>("all")
  const [rollbackExpandedGroups, setRollbackExpandedGroups] = useState<Record<string, boolean>>({})

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
    setTriggerPresetKey("")

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
    setConditionPresetKey("")

    setActionType(actionTypeSeed)
    setActionInputs(buildActionInputs(actionDef, actionParamsSeed))
    setActionAdvancedText(prettyJson(actionParamsSeed && Object.keys(actionParamsSeed).length ? actionParamsSeed : defaultActionParams(actionTypeSeed)))
    setActionAdvancedEnabled(hasUnknownActionParams(actionDef, actionParamsSeed))
    setActionPresetKey("")
    setCustomPresetKey("")
    setCustomPresetName((seed?.name || "New automation").trim() ? `${seed?.name || "New automation"} preset` : "New preset")
    setCustomPresetDescription(seed?.description || "")
    setCustomPresetVersions([])

    setCooldownSec(Number(seed?.cooldown_sec || 0))
    setRunAccess(String(seed?.run_access || "member_runnable") === "admin_only" ? "admin_only" : "member_runnable")
    setTagsText(Array.isArray(seed?.tags) ? seed?.tags.join(", ") : "")
    setValidationError(null)
  }, [open, seed])

  const title = mode === "edit" ? "Edit Automation" : "Create Automation"
  const selectedActionDef = useMemo(() => getActionDefinition(actionType), [actionType])

  const resetTriggerToDefault = () => {
    setTriggerType("event")
    setEventType("ask_agent_completed")
    setIntervalMinutes(60)
    setDailyHour(9)
    setDailyMinute(0)
    setWeeklyDaysText("mon, tue, wed, thu, fri")
    setOnceRunAt("")
  }

  const applyTriggerPreset = (presetKey: string) => {
    const preset = TRIGGER_PRESETS.find((item) => item.key === presetKey)
    if (!preset) return
    const trigger = preset.trigger || {}
    resetTriggerToDefault()
    const nextType = String(trigger.type || "manual") as TriggerType
    setTriggerType(nextType)
    setEventType(String(trigger.event_type || "ask_agent_completed"))
    setIntervalMinutes(Number(trigger.interval_minutes || 60))
    setDailyHour(Number(trigger.hour || 9))
    setDailyMinute(Number(trigger.minute || 0))
    setWeeklyDaysText(Array.isArray(trigger.weekdays) ? trigger.weekdays.map((x) => String(x)).join(", ") : "mon, tue, wed, thu, fri")
    setOnceRunAt(String(trigger.run_at || ""))
  }

  const resetConditionsToDefault = () => {
    setMatchMode("all")
    setKeywordContains("")
    setKeywordExcludes("")
    setAnswerContains("")
    setQuestionRegex("")
    setBranchIn("")
    setUserIn("")
    setToolErrorsMin("")
    setToolErrorsMax("")
    setToolCallsMin("")
    setToolCallsMax("")
    setSourcesCountMin("")
    setFailedConnectorsMin("")
    setFailedConnectorsMax("")
    setGroundedIs("")
    setPendingUserInputIs("")
    setLlmProviderIn("")
    setLlmModelIn("")
  }

  const applyConditionPreset = (presetKey: string) => {
    const preset = CONDITION_PRESETS.find((item) => item.key === presetKey)
    if (!preset) return

    resetConditionsToDefault()
    const v = preset.values || {}

    setMatchMode(String(v.match_mode || "all") === "any" ? "any" : "all")
    setKeywordContains(Array.isArray(v.keyword_contains) ? v.keyword_contains.map((x) => String(x)).join(", ") : "")
    setKeywordExcludes(Array.isArray(v.keyword_excludes) ? v.keyword_excludes.map((x) => String(x)).join(", ") : "")
    setAnswerContains(Array.isArray(v.answer_contains) ? v.answer_contains.map((x) => String(x)).join(", ") : "")
    setQuestionRegex(String(v.question_regex || ""))
    setBranchIn(Array.isArray(v.branch_in) ? v.branch_in.map((x) => String(x)).join(", ") : "")
    setUserIn(Array.isArray(v.user_in) ? v.user_in.map((x) => String(x)).join(", ") : "")
    setToolErrorsMin(v.tool_errors_min == null ? "" : Number(v.tool_errors_min))
    setToolErrorsMax(v.tool_errors_max == null ? "" : Number(v.tool_errors_max))
    setToolCallsMin(v.tool_calls_min == null ? "" : Number(v.tool_calls_min))
    setToolCallsMax(v.tool_calls_max == null ? "" : Number(v.tool_calls_max))
    setSourcesCountMin(v.sources_count_min == null ? "" : Number(v.sources_count_min))
    setFailedConnectorsMin(v.failed_connectors_min == null ? "" : Number(v.failed_connectors_min))
    setFailedConnectorsMax(v.failed_connectors_max == null ? "" : Number(v.failed_connectors_max))
    setGroundedIs(v.grounded_is === true ? "true" : v.grounded_is === false ? "false" : "")
    setPendingUserInputIs(v.pending_user_input_is === true ? "true" : v.pending_user_input_is === false ? "false" : "")
    setLlmProviderIn(Array.isArray(v.llm_provider_in) ? v.llm_provider_in.map((x) => String(x)).join(", ") : "")
    setLlmModelIn(Array.isArray(v.llm_model_in) ? v.llm_model_in.map((x) => String(x)).join(", ") : "")
  }

  const setActionInput = (key: string, next: unknown) => {
    setActionInputs((prev) => ({ ...prev, [key]: next }))
  }

  const applyActionPreset = (presetKey: string) => {
    const preset = ACTION_PRESETS.find((item) => item.key === presetKey)
    if (!preset) return
    const nextType = String(preset.actionType || "create_chat_task")
    const def = getActionDefinition(nextType)
    setActionType(nextType)
    setActionInputs(buildActionInputs(def, preset.params || defaultActionParams(nextType)))
    setActionAdvancedEnabled(false)
    setActionAdvancedText(prettyJson(preset.params || defaultActionParams(nextType)))
  }

  const applyCustomPreset = (presetId: string) => {
    const preset = customPresets.find((item) => item.id === presetId)
    if (!preset) return

    const trigger = preset.trigger || { type: "manual" }
    const conditions = (preset.conditions || {}) as Record<string, unknown>
    const action = (preset.action || { type: "create_chat_task", params: {} }) as Record<string, unknown>
    const actionTypeSeed = String(action.type || "create_chat_task")
    const actionDef = getActionDefinition(actionTypeSeed)
    const actionParamsSeed = (action.params as Record<string, unknown>) || {}

    const triggerTypeSeed = String(trigger.type || "manual") as TriggerType
    setTriggerType(triggerTypeSeed)
    setEventType(String(trigger.event_type || "ask_agent_completed"))
    setIntervalMinutes(Number(trigger.interval_minutes || 60))
    setDailyHour(Number(trigger.hour || 9))
    setDailyMinute(Number(trigger.minute || 0))
    setWeeklyDaysText(Array.isArray(trigger.weekdays) ? trigger.weekdays.map((x) => String(x)).join(", ") : "mon, tue, wed, thu, fri")
    setOnceRunAt(String(trigger.run_at || ""))
    setTriggerPresetKey("")

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
    setGroundedIs(conditions.grounded_is === true ? "true" : conditions.grounded_is === false ? "false" : "")
    setPendingUserInputIs(conditions.pending_user_input_is === true ? "true" : conditions.pending_user_input_is === false ? "false" : "")
    setLlmProviderIn(Array.isArray(conditions.llm_provider_in) ? conditions.llm_provider_in.map((x) => String(x)).join(", ") : "")
    setLlmModelIn(Array.isArray(conditions.llm_model_in) ? conditions.llm_model_in.map((x) => String(x)).join(", ") : "")
    setConditionPresetKey("")

    setActionType(actionTypeSeed)
    setActionInputs(buildActionInputs(actionDef, actionParamsSeed))
    setActionAdvancedText(prettyJson(actionParamsSeed && Object.keys(actionParamsSeed).length ? actionParamsSeed : defaultActionParams(actionTypeSeed)))
    setActionAdvancedEnabled(hasUnknownActionParams(actionDef, actionParamsSeed))
    setActionPresetKey("")

    setCooldownSec(Number(preset.cooldown_sec || 0))
    setRunAccess(String(preset.run_access || "member_runnable") === "admin_only" ? "admin_only" : "member_runnable")
    setTagsText(Array.isArray(preset.tags) ? preset.tags.join(", ") : "")
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

  const buildDraftPayload = (draftName: string, draftDescription: string, draftEnabled: boolean): SavePayload => {
    let actionParams: Record<string, unknown>
    try {
      actionParams = parseActionFromInputs()
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
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
        throw new Error("One-time trigger requires a UTC run_at datetime.")
      }
      trigger = { type: "once", run_at: runAt }
    } else if (triggerType === "event") {
      const cleanEvent = eventType.trim().toLowerCase()
      if (!cleanEvent) {
        throw new Error("Event trigger requires an event name.")
      }
      trigger = { type: "event", event_type: cleanEvent }
    } else {
      trigger = { type: "manual" }
    }

    return {
      name: draftName,
      description: draftDescription,
      enabled: draftEnabled,
      trigger,
      conditions,
      action: { type: actionType, params: actionParams },
      cooldown_sec: Math.max(0, Math.min(Number(cooldownSec || 0), 24 * 3600)),
      run_access: runAccess,
      tags,
    }
  }

  const handleSave = async () => {
    setValidationError(null)
    const cleanName = name.trim()
    if (!cleanName) {
      setValidationError("Name is required.")
      return
    }
    try {
      const payload = buildDraftPayload(cleanName, description.trim(), enabled)
      await onSave(payload)
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSaveCustomPreset = async () => {
    if (!onSaveCustomPreset) return
    setValidationError(null)
    const presetName = customPresetName.trim()
    if (!presetName) {
      setValidationError("Preset name is required.")
      return
    }
    try {
      const payload = buildDraftPayload(presetName, customPresetDescription.trim(), true)
      await onSaveCustomPreset({
        name: payload.name,
        description: payload.description,
        trigger: payload.trigger,
        conditions: payload.conditions,
        action: payload.action,
        cooldown_sec: payload.cooldown_sec,
        run_access: payload.run_access,
        tags: payload.tags,
      })
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUpdateCustomPreset = async () => {
    if (!onUpdateCustomPreset || !customPresetKey) return
    setValidationError(null)
    const presetName = customPresetName.trim()
    if (!presetName) {
      setValidationError("Preset name is required.")
      return
    }
    try {
      const payload = buildDraftPayload(presetName, customPresetDescription.trim(), true)
      await onUpdateCustomPreset(customPresetKey, {
        name: payload.name,
        description: payload.description,
        trigger: payload.trigger,
        conditions: payload.conditions,
        action: payload.action,
        cooldown_sec: payload.cooldown_sec,
        run_access: payload.run_access,
        tags: payload.tags,
      })
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (!customPresetKey) return
    const selected = customPresets.find((item) => item.id === customPresetKey)
    if (!selected) return
    setCustomPresetName(selected.name || "")
    setCustomPresetDescription(selected.description || "")
  }, [customPresetKey, customPresets])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!customPresetKey || !onLoadCustomPresetVersions) {
        setCustomPresetVersions([])
        return
      }
      setLoadingVersions(true)
      try {
        const items = await onLoadCustomPresetVersions(customPresetKey)
        if (!cancelled) setCustomPresetVersions(items || [])
      } catch (err) {
        if (!cancelled) setValidationError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoadingVersions(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [customPresetKey, onLoadCustomPresetVersions])

  const openRollbackPreview = (version: AutomationPresetVersion) => {
    if (!customPresetKey) return
    const currentPreset = customPresets.find((item) => item.id === customPresetKey)
    if (!currentPreset) {
      setValidationError("Selected custom preset was not found.")
      return
    }
    const currentSnapshot = toDiffSnapshotFromPreset(currentPreset)
    const targetSnapshot = toDiffSnapshotFromVersion(version)
    const rows = buildSnapshotDiffRows(currentSnapshot, targetSnapshot)
    const groups: Record<string, boolean> = {}
    for (const row of rows) groups[getDiffTopLevel(row.path)] = true
    setRollbackDiffRows(rows)
    setRollbackDiffKindFilter("all")
    setRollbackExpandedGroups(groups)
    setRollbackPreviewVersion(version)
    setRollbackPreviewOpen(true)
  }

  const executeRollbackFromPreview = async () => {
    if (!onRollbackCustomPresetVersion || !customPresetKey || !rollbackPreviewVersion) return
    try {
      setValidationError(null)
      await onRollbackCustomPresetVersion(customPresetKey, rollbackPreviewVersion.id)
      setRollbackPreviewOpen(false)
      setRollbackPreviewVersion(null)
      setRollbackDiffRows([])
      setRollbackDiffKindFilter("all")
      setRollbackExpandedGroups({})
      if (onLoadCustomPresetVersions) {
        setLoadingVersions(true)
        try {
          const items = await onLoadCustomPresetVersions(customPresetKey)
          setCustomPresetVersions(items || [])
        } catch (err) {
          setValidationError(err instanceof Error ? err.message : String(err))
        } finally {
          setLoadingVersions(false)
        }
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
    }
  }

  const rollbackFilteredRows = useMemo(
    () => (rollbackDiffKindFilter === "all" ? rollbackDiffRows : rollbackDiffRows.filter((row) => row.kind === rollbackDiffKindFilter)),
    [rollbackDiffKindFilter, rollbackDiffRows]
  )

  const rollbackGroupEntries = useMemo(() => {
    const groups: Record<string, SnapshotDiffRow[]> = {}
    for (const row of rollbackFilteredRows) {
      const key = getDiffTopLevel(row.path)
      if (!groups[key]) groups[key] = []
      groups[key].push(row)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [rollbackFilteredRows])

  const rollbackKindCounts = useMemo(
    () => ({
      all: rollbackDiffRows.length,
      changed: rollbackDiffRows.filter((row) => row.kind === "changed").length,
      added: rollbackDiffRows.filter((row) => row.kind === "added").length,
      removed: rollbackDiffRows.filter((row) => row.kind === "removed").length,
    }),
    [rollbackDiffRows]
  )

  return (
    <>
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
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Custom Preset Library</Typography>
            <Typography variant="caption" color="text.secondary">
              Save the current setup as a reusable project preset, then apply it later in one click.
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="custom-preset-select">Custom preset</InputLabel>
              <Select
                labelId="custom-preset-select"
                label="Custom preset"
                value={customPresetKey}
                onChange={(e) => setCustomPresetKey(String(e.target.value))}
              >
                <MenuItem value="">(choose custom preset)</MenuItem>
                {customPresets.map((preset) => (
                  <MenuItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              onClick={() => applyCustomPreset(customPresetKey)}
              disabled={!customPresetKey}
            >
              Apply custom preset
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => void handleUpdateCustomPreset()}
              disabled={!customPresetKey || saving || !onUpdateCustomPreset}
            >
              Update selected preset
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={async () => {
                if (!customPresetKey || !onLoadCustomPresetVersions) return
                setLoadingVersions(true)
                try {
                  const items = await onLoadCustomPresetVersions(customPresetKey)
                  setCustomPresetVersions(items || [])
                } catch (err) {
                  setValidationError(err instanceof Error ? err.message : String(err))
                } finally {
                  setLoadingVersions(false)
                }
              }}
              disabled={!customPresetKey || loadingVersions || !onLoadCustomPresetVersions}
            >
              {loadingVersions ? "Loading history..." : "Reload history"}
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              disabled={!customPresetKey || !onDeleteCustomPreset}
              onClick={async () => {
                if (!customPresetKey || !onDeleteCustomPreset) return
                const selected = customPresets.find((item) => item.id === customPresetKey)
                if (!window.confirm(`Delete custom preset \"${selected?.name || customPresetKey}\"?`)) return
                await onDeleteCustomPreset(customPresetKey)
                setCustomPresetKey("")
              }}
            >
              Delete custom preset
            </Button>
          </Stack>

          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
            {customPresets.map((preset) => (
              <Chip
                key={preset.id}
                size="small"
                label={preset.name}
                variant={customPresetKey === preset.id ? "filled" : "outlined"}
                onClick={() => {
                  setCustomPresetKey(preset.id)
                  applyCustomPreset(preset.id)
                }}
              />
            ))}
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField
              label="New preset name"
              size="small"
              value={customPresetName}
              onChange={(e) => setCustomPresetName(e.target.value)}
              fullWidth
            />
            <TextField
              label="New preset description"
              size="small"
              value={customPresetDescription}
              onChange={(e) => setCustomPresetDescription(e.target.value)}
              fullWidth
            />
            <Button
              variant="contained"
              size="small"
              onClick={() => void handleSaveCustomPreset()}
              disabled={saving || !onSaveCustomPreset}
            >
              Save current as preset
            </Button>
          </Stack>

            {customPresetKey ? (
              <Paper variant="outlined" sx={{ p: 1, borderRadius: 1.2 }}>
                <Stack spacing={0.8}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    Preset History
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Each update stores a full snapshot. Rollback opens a diff preview before applying.
                  </Typography>
                  <Divider />
                  <Stack spacing={0.5} sx={{ maxHeight: 170, overflowY: "auto" }}>
                    {!customPresetVersions.length ? (
                      <Typography variant="caption" color="text.secondary">
                        {loadingVersions ? "Loading history..." : "No version history found."}
                      </Typography>
                    ) : (
                      customPresetVersions.map((version) => (
                        <Paper key={version.id} variant="outlined" sx={{ p: 0.7, borderRadius: 1 }}>
                          <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                {version.change_type || "update"} · {version.created_at || "-"}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                by {version.created_by || "unknown"}{version.note ? ` · ${version.note}` : ""}
                              </Typography>
                            </Box>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={saving || !onRollbackCustomPresetVersion}
                              onClick={() => openRollbackPreview(version)}
                            >
                              Rollback
                            </Button>
                          </Stack>
                        </Paper>
                      ))
                    )}
                  </Stack>
                </Stack>
              </Paper>
            ) : null}

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Trigger</Typography>
            <Typography variant="caption" color="text.secondary">Choose when this automation should run.</Typography>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="trigger-preset-select">Trigger preset</InputLabel>
              <Select
                labelId="trigger-preset-select"
                label="Trigger preset"
                value={triggerPresetKey}
                onChange={(e) => setTriggerPresetKey(String(e.target.value))}
              >
                <MenuItem value="">(choose a preset)</MenuItem>
                {TRIGGER_PRESETS.map((preset) => (
                  <MenuItem key={preset.key} value={preset.key}>
                    {preset.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              onClick={() => applyTriggerPreset(triggerPresetKey)}
              disabled={!triggerPresetKey}
            >
              Apply trigger preset
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setTriggerPresetKey("")
                resetTriggerToDefault()
              }}
            >
              Reset trigger
            </Button>
          </Stack>

          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
            {TRIGGER_PRESETS.map((preset) => (
              <Chip
                key={preset.key}
                size="small"
                label={preset.label}
                variant={triggerPresetKey === preset.key ? "filled" : "outlined"}
                onClick={() => {
                  setTriggerPresetKey(preset.key)
                  applyTriggerPreset(preset.key)
                }}
              />
            ))}
          </Stack>

          {triggerPresetKey ? (
            <Alert severity="success" sx={{ py: 0.5 }}>
              {TRIGGER_PRESETS.find((item) => item.key === triggerPresetKey)?.description || ""}
            </Alert>
          ) : null}

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="automation-trigger-type">Trigger Type</InputLabel>
              <Select
                labelId="automation-trigger-type"
                label="Trigger Type"
                value={triggerType}
                onChange={(e) => {
                  setTriggerPresetKey("")
                  setTriggerType(String(e.target.value) as TriggerType)
                }}
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

          <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
            <FormControl fullWidth size="small">
              <InputLabel id="condition-preset-select">Condition preset</InputLabel>
              <Select
                labelId="condition-preset-select"
                label="Condition preset"
                value={conditionPresetKey}
                onChange={(e) => setConditionPresetKey(String(e.target.value))}
              >
                <MenuItem value="">(choose a preset)</MenuItem>
                {CONDITION_PRESETS.map((preset) => (
                  <MenuItem key={preset.key} value={preset.key}>
                    {preset.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              onClick={() => applyConditionPreset(conditionPresetKey)}
              disabled={!conditionPresetKey}
            >
              Apply preset
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setConditionPresetKey("")
                resetConditionsToDefault()
              }}
            >
              Reset conditions
            </Button>
          </Stack>

          {conditionPresetKey ? (
            <Alert severity="success" sx={{ py: 0.5 }}>
              {CONDITION_PRESETS.find((item) => item.key === conditionPresetKey)?.description || ""}
            </Alert>
          ) : null}

          <Alert severity="info" sx={{ py: 0.5 }}>
            {CONDITION_TUTORIAL_LINES.map((line) => (
              <Box key={line}>{line}</Box>
            ))}
          </Alert>

          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
            {CONDITION_PRESETS.map((preset) => (
              <Chip
                key={preset.key}
                size="small"
                label={preset.label}
                variant={conditionPresetKey === preset.key ? "filled" : "outlined"}
                onClick={() => {
                  setConditionPresetKey(preset.key)
                  applyConditionPreset(preset.key)
                }}
              />
            ))}
          </Stack>

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
              <InputLabel id="action-preset-select">Action preset</InputLabel>
              <Select
                labelId="action-preset-select"
                label="Action preset"
                value={actionPresetKey}
                onChange={(e) => setActionPresetKey(String(e.target.value))}
              >
                <MenuItem value="">(choose a preset)</MenuItem>
                {ACTION_PRESETS.map((preset) => (
                  <MenuItem key={preset.key} value={preset.key}>
                    {preset.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              onClick={() => applyActionPreset(actionPresetKey)}
              disabled={!actionPresetKey}
            >
              Apply action preset
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setActionPresetKey("")
                const def = getActionDefinition("create_chat_task")
                setActionType("create_chat_task")
                setActionInputs(buildActionInputs(def, defaultActionParams("create_chat_task")))
                setActionAdvancedEnabled(false)
                setActionAdvancedText(prettyJson(defaultActionParams("create_chat_task")))
              }}
            >
              Reset action
            </Button>
          </Stack>

          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
            {ACTION_PRESETS.map((preset) => (
              <Chip
                key={preset.key}
                size="small"
                label={preset.label}
                variant={actionPresetKey === preset.key ? "filled" : "outlined"}
                onClick={() => {
                  setActionPresetKey(preset.key)
                  applyActionPreset(preset.key)
                }}
              />
            ))}
          </Stack>

          {actionPresetKey ? (
            <Alert severity="success" sx={{ py: 0.5 }}>
              {ACTION_PRESETS.find((item) => item.key === actionPresetKey)?.description || ""}
            </Alert>
          ) : null}

          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl fullWidth size="small">
              <InputLabel id="automation-action-type">Action Type</InputLabel>
              <Select
                labelId="automation-action-type"
                label="Action Type"
                value={actionType}
                onChange={(e) => {
                  setActionPresetKey("")
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

      <Dialog
        open={rollbackPreviewOpen}
        onClose={() => {
          if (saving) return
          setRollbackPreviewOpen(false)
        }}
        fullWidth
        maxWidth="md"
      >
        <AppDialogTitle
          title="Rollback Preview"
          subtitle={rollbackPreviewVersion ? `Version ${rollbackPreviewVersion.created_at || rollbackPreviewVersion.id}` : "Compare changes before rollback."}
          onClose={() => {
            if (saving) return
            setRollbackPreviewOpen(false)
          }}
        />
        <DialogContent dividers sx={{ pt: 1.1 }}>
          <Stack spacing={0.9}>
            {rollbackDiffRows.length === 0 ? (
              <Alert severity="info" sx={{ py: 0.5 }}>
                No effective differences detected. Rollback can still be applied.
              </Alert>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary">
                  {rollbackDiffRows.length} changed field{rollbackDiffRows.length === 1 ? "" : "s"} will be applied.
                </Typography>
                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`all (${rollbackKindCounts.all})`}
                    variant={rollbackDiffKindFilter === "all" ? "filled" : "outlined"}
                    onClick={() => setRollbackDiffKindFilter("all")}
                  />
                  <Chip
                    size="small"
                    label={`changed (${rollbackKindCounts.changed})`}
                    color="warning"
                    variant={rollbackDiffKindFilter === "changed" ? "filled" : "outlined"}
                    onClick={() => setRollbackDiffKindFilter("changed")}
                  />
                  <Chip
                    size="small"
                    label={`added (${rollbackKindCounts.added})`}
                    color="success"
                    variant={rollbackDiffKindFilter === "added" ? "filled" : "outlined"}
                    onClick={() => setRollbackDiffKindFilter("added")}
                  />
                  <Chip
                    size="small"
                    label={`removed (${rollbackKindCounts.removed})`}
                    variant={rollbackDiffKindFilter === "removed" ? "filled" : "outlined"}
                    onClick={() => setRollbackDiffKindFilter("removed")}
                  />
                </Stack>
              </>
            )}
            <Stack spacing={0.6} sx={{ maxHeight: 360, overflowY: "auto" }}>
              {!rollbackGroupEntries.length && rollbackDiffRows.length > 0 ? (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  No fields match this filter.
                </Alert>
              ) : (
                rollbackGroupEntries.map(([group, rows]) => (
                  <Accordion
                    key={group}
                    disableGutters
                    elevation={0}
                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, "&::before": { display: "none" } }}
                    expanded={rollbackExpandedGroups[group] ?? true}
                    onChange={(_, expanded) => {
                      setRollbackExpandedGroups((prev) => ({ ...prev, [group]: expanded }))
                    }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreRounded fontSize="small" />}>
                      <Stack direction="row" spacing={0.7} alignItems="center">
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          {group}
                        </Typography>
                        <Chip size="small" label={rows.length} variant="outlined" />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0.2, pb: 0.8 }}>
                      <Stack spacing={0.6}>
                        {rows.map((row) => (
                          <Paper key={row.path} variant="outlined" sx={{ p: 0.8, borderRadius: 1 }}>
                            <Stack spacing={0.55}>
                              <Stack direction="row" spacing={0.7} alignItems="center">
                                <Chip
                                  size="small"
                                  label={row.kind}
                                  color={row.kind === "changed" ? "warning" : row.kind === "added" ? "success" : "default"}
                                  variant="outlined"
                                />
                                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                  {row.path}
                                </Typography>
                              </Stack>
                              <Box
                                sx={{
                                  p: 0.6,
                                  borderRadius: 0.8,
                                  bgcolor: "background.default",
                                  border: "1px solid",
                                  borderColor: "divider",
                                }}
                              >
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
                                  Current
                                </Typography>
                                <Typography
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    whiteSpace: "pre-wrap",
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                    fontSize: 11.5,
                                  }}
                                >
                                  {diffValueText(row.currentValue)}
                                </Typography>
                              </Box>
                              <Box
                                sx={{
                                  p: 0.6,
                                  borderRadius: 0.8,
                                  bgcolor: "background.default",
                                  border: "1px solid",
                                  borderColor: "divider",
                                }}
                              >
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
                                  Target (selected version)
                                </Typography>
                                <Typography
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    whiteSpace: "pre-wrap",
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                    fontSize: 11.5,
                                  }}
                                >
                                  {diffValueText(row.targetValue)}
                                </Typography>
                              </Box>
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                ))
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackPreviewOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => void executeRollbackFromPreview()}
            disabled={saving || !rollbackPreviewVersion || !onRollbackCustomPresetVersion}
          >
            {saving ? "Applying..." : "Confirm Rollback"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
