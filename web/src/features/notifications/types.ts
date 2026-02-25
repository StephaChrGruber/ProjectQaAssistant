export type NotificationDoc = {
  id: string
  project_id?: string
  user_id?: string
  title: string
  message?: string
  severity?: "info" | "success" | "warning" | "error" | string
  source?: string
  event_type?: string
  data?: Record<string, unknown>
  dismissed?: boolean
  dismissed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type ListNotificationsResponse = {
  user_id: string
  project_id?: string | null
  total: number
  active_count: number
  items: NotificationDoc[]
}

