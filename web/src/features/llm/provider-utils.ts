"use client"

export type LlmProviderOptionLite = {
    value: string
    defaultBaseUrl?: string | null
}

export type LlmOptionsLike = {
    providers?: LlmProviderOptionLite[] | null
    ollama_models?: string[] | null
    openai_models?: string[] | null
} | null | undefined

type ResolveBaseUrlDefaults = {
    openai: string
    ollama: string
}

type ResolveModelOptionsInput = {
    provider: string
    current?: string
    llmOptions: LlmOptionsLike
    fallbackOpenAiModels: string[]
    fallbackOllamaModels: string[]
}

export function resolveProviderOptions<T extends LlmProviderOptionLite>(
    llmOptions: LlmOptionsLike,
    fallback: T[]
): T[] {
    const providers = (llmOptions?.providers || []) as T[]
    return providers.length ? providers : fallback
}

export function resolveDefaultBaseUrlForProvider(
    provider: string,
    providerOptions: LlmProviderOptionLite[],
    defaults: ResolveBaseUrlDefaults
): string {
    const normalizedProvider = (provider || "ollama").trim() || "ollama"
    const found = providerOptions.find((item) => item.value === normalizedProvider)
    const optionBase = String(found?.defaultBaseUrl || "").trim()
    if (optionBase) return optionBase
    return normalizedProvider === "openai" ? defaults.openai : defaults.ollama
}

export function resolveModelOptionsForProvider({
    provider,
    current,
    llmOptions,
    fallbackOpenAiModels,
    fallbackOllamaModels,
}: ResolveModelOptionsInput): string[] {
    const normalizedProvider = (provider || "ollama").trim() || "ollama"
    const discovered =
        normalizedProvider === "openai"
            ? (llmOptions?.openai_models || [])
            : (llmOptions?.ollama_models || [])
    const fallback = normalizedProvider === "openai" ? fallbackOpenAiModels : fallbackOllamaModels
    const base = discovered.length ? discovered : fallback
    const options = [...base]
    const currentValue = (current || "").trim()
    if (currentValue && !options.includes(currentValue)) {
        options.unshift(currentValue)
    }
    return Array.from(new Set(options))
}

