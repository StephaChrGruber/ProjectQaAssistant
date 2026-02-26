import type { LocalToolJobPayload } from "@/lib/local-custom-tool-runner"

export type ProjectRow = {
    id: string
    key: string
    name: string
}

export type CustomToolRow = {
    id: string
    projectId?: string | null
    name: string
    slug: string
    description?: string
    classKey?: string | null
    runtime: "backend_python" | "local_typescript"
    isEnabled: boolean
    readOnly: boolean
    requireApproval: boolean
    timeoutSec: number
    rateLimitPerMin: number
    maxRetries: number
    cacheTtlSec: number
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    tags?: string[]
    latestVersion: number
    publishedVersion?: number | null
}

export type ToolVersionRow = {
    id: string
    toolId: string
    version: number
    status: "draft" | "published" | "archived"
    checksum: string
    changelog?: string
    code?: string
    createdAt?: string
}

export type SystemToolRow = {
    id: string
    projectId?: string | null
    name: string
    description?: string
    isEnabled: boolean
    readOnly: boolean
    timeoutSec: number
    rateLimitPerMin: number
    maxRetries: number
    cacheTtlSec: number
    requireApproval: boolean
    classKey?: string | null
    classPath?: string | null
    classDisplay?: string | null
}

export type ToolDetailResponse = {
    tool: CustomToolRow & { secrets?: Record<string, string> }
    versions: ToolVersionRow[]
}

export type ToolForm = {
    id?: string
    projectId: string
    name: string
    description: string
    classKey: string
    runtime: "backend_python" | "local_typescript"
    isEnabled: boolean
    readOnly: boolean
    requireApproval: boolean
    timeoutSec: number
    rateLimitPerMin: number
    maxRetries: number
    cacheTtlSec: number
    inputSchemaText: string
    outputSchemaText: string
    secretsText: string
    tagsText: string
    codeText: string
}

export type LocalToolClaimResponse = {
    job: LocalToolJobPayload | null
}

export type ToolTemplate = {
    id: string
    runtime: "backend_python" | "local_typescript"
    name: string
    description: string
    code: string
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    testArgs?: Record<string, unknown>
}

export type ToolClassRow = {
    key: string
    displayName: string
    description?: string | null
    parentKey?: string | null
    path?: string
    origin?: string
    isEnabled?: boolean
}
