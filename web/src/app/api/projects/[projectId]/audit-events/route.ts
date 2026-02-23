import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(
    req: Request,
    ctx: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await ctx.params
    const inUrl = new URL(req.url)
    const upstream = new URL(`${BACKEND}/projects/${encodeURIComponent(projectId)}/audit-events`)
    for (const key of ["branch", "chat_id", "event", "limit"]) {
        const value = inUrl.searchParams.get(key)
        if (value != null && value !== "") {
            upstream.searchParams.set(key, value)
        }
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
