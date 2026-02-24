import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string; automationId: string }> }
) {
  const { projectId, automationId } = await ctx.params
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(automationId)}`,
    { method: "GET" }
  )
  return proxyJsonResponse(res)
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ projectId: string; automationId: string }> }
) {
  const { projectId, automationId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(automationId)}`,
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
  ctx: { params: Promise<{ projectId: string; automationId: string }> }
) {
  const { projectId, automationId } = await ctx.params
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(automationId)}`,
    { method: "DELETE" }
  )
  return proxyJsonResponse(res)
}

