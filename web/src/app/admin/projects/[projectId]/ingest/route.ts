import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function POST(
    req: Request,
    { params }: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await params
    const body = await req.text()

    const res = await fetch(`${BACKEND}/admin/projects/${projectId}/ingest`, {
        method: "POST",
        headers: {
            "Content-Type": req.headers.get("content-type") ?? "application/json",
            "X-Dev-User": DEV_USER,
            "X-Dev-Admin": "true",
        },
        body,
    })

    const text = await res.text()
    return new NextResponse(text, { status: res.status })
}
