import { backendUrl, devProxyHeaders, proxyJsonResponse } from "@/lib/http/backend-proxy"

export async function GET(
    req: Request,
    ctx: { params: Promise<{ projectId: string }> }
) {
    const { projectId } = await ctx.params
    const url = new URL(req.url)
    const branch = url.searchParams.get("branch")
    const limit = url.searchParams.get("limit")
    const user = url.searchParams.get("user")

    const upstream = new URL(backendUrl(`/chats/by-project/${encodeURIComponent(projectId)}`))
    if (branch) {
        upstream.searchParams.set("branch", branch)
    }
    if (limit) {
        upstream.searchParams.set("limit", limit)
    }
    if (user) {
        upstream.searchParams.set("user", user)
    }

    const res = await fetch(upstream.toString(), {
        headers: devProxyHeaders(),
        cache: "no-store",
    })
    return proxyJsonResponse(res)
}
