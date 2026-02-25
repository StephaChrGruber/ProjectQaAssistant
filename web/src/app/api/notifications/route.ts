import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(req: Request) {
  const inUrl = new URL(req.url)
  const upstream = new URL("/notifications", "http://backend.local")
  const projectId = inUrl.searchParams.get("project_id")
  const includeDismissed = inUrl.searchParams.get("include_dismissed")
  const limit = inUrl.searchParams.get("limit")
  if (projectId) upstream.searchParams.set("project_id", projectId)
  if (includeDismissed != null) upstream.searchParams.set("include_dismissed", includeDismissed)
  if (limit != null) upstream.searchParams.set("limit", limit)
  const res = await fetchBackend(`${upstream.pathname}${upstream.search}`, { method: "GET" })
  return proxyJsonResponse(res)
}

