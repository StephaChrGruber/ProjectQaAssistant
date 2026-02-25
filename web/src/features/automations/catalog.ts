export type TriggerType = "event" | "schedule" | "daily" | "weekly" | "once" | "manual"

export type CatalogOption = {
  value: string
  label: string
  description: string
}

export type ActionFieldType = "text" | "multiline" | "number" | "boolean" | "select" | "csv" | "json"

export type ActionField = {
  key: string
  label: string
  type: ActionFieldType
  required?: boolean
  placeholder?: string
  help?: string
  options?: CatalogOption[]
}

export type ActionDefinition = {
  type: string
  label: string
  description: string
  fields: ActionField[]
  defaults: Record<string, unknown>
}

export type ConditionPreset = {
  key: string
  label: string
  description: string
  values: Record<string, unknown>
}

export type TriggerPreset = {
  key: string
  label: string
  description: string
  trigger: Record<string, unknown>
}

export type ActionPreset = {
  key: string
  label: string
  description: string
  actionType: string
  params: Record<string, unknown>
}

export const EVENT_OPTIONS: CatalogOption[] = [
  { value: "ask_agent_completed", label: "Agent answer completed", description: "Fires after an ask-agent response is written." },
  { value: "connector_health_checked", label: "Connector health checked", description: "Fires after connector health status is refreshed." },
  { value: "chat_task_created", label: "Chat task created", description: "Fires when a chat task is created by automation." },
  { value: "chat_task_updated", label: "Chat task updated", description: "Fires when a chat task is updated by automation." },
  { value: "chat_message_appended", label: "Chat message appended", description: "Fires when an automation appends a chat message." },
  { value: "user_input_requested", label: "User input requested", description: "Fires when automation asks the user a follow-up question." },
  { value: "ingestion_completed", label: "Ingestion completed", description: "Fires after incremental ingestion action completes." },
  { value: "documentation_generated", label: "Documentation generated", description: "Fires after documentation generation action completes." },
  { value: "automation_run_succeeded", label: "Automation run succeeded", description: "Fires after a non-dry-run automation completes successfully." },
  { value: "automation_run_failed", label: "Automation run failed", description: "Fires after a non-dry-run automation run fails." },
  { value: "ops.alert", label: "Custom: ops.alert", description: "Example custom event name for operational alerts." },
]

export const TRIGGER_OPTIONS: CatalogOption[] = [
  { value: "event", label: "Event", description: "Run when a specific event is dispatched." },
  { value: "schedule", label: "Interval", description: "Run every N minutes." },
  { value: "daily", label: "Daily", description: "Run once per day at a fixed UTC time." },
  { value: "weekly", label: "Weekly", description: "Run on selected weekdays at a fixed UTC time." },
  { value: "once", label: "One-time", description: "Run once at a specific UTC datetime and then disable." },
  { value: "manual", label: "Manual", description: "Run only when user/LLM explicitly executes it." },
]

