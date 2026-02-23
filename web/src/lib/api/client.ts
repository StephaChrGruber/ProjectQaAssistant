import { backendJson } from "@/lib/backend"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue }

export async function apiGet<T>(path: string): Promise<T> {
  return backendJson<T>(path, { method: "GET" })
}

export async function apiPost<T, B extends JsonValue | Record<string, unknown> | undefined = undefined>(
  path: string,
  body?: B
): Promise<T> {
  return backendJson<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export async function apiPut<T, B extends JsonValue | Record<string, unknown> | undefined = undefined>(
  path: string,
  body?: B
): Promise<T> {
  return backendJson<T>(path, {
    method: "PUT",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export async function apiDelete<T>(path: string): Promise<T> {
  return backendJson<T>(path, { method: "DELETE" })
}

