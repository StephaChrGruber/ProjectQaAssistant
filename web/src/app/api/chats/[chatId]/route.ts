import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    const { chatId } = await params
    const res = await fetchBackend(`/chats/${encodeURIComponent(chatId)}`)
    return proxyJsonResponse(res)
}