export const TRIGGER_PRESETS: TriggerPreset[] = [
  {
    key: "manual-on-demand",
    label: "Manual on demand",
    description: "Run only when explicitly triggered by user/LLM.",
    trigger: { type: "manual" },
  },
  {
    key: "event-agent-completed",
    label: "On agent answer completed",
    description: "Run after each ask_agent completion event.",
    trigger: { type: "event", event_type: "ask_agent_completed" },
  },
  {
    key: "event-connector-health",
    label: "On connector health checked",
    description: "Run when connector health check event is dispatched.",
    trigger: { type: "event", event_type: "connector_health_checked" },
  },
  {
    key: "interval-15m",
    label: "Every 15 minutes",
    description: "Interval schedule with 15 minute frequency.",
    trigger: { type: "schedule", interval_minutes: 15 },
  },
  {
    key: "interval-1h",
    label: "Hourly",
    description: "Interval schedule with 60 minute frequency.",
    trigger: { type: "schedule", interval_minutes: 60 },
  },
  {
    key: "daily-0900",
    label: "Daily at 09:00 UTC",
    description: "Runs once per day at 09:00 UTC.",
    trigger: { type: "daily", hour: 9, minute: 0 },
  },
  {
    key: "weekly-mon-0900",
    label: "Weekly Mon 09:00 UTC",
    description: "Runs on Mondays at 09:00 UTC.",
    trigger: { type: "weekly", weekdays: ["mon"], hour: 9, minute: 0 },
  },
]

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    type: "create_chat_task",
    label: "Create chat task",
    description: "Creates a new task in chat_tasks.",
    fields: [
      { key: "title", label: "Task title", type: "text", required: true, placeholder: "Investigate connector timeout" },
      { key: "details", label: "Task details", type: "multiline", placeholder: "Context and acceptance criteria" },
      {
        key: "status",
        label: "Initial status",
        type: "select",
        options: [
          { value: "open", label: "open", description: "Open" },
          { value: "in_progress", label: "in_progress", description: "In progress" },
          { value: "blocked", label: "blocked", description: "Blocked" },
          { value: "done", label: "done", description: "Done" },
          { value: "cancelled", label: "cancelled", description: "Cancelled" },
        ],
      },
      { key: "chat_id", label: "Chat ID (optional)", type: "text", placeholder: "{{chat_id}}" },
      { key: "assignee", label: "Assignee (optional)", type: "text" },
      { key: "due_date", label: "Due date (optional)", type: "text", placeholder: "2026-03-01" },
    ],
    defaults: { title: "Automation task", details: "", status: "open", chat_id: "{{chat_id}}" },
  },
  {
    type: "update_chat_task",
    label: "Update chat task",
    description: "Updates an existing task by task_id or title match.",
    fields: [
      { key: "task_id", label: "Task ID (preferred)", type: "text" },
      { key: "task_title_contains", label: "Fallback: title contains", type: "text", placeholder: "Investigate" },
      { key: "chat_id", label: "Chat filter (optional)", type: "text", placeholder: "{{chat_id}}" },
      { key: "title", label: "New title (optional)", type: "text" },
      { key: "details", label: "Details update", type: "multiline" },
      { key: "append_details", label: "Append details", type: "boolean" },
      {
        key: "status",
        label: "Set status",
        type: "select",
        options: [
          { value: "", label: "(no change)", description: "No change" },
          { value: "open", label: "open", description: "Open" },
          { value: "in_progress", label: "in_progress", description: "In progress" },
          { value: "blocked", label: "blocked", description: "Blocked" },
          { value: "done", label: "done", description: "Done" },
          { value: "cancelled", label: "cancelled", description: "Cancelled" },
        ],
      },
      { key: "assignee", label: "Assignee (optional)", type: "text" },
      { key: "due_date", label: "Due date (optional)", type: "text" },
    ],
    defaults: { task_id: "", task_title_contains: "", chat_id: "{{chat_id}}", append_details: false, status: "" },
  },
  {
    type: "append_chat_message",
    label: "Append chat message",
    description: "Appends a system/assistant message to chat.",
    fields: [
      { key: "chat_id", label: "Chat ID", type: "text", placeholder: "{{chat_id}}" },
      {
        key: "role",
        label: "Role",
        type: "select",
        options: [
          { value: "assistant", label: "assistant", description: "Assistant" },
          { value: "system", label: "system", description: "System" },
          { value: "tool", label: "tool", description: "Tool" },
        ],
      },
      { key: "content", label: "Message content", type: "multiline", required: true },
    ],
    defaults: { chat_id: "{{chat_id}}", role: "assistant", content: "Automation note." },
  },
  {
    type: "set_chat_title",
    label: "Set chat title",
    description: "Updates the chat title.",
    fields: [
      { key: "chat_id", label: "Chat ID (optional)", type: "text", placeholder: "{{chat_id}}" },
      { key: "title", label: "Title", type: "text", required: true, placeholder: "Release planning sync" },
    ],
    defaults: { chat_id: "{{chat_id}}", title: "Automation updated title" },
  },
  {
    type: "request_user_input",
    label: "Request user input",
    description: "Asks the user an open-text or single-choice follow-up question.",
    fields: [
      { key: "chat_id", label: "Chat ID", type: "text", placeholder: "{{chat_id}}", required: true },
      { key: "question", label: "Question", type: "multiline", required: true },
      {
        key: "answer_mode",
        label: "Answer mode",
        type: "select",
        options: [
          { value: "open_text", label: "open_text", description: "Free text answer" },
          { value: "single_choice", label: "single_choice", description: "User selects one option" },
        ],
      },
      { key: "options", label: "Choice options (CSV)", type: "csv", help: "Required for single_choice mode" },
    ],
    defaults: {
      chat_id: "{{chat_id}}",
      question: "Can you clarify this request?",
      answer_mode: "single_choice",
      options: ["Option 1", "Option 2"],
    },
  },
  {
    type: "run_incremental_ingestion",
    label: "Run incremental ingestion",
    description: "Runs ingestion for configured/all connectors.",
    fields: [{ key: "connectors", label: "Connector filter (CSV, optional)", type: "csv" }],
    defaults: { connectors: [] },
  },
  {
    type: "generate_documentation",
    label: "Generate documentation",
    description: "Regenerates project documentation markdown.",
    fields: [
      { key: "branch", label: "Branch (optional)", type: "text", placeholder: "main" },
      { key: "user_id", label: "User ID (optional)", type: "text", placeholder: "automation@system" },
    ],
    defaults: { branch: "main" },
  },
  {
    type: "dispatch_event",
    label: "Dispatch event",
    description: "Dispatches a custom event so other automations can react.",
    fields: [
      { key: "event_type", label: "Event name", type: "text", required: true, placeholder: "ops.alert" },
      { key: "payload", label: "Event payload (JSON)", type: "json" },
    ],
    defaults: { event_type: "ops.alert", payload: { message: "Alert from automation" } },
  },
  {
    type: "run_automation",
    label: "Run another automation",
    description: "Chains another automation by id/name.",
    fields: [
      { key: "automation_id", label: "Target automation ID", type: "text" },
      { key: "automation_name", label: "Fallback target name", type: "text" },
      { key: "dry_run", label: "Dry-run target", type: "boolean" },
      { key: "payload", label: "Extra payload (JSON)", type: "json" },
    ],
    defaults: { automation_id: "", automation_name: "", dry_run: false, payload: {} },
  },
  {
    type: "set_automation_enabled",
    label: "Enable/disable automation",
    description: "Toggles another automation on/off.",
    fields: [
      { key: "automation_id", label: "Target automation ID", type: "text" },
      { key: "automation_name", label: "Fallback target name", type: "text" },
      { key: "enabled", label: "Enabled", type: "boolean" },
    ],
    defaults: { automation_id: "", automation_name: "", enabled: true },
  },
  {
    type: "upsert_state_value",
    label: "Upsert automation state",
    description: "Stores a key/value pair in project automation state.",
    fields: [
      { key: "key", label: "State key", type: "text", required: true, placeholder: "last_answer_snapshot" },
      { key: "value", label: "State value (JSON)", type: "json" },
    ],
    defaults: { key: "", value: {} },
  },
]

