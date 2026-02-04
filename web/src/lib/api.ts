import getServerSession from "next-auth"

export async function backendFetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers || {})
    headers.set("Content-Type", "application/json")

    // POC dev identity (later replaced by SSO token)
    headers.set("X-Dev-User", process.env.POC_DEV_USER || "dev@local")
    if ((process.env.POC_DEV_ADMIN || "").toLowerCase() === "true") {
        headers.set("X-Dev-Admin", "true")
    }

    const base = process.env.BACKEND_BASE_URL!
    const res = await fetch(`${base}${path}`, { ...init, headers, cache: "no-store" })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}
