'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans, manualEntries } from '@/lib/db/schema'
import { and, eq, isNull, desc, sql } from 'drizzle-orm'
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
          artNumber: scan.artNumber ?? undefined,
          colorNumber: scan.colorNumber ?? undefined,
          sizeNumber: scan.sizeNumber ?? undefined,
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

// ---------------------------------------------------------------------------
// Overall Stock — aggregated across ALL users
// ---------------------------------------------------------------------------

export interface OverallStockItem {
  artNumber: string | undefined
  colorNumber: string | undefined
  sizeNumber: string | undefined
  totalQuantity: number
  totalScans: number
  lastUpdated: Date
}

export interface OverallStockStats {
  totalStockItems: number   // total units across all users
  uniqueSKUs: number        // distinct (art, color, size) combinations
  totalLocations: number    // distinct users who have scanned
  lowStockItems: number     // SKUs whose total quantity ≤ 5
}

export async function getOverallStockSummary(): Promise<OverallStockItem[]> {
  // Auth check — user must be logged in to view overall stock
  await getUserId()

  const allScans = await db.select().from(scans)

  const map: Record<string, OverallStockItem> = {}
  for (const scan of allScans) {
    const key = `${scan.artNumber ?? ''}-${scan.colorNumber ?? ''}-${scan.sizeNumber ?? ''}`
    if (!map[key]) {
      map[key] = {
        artNumber: scan.artNumber ?? undefined,
        colorNumber: scan.colorNumber ?? undefined,
        sizeNumber: scan.sizeNumber ?? undefined,
        totalQuantity: 0,
        totalScans: 0,
        lastUpdated: scan.scannedAt,
      }
    }
    map[key].totalQuantity += scan.quantity
    map[key].totalScans += 1
    if (scan.scannedAt > map[key].lastUpdated) {
      map[key].lastUpdated = scan.scannedAt
    }
  }

  return Object.values(map)
}

export async function getOverallStockStats(): Promise<OverallStockStats> {
  await getUserId()

  const allScans = await db.select().from(scans)

  const skuMap: Record<string, { quantity: number }> = {}
  const userSet = new Set<string>()

  for (const scan of allScans) {
    const key = `${scan.artNumber ?? ''}-${scan.colorNumber ?? ''}-${scan.sizeNumber ?? ''}`
    if (!skuMap[key]) skuMap[key] = { quantity: 0 }
    skuMap[key].quantity += scan.quantity
    userSet.add(scan.userId)
  }

  const totalStockItems = Object.values(skuMap).reduce((s, v) => s + v.quantity, 0)
  const uniqueSKUs = Object.keys(skuMap).length
  const totalLocations = userSet.size
  const lowStockItems = Object.values(skuMap).filter((v) => v.quantity <= 5).length

  return { totalStockItems, uniqueSKUs, totalLocations, lowStockItems }
}

export async function exportOverallStockToCSV(): Promise<Record<string, string | number>[]> {
  await getUserId()

  const allScans = await db.select().from(scans).orderBy(desc(scans.createdAt))

  return allScans.map((scan) => ({
    'Art Number': scan.artNumber ?? '',
    'Color Number': scan.colorNumber ?? '',
    'Size Number': scan.sizeNumber ?? '',
    Quantity: scan.quantity,
    'User ID': scan.userId,
    'Scanned At': scan.scannedAt.toISOString(),
  }))
}
