import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params
  const body = await req.text()
  let user = DEV_USER
  try {
    const parsed = JSON.parse(body || "{}") as { user?: string }
    const candidate = String(parsed.user || "").trim()
    if (candidate) user = candidate
  } catch {
    // ignore parse failures
  }

  const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(projectId)}/workspace/patch/normalize`, {
    method: "POST",
    headers: {
      "X-Dev-User": user,
      "Content-Type": req.headers.get("content-type") || "application/json",
    },
    body,
    cache: "no-store",
  })

  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  })
}
