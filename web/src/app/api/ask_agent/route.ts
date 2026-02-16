// web/src/app/api/ask_agent/route.ts
import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"

export async function POST(req: Request) {
    const body = await req.json()

    // Accept whatever the UI sends, normalize to what backend expects.
    const payload = {
        project_id: body.project_id ?? body.projectId ?? body.project_key ?? body.projectKey,
        project_key: body.project_key ?? body.projectKey ?? body.project_id ?? body.projectId,
        branch: body.branch ?? "main",
        user: body.user ?? "dev",
        top_k: body.top_k ?? body.topK ?? 8,

        // IMPORTANT: backend expects "question"
        question: body.question ?? body.query ?? "",
        local_repo_context: body.local_repo_context ?? body.localRepoContext ?? null,
    }

    const res = await fetch(`${BACKEND}/ask_agent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Dev-User": DEV_USER,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
    })

    const text = await res.text()
    return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    })
}
