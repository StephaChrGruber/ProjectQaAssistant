import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(
    req: Request,
    ctx: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await ctx.params
    const inUrl = new URL(req.url)
    const upstream = new URL(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tasks`)
    for (const key of ["status", "limit"]) {
        const value = inUrl.searchParams.get(key)
        if (value != null && value !== "") {
            upstream.searchParams.set(key, value)
        }
    }
    const user = inUrl.searchParams.get("user") || DEV_USER
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
    const inUrl = new URL(req.url)
    const user = inUrl.searchParams.get("user") || DEV_USER
    const body = await req.text()
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tasks`, {
        method: "POST",
        headers: {
            "X-Dev-User": user,
            "Content-Type": req.headers.get("content-type") || "application/json",
        },
        body,
    })
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
