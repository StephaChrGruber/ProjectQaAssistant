import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ notificationId: string }> }
) {
  const { notificationId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(`/notifications/${encodeURIComponent(notificationId)}`, {
    method: "PATCH",
    headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
    body,
  })
  return proxyJsonResponse(res)
}

