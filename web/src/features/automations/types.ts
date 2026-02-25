export type AutomationTrigger = {
  type: "event" | "schedule" | "daily" | "weekly" | "once" | "manual" | string
  event_type?: string
  interval_minutes?: number
  hour?: number
  minute?: number
  weekdays?: string[]
  run_at?: string
}

export type AutomationAction = {
  type:
    | "create_chat_task"
    | "update_chat_task"
    | "append_chat_message"
    | "set_chat_title"
    | "request_user_input"
    | "run_incremental_ingestion"
    | "generate_documentation"
    | "dispatch_event"
    | "run_automation"
    | "set_automation_enabled"
    | "upsert_state_value"
    | string
  params?: Record<string, unknown>
}

export type AutomationDoc = {
  id: string
  project_id: string
  name: string
  description?: string
  enabled: boolean
  trigger: AutomationTrigger
  conditions?: Record<string, unknown>
  action: AutomationAction
  cooldown_sec?: number
  run_access?: "member_runnable" | "admin_only" | string
  tags?: string[]
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string
  last_error?: string
  run_count?: number
  updated_at?: string
  created_at?: string
}

export type AutomationRunDoc = {
  id: string
  automation_id: string
  project_id: string
  triggered_by: string
  event_type: string
  status: "succeeded" | "failed" | "dry_run" | string
  error?: string
  result?: Record<string, unknown>
  event_payload?: Record<string, unknown>
  started_at?: string
  finished_at?: string
  duration_ms?: number
}

export type AutomationTemplate = {
  key: string
  name: string
  description?: string
  trigger: AutomationTrigger
  conditions?: Record<string, unknown>
  action: AutomationAction
  cooldown_sec?: number
  run_access?: "member_runnable" | "admin_only" | string
  tags?: string[]
}

export type ListAutomationsResponse = {
  project_id: string
  total: number
  items: AutomationDoc[]
}

export type GetAutomationResponse = {
  project_id: string
  item: AutomationDoc
}

export type ListAutomationRunsResponse = {
  project_id: string
  total: number
  items: AutomationRunDoc[]
}

export type ListAutomationTemplatesResponse = {
  project_id: string
  items: AutomationTemplate[]
}

export function automationErrText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return "{}"
  }
}
