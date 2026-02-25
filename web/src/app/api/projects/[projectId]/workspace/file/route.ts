import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params
  const inUrl = new URL(req.url)
  const user = inUrl.searchParams.get("user") || DEV_USER

  const upstream = new URL(`${BACKEND}/projects/${encodeURIComponent(projectId)}/workspace/file`)
  for (const [key, value] of inUrl.searchParams.entries()) {
    if (key === "user") continue
    upstream.searchParams.append(key, value)
  }

  const res = await fetch(upstream.toString(), {
    headers: {
      "X-Dev-User": user,
    },
    cache: "no-store",
  })

  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params
  const body = await req.text()
  let user = DEV_USER
  try {
    const parsed = JSON.parse(body || "{}") as { user?: string }
    const candidate = String(parsed.user || "").trim()
    if (candidate) user = candidate
  } catch {
    // ignore parse errors
  }

  const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(projectId)}/workspace/file/write`, {
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

export async function DELETE(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params
  const body = await req.text()
  let user = DEV_USER
  try {
    const parsed = JSON.parse(body || "{}") as { user?: string }
    const candidate = String(parsed.user || "").trim()
    if (candidate) user = candidate
  } catch {
    // ignore parse errors
  }

  const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(projectId)}/workspace/file/delete`, {
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
