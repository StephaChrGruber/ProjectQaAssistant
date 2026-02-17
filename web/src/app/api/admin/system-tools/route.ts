import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"
const DEV_ADMIN = (process.env.POC_DEV_ADMIN || "").toLowerCase() === "true"

function adminHeaders(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = { "X-Dev-User": DEV_USER }
    if (DEV_ADMIN) headers["X-Dev-Admin"] = "true"
    if (contentType) headers["Content-Type"] = contentType
    return headers
}

export async function GET(req: Request) {
    const src = new URL(req.url)
    const upstream = new URL(`${BACKEND}/admin/system-tools`)
    const pid = src.searchParams.get("project_id") || src.searchParams.get("projectId")
    if (pid) upstream.searchParams.set("project_id", pid)

    const res = await fetch(upstream.toString(), {
        headers: adminHeaders(),
        cache: "no-store",
    })
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}

