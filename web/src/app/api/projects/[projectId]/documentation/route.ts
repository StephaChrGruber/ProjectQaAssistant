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

    const upstream = new URL(`${BACKEND}/projects/${encodeURIComponent(projectId)}/documentation`)
    if (branch) {
        upstream.searchParams.set("branch", branch)
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
