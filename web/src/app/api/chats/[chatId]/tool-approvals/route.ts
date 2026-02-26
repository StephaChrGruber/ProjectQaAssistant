import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(
    req: Request,
    ctx: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await ctx.params
    const url = new URL(req.url)
    const user = (url.searchParams.get("user") || "").trim() || DEV_USER
    const upstream = new URL(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tool-approvals`)
    for (const key of ["context_key", "project_id", "branch"]) {
        const value = url.searchParams.get(key)
        if (value != null && value !== "") {
            upstream.searchParams.set(key, value)
        }
    }
    const res = await fetch(upstream.toString(), {
        headers: { "X-Dev-User": user },
        cache: "no-store",
    })
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}

export async function POST(
    req: Request,
    ctx: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await ctx.params
    const body = await req.text()
    let user = DEV_USER
    try {
        const parsed = JSON.parse(body || "{}") as { user?: string }
        const candidate = String(parsed.user || "").trim()
        if (candidate) user = candidate
    } catch {
        // fall back to default user
    }
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tool-approvals`, {
        method: "POST",
        headers: {
            "X-Dev-User": user,
            "Content-Type": req.headers.get("content-type") || "application/json",
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
