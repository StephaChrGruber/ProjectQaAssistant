import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params
  const inUrl = new URL(req.url)
  const upstream = new URL(`/projects/${encodeURIComponent(projectId)}/automations/runs`, "http://backend.local")
  const automationId = inUrl.searchParams.get("automation_id")
  const limit = inUrl.searchParams.get("limit")
  if (automationId) upstream.searchParams.set("automation_id", automationId)
  if (limit) upstream.searchParams.set("limit", limit)

  const res = await fetchBackend(`${upstream.pathname}${upstream.search}`, { method: "GET" })
  return proxyJsonResponse(res)
}

