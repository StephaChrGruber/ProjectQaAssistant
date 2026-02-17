import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"
const DEV_ADMIN = (process.env.POC_DEV_ADMIN || "").toLowerCase() === "true"

function adminHeaders(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "X-Dev-User": DEV_USER,
    }
    if (DEV_ADMIN) {
        headers["X-Dev-Admin"] = "true"
    }
    if (contentType) {
        headers["Content-Type"] = contentType
    }
    return headers
}

export async function GET(
    req: Request,
    ctx: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await ctx.params
    const url = new URL(req.url)
    const hours = url.searchParams.get("hours")

    const upstream = new URL(`${BACKEND}/admin/projects/${encodeURIComponent(projectId)}/ingest/state`)
    if (hours) {
        upstream.searchParams.set("hours", hours)
    }

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
