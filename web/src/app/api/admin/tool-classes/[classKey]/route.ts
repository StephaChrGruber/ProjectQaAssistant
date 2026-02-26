import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function PATCH(req: Request, { params }: { params: { classKey: string } }) {
  const body = await req.text()
  const key = encodeURIComponent(params.classKey)
  const res = await fetch(`${BACKEND}/admin/tool-classes/${key}`, {
    method: "PATCH",
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

