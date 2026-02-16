export const BACKEND = process.env.NEXT_PUBLIC_BACKEND_BASE_URL || "http://localhost:8080"

// src/lib/backend.ts
export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
    if (!path.startsWith("/api/")) {
        throw new Error(`backendJson() must be called with /api/*, got: ${path}`)
    }
    const res = await fetch(path, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
        cache: "no-store",
    })

    const contentType = res.headers.get("content-type") || ""
    const text = await res.text()

    if (!res.ok) {
        // If Next returned an HTML error page, don't dump it into the UI
        if (contentType.includes("text/html") || text.trim().startsWith("<!DOCTYPE html")) {
            throw new Error(`Request failed (${res.status}) for ${path}. Missing Next route or wrong URL.`)
        }
        throw new Error(text || `Request failed (${res.status}) for ${path}`)
    }

    // normal JSON
    return JSON.parse(text) as T
}


