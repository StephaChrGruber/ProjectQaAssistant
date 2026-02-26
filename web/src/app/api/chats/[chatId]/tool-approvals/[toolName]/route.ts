import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function DELETE(
    req: Request,
    ctx: { params: Promise<{ chatId: string; toolName: string }> }
) {
    const { chatId, toolName } = await ctx.params
    const url = new URL(req.url)
    const user = (url.searchParams.get("user") || "").trim() || DEV_USER
    const upstream = new URL(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tool-approvals/${encodeURIComponent(toolName)}`)
    for (const key of ["context_key", "project_id", "branch"]) {
        const value = url.searchParams.get(key)
        if (value != null && value !== "") {
            upstream.searchParams.set(key, value)
        }
    }
    const res = await fetch(
        upstream.toString(),
        {
            method: "DELETE",
            headers: { "X-Dev-User": user },
            cache: "no-store",
        }
    )
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
