// web/src/app/api/projects/route.ts
import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8000"
const DEV_USER = process.env.NEXT_PUBLIC_DEV_USER || "dev"

export async function GET() {
    const res = await fetch(`${BACKEND}/projects`, {
        headers: { "X-Dev-User": DEV_USER },
        cache: "no-store",
    })

    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
