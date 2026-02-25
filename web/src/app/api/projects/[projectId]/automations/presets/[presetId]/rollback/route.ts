import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(
  req: Request,
  ctx: { params: Promise<{ projectId: string; presetId: string }> }
) {
  const { projectId, presetId } = await ctx.params
  const body = await req.text()
  const res = await fetchBackend(
    `/projects/${encodeURIComponent(projectId)}/automations/presets/${encodeURIComponent(presetId)}/rollback`,
    {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
      body,
    }
  )
  return proxyJsonResponse(res)
}
