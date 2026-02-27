import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET() {
  const res = await fetchBackend("/health/live", { method: "GET" })
  return proxyJsonResponse(res)
}

