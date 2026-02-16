import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function POST(
    req: Request,
    ctx: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await ctx.params
    const body = await req.text()

    let res: Response
    try {
        res = await fetch(`${BACKEND}/projects/${encodeURIComponent(projectId)}/documentation/generate-local`, {
            method: "POST",
            headers: {
                "Content-Type": req.headers.get("content-type") || "application/json",
                "X-Dev-User": DEV_USER,
            },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(900_000),
        })
    } catch (err) {
        return NextResponse.json(
            {
                detail:
                    "Documentation generation timed out while waiting for backend response. " +
                    "Try again; if it keeps happening, reduce repository context or switch to a faster model.",
                error: String(err),
            },
            { status: 504 }
        )
    }

    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
