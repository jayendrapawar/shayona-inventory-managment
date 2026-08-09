/**
 * Offline Queue — IndexedDB-backed store for scans captured without internet.
 *
 * Shape of a queued item mirrors the fields needed for both
 * recordScan() (camera/upload) and addManualEntry() (manual form).
 */

export type OfflineEntryType = 'scan' | 'manual'
export type OfflineStatus    = 'pending' | 'syncing' | 'error'

export interface OfflineEntry {
  tempId:       string              // client-only UUID; never reaches the server
  entryType:    OfflineEntryType
  // scan-only
  rawQrCode?:   string
  // parsed / manual fields
  artNumber:    string
  colorNumber:  string
  sizeNumber:   string
  division?:    string
  mrp?:         number
  mfgMonth?:    number
  mfgYear?:     number
  quantity:     number
  notes?:       string
  // meta
  scannedByName: string             // persisted from session so sync labels rows correctly
  savedAt:       number             // Date.now()
  status:        OfflineStatus
  errorMessage?: string             // populated when status === 'error'
}

// ─── DB bootstrap ────────────────────────────────────────────────────────────

const DB_NAME = 'shayona-offline'
const STORE   = 'pending-scans'
const VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'tempId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Add a new pending entry to the queue. */
export async function enqueue(entry: OfflineEntry): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(entry)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

/** Return all queued entries, oldest first. */
export async function getQueue(): Promise<OfflineEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () =>
      resolve((req.result as OfflineEntry[]).sort((a, b) => a.savedAt - b.savedAt))
    req.onerror = () => reject(req.error)
  })
}

/** Remove a successfully synced entry by its tempId. */
export async function removeFromQueue(tempId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(tempId)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

/** Update status / errorMessage on an existing entry. */
export async function updateEntry(
  tempId: string,
  patch: Partial<Pick<OfflineEntry, 'status' | 'errorMessage'>>,
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const get   = store.get(tempId)
    get.onsuccess = () => {
      if (!get.result) { resolve(); return }
      const put = store.put({ ...get.result, ...patch })
      put.onsuccess = () => resolve()
      put.onerror   = () => reject(put.error)
    }
    get.onerror = () => reject(get.error)
  })
}

/** Count items that still need syncing (pending or syncing). */
export async function getPendingCount(): Promise<number> {
  const queue = await getQueue()
  return queue.filter((e) => e.status === 'pending' || e.status === 'syncing').length
}
