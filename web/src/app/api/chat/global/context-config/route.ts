import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(req: Request) {
    const url = new URL(req.url)
    const qs = url.search || ""
    const res = await fetchBackend(`/chat/global/context-config${qs}`, {
        method: "GET",
    })
    return proxyJsonResponse(res)
}

export async function PUT(req: Request) {
    const body = await req.text()
    const res = await fetchBackend("/chat/global/context-config", {
        method: "PUT",
        headers: {
            "Content-Type": req.headers.get("content-type") || "application/json",
        },
        body,
    })
    return proxyJsonResponse(res)
}
