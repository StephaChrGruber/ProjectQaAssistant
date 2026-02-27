import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET() {
  const res = await fetchBackend("/runtime/info", { method: "GET" })
  return proxyJsonResponse(res)
}

