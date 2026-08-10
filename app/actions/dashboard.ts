'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans } from '@/lib/db/schema'
import { and, eq, isNull, desc, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DUPLICATE_ENTRY_ERROR } from '@/lib/errors'

async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return { id: session.user.id, name: session.user.name ?? null }
}

// Returns the current logged-in user's display name — used by the dashboard header
export async function getLoggedInUserName(): Promise<string | null> {
  const user = await getUser()
  return user.name
}

export async function searchInventory(query: string) {
  if (!query.trim()) {
    return db.select().from(scans).orderBy(desc(scans.createdAt))
  }

  const q = `%${query.trim()}%`
  return db
    .select()
    .from(scans)
    .where(
      sql`(
        ${scans.artNumber} ILIKE ${q} OR
        ${scans.colorNumber} ILIKE ${q} OR
        ${scans.sizeNumber} ILIKE ${q}
      )`
    )
    .orderBy(desc(scans.createdAt))
}

export async function getInventorySummary() {
  // Scanned tab shows only the current user's scans
  const user = await getUser()

  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.scannedByName, user.name ?? ''))

  // Group and aggregate; new fields taken from the first scan for each SKU key
  const summary = scanData.reduce(
    (acc, scan) => {
      const key = `${scan.artNumber}-${scan.colorNumber}-${scan.sizeNumber}`
      if (!acc[key]) {
        acc[key] = {
          artNumber: scan.artNumber ?? undefined,
          colorNumber: scan.colorNumber ?? undefined,
          sizeNumber: scan.sizeNumber ?? undefined,
          division: scan.division ?? undefined,
          mrp: scan.mrp != null ? Number(scan.mrp) : undefined,
          mfgMonth: scan.mfgMonth ?? undefined,
          mfgYear: scan.mfgYear ?? undefined,
          scannedByName: scan.scannedByName ?? undefined,
          entryType: scan.entryType,
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
        division?: string
        mrp?: number
        mfgMonth?: number
        mfgYear?: number
        scannedByName?: string
        entryType: string
        quantity: number
        lastScanned: Date
        count: number
      }
    >
  )

  return Object.values(summary)
}

export type AddManualEntryResult =
  | { ok: true; data: typeof scans.$inferSelect }
  | { ok: false; error: typeof DUPLICATE_ENTRY_ERROR | 'ERROR'; scannedByName?: string | null }

// Nullable-safe equality helper
function colEq(col: Parameters<typeof eq>[0], val: string | undefined) {
  return val ? eq(col, val) : isNull(col)
}

export async function addManualEntry(
  artNumber: string,
  colorNumber: string,
  sizeNumber: string,
  quantity: number,
  notes?: string,
  mrp?: number,
  division?: string,
  mfgMonth?: number,
  mfgYear?: number,
): Promise<AddManualEntryResult> {
  const user = await getUser()

  // Normalize inputs
  const art = artNumber.trim().toUpperCase() || undefined
  const color = colorNumber.trim().toUpperCase() || undefined
  const size = sizeNumber.trim().toUpperCase() || undefined

  // Duplicate check — same Art + Color + Size anywhere in scans
  const existing = await db
    .select({ id: scans.id, scannedByName: scans.scannedByName })
    .from(scans)
    .where(
      and(
        colEq(scans.artNumber, art),
        colEq(scans.colorNumber, color),
        colEq(scans.sizeNumber, size)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    return { ok: false, error: DUPLICATE_ENTRY_ERROR, scannedByName: existing[0].scannedByName }
  }

  const rows = await db
    .insert(scans)
    .values({
      entryType: 'manual',
      artNumber: art ?? artNumber,
      colorNumber: color ?? colorNumber,
      sizeNumber: size ?? sizeNumber,
      scannedByName: user.name ?? undefined,
      notes,
      quantity,
      mrp: mrp != null ? String(mrp) : undefined,
      division: division || undefined,
      mfgMonth: mfgMonth ?? undefined,
      mfgYear: mfgYear ?? undefined,
    })
    .returning()

  revalidatePath('/dashboard')
  return { ok: true, data: rows[0] }
}

export async function getStatistics() {
  // Stats scoped to the logged-in user only (Scanned Inventory tab)
  const user = await getUser()
  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.scannedByName, user.name ?? ''))

  const totalScans = scanData.length
  const totalItems = scanData.reduce((sum, scan) => sum + scan.quantity, 0)
  const uniqueItems = new Set(
    scanData.map((s) => `${s.artNumber}-${s.colorNumber}-${s.sizeNumber}`)
  ).size

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scansLast24h = scanData.filter((s) => new Date(s.scannedAt) > oneDayAgo).length

  return { totalScans, totalItems, uniqueItems, scansLast24h }
}

