import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function PATCH(
    req: Request,
    ctx: { params: Promise<{ chatId: string; taskId: string }> }
) {
    const { chatId, taskId } = await ctx.params
    const inUrl = new URL(req.url)
    const user = inUrl.searchParams.get("user") || DEV_USER
    const body = await req.text()
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
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
