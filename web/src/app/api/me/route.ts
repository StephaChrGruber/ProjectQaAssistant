import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"
const DEV_ADMIN = (process.env.POC_DEV_ADMIN || "").toLowerCase() === "true"

export async function GET() {
    const headers: Record<string, string> = {
        "X-Dev-User": DEV_USER,
    }
    if (DEV_ADMIN) {
        headers["X-Dev-Admin"] = "true"
    }

    const res = await fetch(`${BACKEND}/me`, {
        headers,
        cache: "no-store",
    })

    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}

