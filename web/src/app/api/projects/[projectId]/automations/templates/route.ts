import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params
  const res = await fetchBackend(`/projects/${encodeURIComponent(projectId)}/automations/templates`, {
    method: "GET",
  })
  return proxyJsonResponse(res)
}