// ---------------------------------------------------------------------------
// Overall Stock — aggregated across ALL entries (scan + manual)
// ---------------------------------------------------------------------------

export interface OverallStockItem {
  artNumber: string | undefined
  colorNumber: string | undefined
  sizeNumber: string | undefined
  division: string | undefined
  mrp: number | undefined
  mfgMonth: number | undefined
  mfgYear: number | undefined
  scannedByName: string | undefined
  entryType: string
  totalQuantity: number
  totalScans: number
  lastUpdated: Date
}

export interface OverallStockStats {
  totalStockItems: number   // total units across all entries
  uniqueSKUs: number        // distinct (art, color, size) combinations
  totalLocations: number    // distinct scannedByName values
  lowStockItems: number     // SKUs whose total quantity ≤ 5
}

export async function getOverallStockSummary(): Promise<OverallStockItem[]> {
  const allScans = await db.select().from(scans)

  const map: Record<string, OverallStockItem> = {}
  for (const scan of allScans) {
    const key = `${scan.artNumber ?? ''}-${scan.colorNumber ?? ''}-${scan.sizeNumber ?? ''}`
    if (!map[key]) {
      map[key] = {
        artNumber: scan.artNumber ?? undefined,
        colorNumber: scan.colorNumber ?? undefined,
        sizeNumber: scan.sizeNumber ?? undefined,
        division: scan.division ?? undefined,
        mrp: scan.mrp != null ? Number(scan.mrp) : undefined,
        mfgMonth: scan.mfgMonth ?? undefined,
        mfgYear: scan.mfgYear ?? undefined,
        scannedByName: scan.scannedByName ?? undefined,
        entryType: scan.entryType,
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
  const allScans = await db.select().from(scans)

  const skuMap: Record<string, { quantity: number }> = {}
  const nameSet = new Set<string>()

  for (const scan of allScans) {
    const key = `${scan.artNumber ?? ''}-${scan.colorNumber ?? ''}-${scan.sizeNumber ?? ''}`
    if (!skuMap[key]) skuMap[key] = { quantity: 0 }
    skuMap[key].quantity += scan.quantity
    if (scan.scannedByName) nameSet.add(scan.scannedByName)
  }

  const totalStockItems = Object.values(skuMap).reduce((s, v) => s + v.quantity, 0)
  const uniqueSKUs = Object.keys(skuMap).length
  const totalLocations = nameSet.size
  const lowStockItems = Object.values(skuMap).filter((v) => v.quantity <= 5).length

  return { totalStockItems, uniqueSKUs, totalLocations, lowStockItems }
}

export async function exportToExcel(): Promise<Record<string, string | number>[]> {
  // Scoped to the logged-in user only (matches the Scanned Inventory tab)
  const user = await getUser()
  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.scannedByName, user.name ?? ''))
    .orderBy(desc(scans.createdAt))

  return scanData.map((scan) => ({
    'Entry Type': scan.entryType,
    'Art Number': scan.artNumber ?? '',
    'Color Number': scan.colorNumber ?? '',
    'Size Number': scan.sizeNumber ?? '',
    Division: scan.division ?? '',
    MRP: scan.mrp != null ? Number(scan.mrp) : '',
    'Mfg Month': scan.mfgMonth ?? '',
    'Mfg Year': scan.mfgYear ?? '',
    'Scanned By': scan.scannedByName ?? '',
    Quantity: scan.quantity,
    'Scanned At': scan.scannedAt.toISOString(),
    'Raw QR': scan.rawQrCode ?? '',
  }))
}

export async function exportOverallStockToCSV(): Promise<Record<string, string | number>[]> {
  const allScans = await db.select().from(scans).orderBy(desc(scans.createdAt))

  return allScans.map((scan) => ({
    'Entry Type': scan.entryType,
    'Art Number': scan.artNumber ?? '',
    'Color Number': scan.colorNumber ?? '',
    'Size Number': scan.sizeNumber ?? '',
    Division: scan.division ?? '',
    MRP: scan.mrp != null ? Number(scan.mrp) : '',
    'Mfg Month': scan.mfgMonth ?? '',
    'Mfg Year': scan.mfgYear ?? '',
    'Scanned By': scan.scannedByName ?? '',
    Quantity: scan.quantity,
    'Scanned At': scan.scannedAt.toISOString(),
  }))
}
