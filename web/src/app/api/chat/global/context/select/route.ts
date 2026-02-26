import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(req: Request) {
    const body = await req.text()
    const res = await fetchBackend("/chat/global/context/select", {
        method: "POST",
        headers: {
            "Content-Type": req.headers.get("content-type") || "application/json",
        },
        body,
    })
    return proxyJsonResponse(res)
}
