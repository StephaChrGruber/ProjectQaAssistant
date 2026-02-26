import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function GET(req: Request) {
  const inUrl = new URL(req.url)
  const projectId = inUrl.searchParams.get("projectId") || inUrl.searchParams.get("project_id") || ""
  const branch = inUrl.searchParams.get("branch") || "main"
  const chatId = inUrl.searchParams.get("chatId") || inUrl.searchParams.get("chat_id") || ""
  const user = inUrl.searchParams.get("user") || DEV_USER
  const includeUnavailable = inUrl.searchParams.get("include_unavailable")
  const includeEmpty = inUrl.searchParams.get("include_empty")

  if (!projectId) {
    return NextResponse.json({ detail: "projectId is required" }, { status: 400 })
  }

  const upstream = new URL(`${BACKEND}/tools/classes/availability`)
  upstream.searchParams.set("project_id", projectId)
  upstream.searchParams.set("branch", branch)
  if (chatId) upstream.searchParams.set("chat_id", chatId)
  if (user) upstream.searchParams.set("user", user)
  if (includeUnavailable != null) upstream.searchParams.set("include_unavailable", includeUnavailable)
  if (includeEmpty != null) upstream.searchParams.set("include_empty", includeEmpty)

  const res = await fetch(upstream.toString(), {
    headers: { "X-Dev-User": user || DEV_USER },
    cache: "no-store",
  })
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  })
}

