import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ projectId: string; presetId: string }> }
) {
  const { projectId, presetId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/presets/${encodeURIComponent(presetId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
      body,
    }
  )
  return proxyJsonResponse(res)
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ projectId: string; presetId: string }> }
) {
  const { projectId, presetId } = await ctx.params
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/presets/${encodeURIComponent(presetId)}`,
    { method: "DELETE" }
  )
  return proxyJsonResponse(res)
}
