import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ projectId: string; presetId: string }> }
) {
  const { projectId, presetId } = await ctx.params
  const inUrl = new URL(req.url)
  const upstream = new URL(
    `/projects/${encodeURIComponent(projectId)}/automations/presets/${encodeURIComponent(presetId)}/versions`,
    "http://backend.local"
  )
  const limit = inUrl.searchParams.get("limit")
  if (limit != null) upstream.searchParams.set("limit", limit)

  const res = await fetchBackend(`${upstream.pathname}${upstream.search}`, { method: "GET" })
  return proxyJsonResponse(res)
}
