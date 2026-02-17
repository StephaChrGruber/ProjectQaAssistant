import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL!
const DEV_USER = process.env.POC_DEV_USER || "dev"

export async function GET(req: Request) {
    const url = new URL(`${BACKEND}/tools/catalog`)
    try {
        const parsed = new URL(req.url)
        const projectId = parsed.searchParams.get("projectId") || parsed.searchParams.get("project_id")
        if (projectId) {
            url.searchParams.set("project_id", projectId)
        }
    } catch {
        // ignore malformed request url
    }

    const res = await fetch(url.toString(), {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    })
    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
