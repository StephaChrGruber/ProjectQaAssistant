import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function GET(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const inUrl = new URL(req.url)
    const upstream = new URL(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tool-policy`)
    for (const key of ["context_key", "project_id", "branch"]) {
        const value = inUrl.searchParams.get(key)
        if (value != null && value !== "") {
            upstream.searchParams.set(key, value)
        }
    }
    const res = await fetch(upstream.toString(), {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") || "application/json" } })
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const body = await req.text()
    const res = await fetch(`${BACKEND}/chats/${encodeURIComponent(chatId)}/tool-policy`, {
        method: "PUT",
        headers: {
            "Content-Type": req.headers.get("content-type") || "application/json",
            "X-Dev-User": DEV_USER,
        },
        body,
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") || "application/json" } })
}
