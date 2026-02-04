import { NextResponse } from "next/server"
import { backendFetch } from "../../../lib/api"

export async function POST(req: Request) {
    const body = await req.json()
    const data = await backendFetch("/ask", { method: "POST", body: JSON.stringify(body) })
    return NextResponse.json(data)
}
