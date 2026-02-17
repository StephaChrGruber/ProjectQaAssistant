import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function POST(req: Request) {
    const body = await req.text()
    let caller = DEV_USER
    try {
        const parsed = JSON.parse(body || "{}") as { user?: string }
        const maybeUser = String(parsed.user || "").trim()
        if (maybeUser) caller = maybeUser
    } catch {
        // ignore parse failures; fallback to DEV_USER
    }
    const res = await fetch(`${BACKEND}/local-tools/jobs/claim`, {
        method: "POST",
        headers: {
            "X-Dev-User": caller,
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
