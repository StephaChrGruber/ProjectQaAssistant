import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function GET(req: Request) {
  const upstream = new URL(`${BACKEND}/tools/classes`)
  try {
    const inUrl = new URL(req.url)
    const includeDisabled = inUrl.searchParams.get("include_disabled")
    if (includeDisabled != null) upstream.searchParams.set("include_disabled", includeDisabled)
  } catch {
    // ignore malformed request URL
  }
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

