import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/memory`, {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    })
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
