/**
 * Offline Flag Store — two IndexedDB object stores in the same DB used by the
 * offline scan queue:
 *
 *  "flag-cache"   — mirrors the server flags table; refreshed on every successful
 *                   online fetch so the dropdown is available when offline.
 *
 *  "flag-pending" — flags created by the user while offline; flushed to the
 *                   server on the next reconnect via syncFlags().
 */

const DB_NAME      = 'shayona-offline'
const CACHE_STORE  = 'flag-cache'
const PENDING_STORE = 'flag-pending'
// Keep in sync with offline-queue.ts — both share the same IDB database.
// Bumped to 3 to avoid VersionError for browsers that already have the DB at v3.
const VERSION = 3

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = (ev) => {
      const db = req.result
      // Existing store — must not be recreated
      if (!db.objectStoreNames.contains('pending-scans')) {
        db.createObjectStore('pending-scans', { keyPath: 'tempId' })
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'name' })
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'name' })
      }
      void ev
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ─── Cache store (DB → local) ─────────────────────────────────────────────────

/** Overwrite the local cache with the authoritative list from the server. */
export async function cacheFlags(names: string[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction([CACHE_STORE], 'readwrite')
    const store = tx.objectStore(CACHE_STORE)
    store.clear()
    for (const name of names) store.put({ name })
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

/** Read the cached flag list. Empty array if nothing cached yet. */
export async function getCachedFlags(): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction([CACHE_STORE], 'readonly')
    const req = tx.objectStore(CACHE_STORE).getAll()
    req.onsuccess = () => resolve((req.result as { name: string }[]).map((r) => r.name))
    req.onerror   = () => reject(req.error)
  })
}

// ─── Pending store (local → DB) ───────────────────────────────────────────────

/** Queue a flag to be created on the server when back online. No-op if already queued. */
export async function enqueuePendingFlag(name: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction([PENDING_STORE], 'readwrite')
    const req = tx.objectStore(PENDING_STORE).put({ name })
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

/** Return all flags waiting to be synced to the server. */
export async function getPendingFlags(): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction([PENDING_STORE], 'readonly')
    const req = tx.objectStore(PENDING_STORE).getAll()
    req.onsuccess = () => resolve((req.result as { name: string }[]).map((r) => r.name))
    req.onerror   = () => reject(req.error)
  })
}

/** Remove a flag from the pending store after it has been synced. */
export async function removePendingFlag(name: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction([PENDING_STORE], 'readwrite')
    const req = tx.objectStore(PENDING_STORE).delete(name)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}
