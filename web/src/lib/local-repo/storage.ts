import {
    IDB_NAME,
    IDB_STORE_HANDLES,
    IDB_STORE_SNAPSHOTS,
    IDB_VERSION,
    LOCAL_STORAGE_PREFIX,
    SESSION_STORAGE_PREFIX,
} from "./constants"
import type { LocalRepoSnapshot } from "./types"

export const snapshotCache = new Map<string, LocalRepoSnapshot>()
export const handleCache = new Map<string, FileSystemDirectoryHandle>()

export function sessionStorageKey(projectId: string): string {
    return `${SESSION_STORAGE_PREFIX}${projectId}`
}

export function localStorageKey(projectId: string): string {
    return `${LOCAL_STORAGE_PREFIX}${projectId}`
}

export function hasWindow(): boolean {
    return typeof window !== "undefined"
}

async function openLocalRepoDb(): Promise<IDBDatabase | null> {
    if (!hasWindow() || !("indexedDB" in window)) return null
    return await new Promise<IDBDatabase | null>((resolve) => {
        try {
            const req = window.indexedDB.open(IDB_NAME, IDB_VERSION)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains(IDB_STORE_SNAPSHOTS)) {
                    db.createObjectStore(IDB_STORE_SNAPSHOTS)
                }
                if (!db.objectStoreNames.contains(IDB_STORE_HANDLES)) {
                    db.createObjectStore(IDB_STORE_HANDLES)
                }
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
}

export async function idbGet(store: string, key: string): Promise<any> {
    const db = await openLocalRepoDb()
    if (!db) return null
    return await new Promise<any>((resolve) => {
        const tx = db.transaction(store, "readonly")
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
    })
}

export async function idbSet(store: string, key: string, value: any): Promise<void> {
    const db = await openLocalRepoDb()
    if (!db) return
    await new Promise<void>((resolve) => {
        const tx = db.transaction(store, "readwrite")
        tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
    })
}

export async function idbDelete(store: string, key: string): Promise<void> {
    const db = await openLocalRepoDb()
    if (!db) return
    await new Promise<void>((resolve) => {
        const tx = db.transaction(store, "readwrite")
        tx.objectStore(store).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
    })
}

export { IDB_STORE_HANDLES, IDB_STORE_SNAPSHOTS }
