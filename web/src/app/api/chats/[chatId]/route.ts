import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}`, {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status })
}
