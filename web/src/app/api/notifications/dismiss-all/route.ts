import { fetchBackend, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function POST(req: Request) {
  const body = await req.text()
  const res = await fetchBackend("/notifications/dismiss-all", {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
    body: body || "{}",
  })
  return proxyJsonResponse(res)
}

