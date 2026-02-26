import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(req: Request) {
    const url = new URL(req.url)
    const qs = url.search || ""
    const res = await fetchBackend(`/chat/global/bootstrap${qs}`, {
        method: "GET",
    })
    return proxyJsonResponse(res)
}
