export const OPEN_GLOBAL_NOTIFICATIONS_EVENT = "open-global-notifications"

export function requestOpenGlobalNotifications() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_NOTIFICATIONS_EVENT))
}

