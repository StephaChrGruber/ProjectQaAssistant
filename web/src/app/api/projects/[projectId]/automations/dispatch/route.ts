import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(`/projects/${encodeURIComponent(projectId)}/automations/dispatch`, {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
    body,
  })
  return proxyJsonResponse(res)
}

