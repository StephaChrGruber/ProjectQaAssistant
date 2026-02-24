import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(
  req: Request,
  ctx: { params: Promise<{ projectId: string; automationId: string }> }
) {
  const { projectId, automationId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/${encodeURIComponent(automationId)}/run`,
    {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
      body,
    }
  )
  return proxyJsonResponse(res)
}

