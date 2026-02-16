import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(
    req: Request,
    ctx: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await ctx.params
    const url = new URL(req.url)
    const branch = url.searchParams.get("branch")
    const limit = url.searchParams.get("limit")

    const upstream = new URL(`${BACKEND}/chats/by-project/${encodeURIComponent(projectId)}`)
    if (branch) {
        upstream.searchParams.set("branch", branch)
    }
    if (limit) {
        upstream.searchParams.set("limit", limit)
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

