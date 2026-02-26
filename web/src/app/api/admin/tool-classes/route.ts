import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(req: Request) {
  const upstream = new URL(`${BACKEND}/admin/tool-classes`)
  const inUrl = new URL(req.url)
  const includeBuiltin = inUrl.searchParams.get("include_builtin")
  const includeDisabled = inUrl.searchParams.get("include_disabled")
  if (includeBuiltin != null) upstream.searchParams.set("include_builtin", includeBuiltin)
  if (includeDisabled != null) upstream.searchParams.set("include_disabled", includeDisabled)

  const res = await fetch(upstream.toString(), {
    headers: { "X-Dev-User": DEV_USER },
    cache: "no-store",
  })
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  })
}

export async function POST(req: Request) {
  const body = await req.text()
  const res = await fetch(`${BACKEND}/admin/tool-classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dev-User": DEV_USER },
    body,
    cache: "no-store",
  })
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  })
}

