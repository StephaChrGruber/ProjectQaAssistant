// web/src/app/api/projects/[projectId]/route.ts
import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8000"
const DEV_USER = process.env.NEXT_PUBLIC_DEV_USER || "dev"

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ projectId: string }> } // params is a Promise in your Next version
) {
    const { projectId } = await ctx.params

    const res = await fetch(`${BACKEND}/projects/${projectId}`, {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    })

    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
