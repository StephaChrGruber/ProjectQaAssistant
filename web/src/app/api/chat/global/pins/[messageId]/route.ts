import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

type Params = {
    params: Promise<{ messageId: string }>
}

export async function POST(req: Request, { params }: Params) {
    const { messageId } = await params
    const url = new URL(req.url)
    const qs = url.search || ""
    const body = await req.text()
    const res = await fetchBackend(`/chat/global/pins/${encodeURIComponent(messageId)}${qs}`, {
        method: "POST",
        headers: {
            "Content-Type": req.headers.get("content-type") || "application/json",
        },
        body,
    })
    return proxyJsonResponse(res)
}
