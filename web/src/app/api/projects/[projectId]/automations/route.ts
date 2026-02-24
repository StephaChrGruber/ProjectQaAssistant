import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params
  const inUrl = new URL(req.url)
  const upstream = new URL(`/projects/${encodeURIComponent(projectId)}/automations`, "http://backend.local")
  const includeDisabled = inUrl.searchParams.get("include_disabled")
  const limit = inUrl.searchParams.get("limit")
  if (includeDisabled != null) upstream.searchParams.set("include_disabled", includeDisabled)
  if (limit != null) upstream.searchParams.set("limit", limit)

  const res = await fetchBackend(`${upstream.pathname}${upstream.search}`, { method: "GET" })
  return proxyJsonResponse(res)
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(`/projects/${encodeURIComponent(projectId)}/automations`, {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
    body,
  })
  return proxyJsonResponse(res)
}