export const ACTION_PRESETS: ActionPreset[] = [
  {
    key: "create-investigation-task",
    label: "Create investigation task",
    description: "Creates an open follow-up task in the current chat.",
    actionType: "create_chat_task",
    params: {
      title: "Investigate automation event",
      details: "Triggered from {{event_type}}. Question: {{question}}",
      status: "open",
      chat_id: "{{chat_id}}",
    },
  },
  {
    key: "ask-clarification",
    label: "Ask for clarification",
    description: "Requests user input with single-choice options.",
    actionType: "request_user_input",
    params: {
      chat_id: "{{chat_id}}",
      question: "Do you want me to continue with this approach?",
      answer_mode: "single_choice",
      options: ["Continue", "Adjust plan", "Stop"],
    },
  },
  {
    key: "append-note",
    label: "Append chat note",
    description: "Posts an assistant note into current chat.",
    actionType: "append_chat_message",
    params: {
      chat_id: "{{chat_id}}",
      role: "assistant",
      content: "Automation executed successfully.",
    },
  },
  {
    key: "generate-main-docs",
    label: "Generate docs on main",
    description: "Runs documentation generation for main branch.",
    actionType: "generate_documentation",
    params: {
      branch: "main",
    },
  },
  {
    key: "run-ingestion",
    label: "Run ingestion",
    description: "Runs incremental ingestion for all configured connectors.",
    actionType: "run_incremental_ingestion",
    params: {
      connectors: [],
    },
  },
  {
    key: "dispatch-ops-alert",
    label: "Dispatch ops.alert event",
    description: "Dispatches a custom ops.alert automation event.",
    actionType: "dispatch_event",
    params: {
      event_type: "ops.alert",
      payload: {
        message: "Automation raised an operations alert.",
        chat_id: "{{chat_id}}",
      },
    },
  },
  {
    key: "close-investigation-task",
    label: "Close matching investigation task",
    description: "Marks latest matching investigation task as done.",
    actionType: "update_chat_task",
    params: {
      chat_id: "{{chat_id}}",
      task_title_contains: "Investigate",
      status: "done",
      append_details: true,
      details: "Closed by automation.",
    },
  },
]

