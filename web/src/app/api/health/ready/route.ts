import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET() {
  const res = await fetchBackend("/health/ready", { method: "GET" })
  return proxyJsonResponse(res)
}

