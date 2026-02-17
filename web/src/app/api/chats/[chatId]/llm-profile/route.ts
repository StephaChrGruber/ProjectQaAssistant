import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await ctx.params
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/llm-profile`, {
        headers: {
            "X-Dev-User": DEV_USER,
        },
        cache: "no-store",
    })

    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}

export async function PUT(
    req: Request,
    ctx: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await ctx.params
    const body = await req.text()
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/llm-profile`, {
        method: "PUT",
        headers: {
            "X-Dev-User": DEV_USER,
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
