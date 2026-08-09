'use client'

/**
 * Sync Engine — flushes the offline IndexedDB queue to the server
 * by calling the same server actions the scanner page uses online.
 *
 * Rules:
 *  - Pending/syncing items are attempted.
 *  - Server duplicate → kept with status 'error' for user review.
 *  - Transient network failure → reset to 'pending' for next retry.
 *  - Items already in 'error' state are NOT retried automatically
 *    (they need user action: dismiss or they stay visible).
 */

import { getQueue, removeFromQueue, updateEntry, type OfflineEntry } from './offline-queue'
import { recordScan }     from '@/app/actions/scan'
import { addManualEntry } from '@/app/actions/dashboard'
import { DUPLICATE_QR_ERROR, DUPLICATE_ENTRY_ERROR } from './errors'

export interface SyncResult {
  synced:     number   // successfully written to DB
  duplicates: number   // server rejected as duplicate
  errors:     number   // transient failures (will retry next time)
}

/**
 * Attempt to flush every pending item in the queue.
 * Returns a summary of what happened.
 */
export async function syncQueue(): Promise<SyncResult> {
  const queue   = await getQueue()
  const pending = queue.filter((e) => e.status === 'pending' || e.status === 'syncing')

  const result: SyncResult = { synced: 0, duplicates: 0, errors: 0 }

  for (const entry of pending) {
    await updateEntry(entry.tempId, { status: 'syncing' })

    try {
      const outcome = await trySyncEntry(entry)

      if (outcome === 'success') {
        await removeFromQueue(entry.tempId)
        result.synced++
      } else if (outcome === 'duplicate') {
        await updateEntry(entry.tempId, {
          status:       'error',
          errorMessage: 'Duplicate — this item already exists in the database.',
        })
        result.duplicates++
      } else {
        // transient — reset so next sync retries
        await updateEntry(entry.tempId, { status: 'pending', errorMessage: outcome })
        result.errors++
      }
    } catch (err) {
      await updateEntry(entry.tempId, {
        status:       'pending',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      })
      result.errors++
    }
  }

  return result
}

/** Returns 'success' | 'duplicate' | error-message-string */
async function trySyncEntry(entry: OfflineEntry): Promise<'success' | 'duplicate' | string> {
  if (entry.entryType === 'scan' && entry.rawQrCode) {
    const res = await recordScan(entry.rawQrCode)
    if (res.ok)                           return 'success'
    if (res.error === DUPLICATE_QR_ERROR) return 'duplicate'
    return 'ERROR'
  }

  // manual entry
  const res = await addManualEntry(
    entry.artNumber,
    entry.colorNumber,
    entry.sizeNumber,
    entry.quantity,
    entry.notes,
    entry.mrp,
  )
  if (res.ok)                                return 'success'
  if (res.error === DUPLICATE_ENTRY_ERROR)   return 'duplicate'
  return 'ERROR'
}