export const CONDITION_TUTORIAL_LINES = [
  "Conditions are evaluated against the trigger payload.",
  "match_mode = all: every configured condition must be true.",
  "match_mode = any: at least one configured condition must be true.",
  "If no condition is configured, the automation runs whenever the trigger fires.",
]

export const PARAMETER_TUTORIAL_LINES = [
  "You can use template placeholders in string fields: {{chat_id}}, {{branch}}, {{question}}, {{answer}}, {{tool_errors}}.",
  "Use CSV fields for simple lists, JSON fields for structured payloads.",
  "Advanced JSON overrides the guided form if enabled.",
]

export const CONDITION_PRESETS: ConditionPreset[] = [
  {
    key: "tool-errors",
    label: "On tool errors",
    description: "Trigger when at least one tool error happened.",
    values: { match_mode: "all", tool_errors_min: 1 },
  },
  {
    key: "grounded-answer",
    label: "Grounded answers only",
    description: "Only run when answer grounding succeeded and no tool errors happened.",
    values: { match_mode: "all", grounded_is: true, tool_errors_max: 0 },
  },
  {
    key: "ungrounded-answer",
    label: "Ungrounded answers",
    description: "Only run when answer grounding failed.",
    values: { match_mode: "all", grounded_is: false },
  },
  {
    key: "connector-degraded",
    label: "Connector degraded",
    description: "Run when one or more connectors are failing.",
    values: { match_mode: "all", failed_connectors_min: 1 },
  },
  {
    key: "followup-pending",
    label: "User input pending",
    description: "Only run when the chat is waiting for user input.",
    values: { match_mode: "all", pending_user_input_is: true },
  },
  {
    key: "urgent-keywords",
    label: "Urgent keyword match",
    description: "Question/answer mentions urgent triage words.",
    values: {
      match_mode: "any",
      keyword_contains: ["urgent", "blocker", "critical", "p1"],
      answer_contains: ["urgent", "blocker", "critical", "p1"],
    },
  },
  {
    key: "main-branch-only",
    label: "Main branch only",
    description: "Restrict to main branch runs.",
    values: { match_mode: "all", branch_in: ["main"] },
  },
  {
    key: "heavy-tool-usage",
    label: "Heavy tool usage",
    description: "Run only when many tools were used.",
    values: { match_mode: "all", tool_calls_min: 8 },
  },
  {
    key: "openai-only",
    label: "OpenAI provider only",
    description: "Run only for OpenAI-based answers.",
    values: { match_mode: "all", llm_provider_in: ["openai"] },
  },
]

export function getActionDefinition(actionType: string): ActionDefinition {
  const found = ACTION_DEFINITIONS.find((item) => item.type === actionType)
  return found || ACTION_DEFINITIONS[0]
}

export function defaultActionParams(actionType: string): Record<string, unknown> {
  const def = getActionDefinition(actionType)
  return { ...def.defaults }
}
