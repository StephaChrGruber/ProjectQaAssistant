import { NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_BASE_URL || "http://backend:8080"
const DEV_USER = process.env.POC_DEV_USER || "dev@local"
const DEV_ADMIN = (process.env.POC_DEV_ADMIN || "").toLowerCase() === "true"

export function backendUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`backend path must start with '/': ${path}`)
  }
  return `${BACKEND}${path}`
}

export function devProxyHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  if (!headers.has("X-Dev-User")) headers.set("X-Dev-User", DEV_USER)
  if (DEV_ADMIN && !headers.has("X-Dev-Admin")) headers.set("X-Dev-Admin", "true")
  return headers
}

export async function proxyJsonResponse(res: Response): Promise<NextResponse> {
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/json",
    },
  })
}

export async function fetchBackend(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = devProxyHeaders(init.headers)
  return fetch(backendUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  })
}

