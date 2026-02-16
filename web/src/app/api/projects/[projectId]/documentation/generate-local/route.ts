import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function POST(
    req: Request,
    ctx: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await ctx.params
    const body = await req.text()

    const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(projectId)}/documentation/generate-local`, {
        method: "POST",
        headers: {
            "Content-Type": req.headers.get("content-type") || "application/json",
            "X-Dev-User": DEV_USER,
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
