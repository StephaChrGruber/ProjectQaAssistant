import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function POST(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const body = await req.text()
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dev-User": DEV_USER },
        body,
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status })
}
