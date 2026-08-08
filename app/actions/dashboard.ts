'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans, manualEntries } from '@/lib/db/schema'
import { and, eq, isNull, desc, ilike, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DUPLICATE_ENTRY_ERROR } from '@/lib/errors'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function searchInventory(query: string) {
  const userId = await getUserId()

  if (!query.trim()) {
    return db
      .select()
      .from(scans)
      .where(eq(scans.userId, userId))
      .orderBy(desc(scans.createdAt))
  }

  const q = `%${query.trim()}%`
  return db
    .select()
    .from(scans)
    .where(
      and(
        eq(scans.userId, userId),
        sql`(
          ${scans.artNumber} ILIKE ${q} OR
          ${scans.colorNumber} ILIKE ${q} OR
          ${scans.sizeNumber} ILIKE ${q}
        )`
      )
    )
    .orderBy(desc(scans.createdAt))
}

export async function getInventorySummary() {
  const userId = await getUserId()

  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.userId, userId))

  // Group and aggregate
  const summary = scanData.reduce(
    (acc, scan) => {
      const key = `${scan.artNumber}-${scan.colorNumber}-${scan.sizeNumber}`
      if (!acc[key]) {
        acc[key] = {
          artNumber: scan.artNumber,
          colorNumber: scan.colorNumber,
          sizeNumber: scan.sizeNumber,
          quantity: 0,
          lastScanned: scan.scannedAt,
          count: 0,
        }
      }
      acc[key].quantity += scan.quantity
      acc[key].count += 1
      if (scan.scannedAt > acc[key].lastScanned) {
        acc[key].lastScanned = scan.scannedAt
      }
      return acc
    },
    {} as Record<
      string,
      {
        artNumber?: string
        colorNumber?: string
        sizeNumber?: string
        quantity: number
        lastScanned: Date
        count: number
      }
    >
  )

  return Object.values(summary)
}

export type AddManualEntryResult =
  | { ok: true; data: typeof manualEntries.$inferSelect }
  | { ok: false; error: typeof DUPLICATE_ENTRY_ERROR | 'ERROR' }

// Nullable-safe equality helper (mirrors the one in scan.ts)
function colEq(col: Parameters<typeof eq>[0], val: string | undefined) {
  return val ? eq(col, val) : isNull(col)
}

export async function addManualEntry(
  artNumber: string,
  colorNumber: string,
  sizeNumber: string,
  quantity: number,
  notes?: string
): Promise<AddManualEntryResult> {
  const userId = await getUserId()

  // Normalize inputs the same way QR codes are — trim + uppercase
  const art = artNumber.trim().toUpperCase() || undefined
  const color = colorNumber.trim().toUpperCase() || undefined
  const size = sizeNumber.trim().toUpperCase() || undefined

  // Check for duplicate across both scans and manual_entries tables
  const [existingInScans, existingInManual] = await Promise.all([
    db
      .select({ id: scans.id })
      .from(scans)
      .where(
        and(
          eq(scans.userId, userId),
          colEq(scans.artNumber, art),
          colEq(scans.colorNumber, color),
          colEq(scans.sizeNumber, size)
        )
      )
      .limit(1),
    db
      .select({ id: manualEntries.id })
      .from(manualEntries)
      .where(
        and(
          eq(manualEntries.userId, userId),
          colEq(manualEntries.artNumber, art),
          colEq(manualEntries.colorNumber, color),
          colEq(manualEntries.sizeNumber, size)
        )
      )
      .limit(1),
  ])

  if (existingInScans.length > 0 || existingInManual.length > 0) {
    return { ok: false, error: DUPLICATE_ENTRY_ERROR }
  }

  const rows = await db
    .insert(manualEntries)
    .values({
      userId,
      artNumber: art ?? artNumber,
      colorNumber: color ?? colorNumber,
      sizeNumber: size ?? sizeNumber,
      quantity,
      notes,
    })
    .returning()

  revalidatePath('/dashboard')
  return { ok: true, data: rows[0] }
}

export async function getManualEntries() {
  const userId = await getUserId()
  return db
    .select()
    .from(manualEntries)
    .where(eq(manualEntries.userId, userId))
    .orderBy(desc(manualEntries.createdAt))
}

export async function deleteManualEntry(entryId: number) {
  const userId = await getUserId()
  await db
    .delete(manualEntries)
    .where(and(eq(manualEntries.id, entryId), eq(manualEntries.userId, userId)))

  revalidatePath('/dashboard')
}

export async function exportToExcel() {
  const userId = await getUserId()

  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.userId, userId))
    .orderBy(desc(scans.createdAt))

  // Prepare data for export
  const rows = scanData.map((scan) => ({
    'Art Number': scan.artNumber || '',
    'Color Number': scan.colorNumber || '',
    'Size Number': scan.sizeNumber || '',
    Quantity: scan.quantity,
    'Scanned At': scan.scannedAt.toISOString(),
    'Raw QR': scan.rawQrCode,
  }))

  return rows
}

export async function getStatistics() {
  const userId = await getUserId()

  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.userId, userId))

  const totalScans = scanData.length
  const totalItems = scanData.reduce((sum, scan) => sum + scan.quantity, 0)
  const uniqueItems = new Set(
    scanData.map((s) => `${s.artNumber}-${s.colorNumber}-${s.sizeNumber}`)
  ).size

  // Get scans from last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scansLast24h = scanData.filter((s) => new Date(s.scannedAt) > oneDayAgo).length

  return {
    totalScans,
    totalItems,
    uniqueItems,
    scansLast24h,
  }
}
