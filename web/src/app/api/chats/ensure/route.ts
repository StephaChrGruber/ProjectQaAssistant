import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(req: Request) {
    const body = await req.text()
    const res = await fetchBackend("/chats/ensure-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    })
    return proxyJsonResponse(res)
}
