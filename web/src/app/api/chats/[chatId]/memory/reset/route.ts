import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function POST(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const inUrl = new URL(req.url)
    const user = inUrl.searchParams.get("user") || DEV_USER
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/memory/reset`, {
        method: "POST",
        headers: { "X-Dev-User": user },
    })
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
