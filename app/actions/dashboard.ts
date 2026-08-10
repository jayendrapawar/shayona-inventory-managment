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
  const art      = artNumber.trim().toUpperCase()   || undefined
  const color    = colorNumber.trim().toUpperCase() || undefined
  const size     = sizeNumber.trim().toUpperCase()  || undefined
  const mrpStr   = mrp != null ? String(mrp) : undefined
  const divNorm  = division || undefined

  // Quantity-merge check — same Art+Color+Size+Division+MRP+MfgMonth+MfgYear → add quantity
  const matched = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        colEq(scans.artNumber,   art),
        colEq(scans.colorNumber, color),
        colEq(scans.sizeNumber,  size),
        colEq(scans.division,    divNorm),
        colEq(scans.mrp,         mrpStr),
        mfgMonth != null ? eq(scans.mfgMonth, mfgMonth) : isNull(scans.mfgMonth),
        mfgYear  != null ? eq(scans.mfgYear,  mfgYear)  : isNull(scans.mfgYear),
      )
    )
    .limit(1)

  if (matched.length > 0) {
    const rows = await db
      .update(scans)
      .set({ quantity: sql`${scans.quantity} + ${quantity}`, updatedAt: sql`now()` })
      .where(eq(scans.id, matched[0].id))
      .returning()

    revalidatePath('/dashboard')
    return { ok: true, data: rows[0] }
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
      mrp: mrpStr,
      division: divNorm,
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

// ---------------------------------------------------------------------------
// Chart data — Scanned Inventory (current user)
// ---------------------------------------------------------------------------

export interface ScansOverTimePoint {
  date: string       // 'MM/DD'
  scans: number
  quantity: number
}

export interface DivisionBreakdownItem {
  division: string
  quantity: number
}

export interface TopSKUItem {
  sku: string
  quantity: number
}

export interface EntryTypeItem {
  type: string
  count: number
}

export interface ScansByUserItem {
  user: string
  scans: number
  quantity: number
}

export async function getScannedChartData(): Promise<{
  scansOverTime: ScansOverTimePoint[]
  divisionBreakdown: DivisionBreakdownItem[]
  topSKUs: TopSKUItem[]
  entryTypeBreakdown: EntryTypeItem[]
}> {
  const user = await getUser()
  const scanData = await db
    .select()
    .from(scans)
    .where(eq(scans.scannedByName, user.name ?? ''))

  // Last 14 days
  const dayMap: Record<string, { scans: number; quantity: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    dayMap[key] = { scans: 0, quantity: 0 }
  }
  for (const scan of scanData) {
    const d = new Date(scan.scannedAt)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    if (key in dayMap) {
      dayMap[key].scans += 1
      dayMap[key].quantity += scan.quantity
    }
  }
  const scansOverTime: ScansOverTimePoint[] = Object.entries(dayMap).map(([date, v]) => ({
    date,
    scans: v.scans,
    quantity: v.quantity,
  }))

  // Division breakdown
  const divMap: Record<string, number> = {}
  for (const scan of scanData) {
    const div = scan.division || 'Unknown'
    divMap[div] = (divMap[div] ?? 0) + scan.quantity
  }
  const divisionBreakdown: DivisionBreakdownItem[] = Object.entries(divMap)
    .map(([division, quantity]) => ({ division, quantity }))
    .sort((a, b) => b.quantity - a.quantity)

  // Top SKUs
  const skuMap: Record<string, number> = {}
  for (const scan of scanData) {
    const key = [scan.artNumber, scan.colorNumber, scan.sizeNumber].filter(Boolean).join('-') || 'Unknown'
    skuMap[key] = (skuMap[key] ?? 0) + scan.quantity
  }
  const topSKUs: TopSKUItem[] = Object.entries(skuMap)
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  // Entry type breakdown
  const typeMap: Record<string, number> = {}
  for (const scan of scanData) {
    typeMap[scan.entryType] = (typeMap[scan.entryType] ?? 0) + 1
  }
  const entryTypeBreakdown: EntryTypeItem[] = Object.entries(typeMap).map(([type, count]) => ({ type, count }))

  return { scansOverTime, divisionBreakdown, topSKUs, entryTypeBreakdown }
}

// ---------------------------------------------------------------------------
// Chart data — Overall Stock (all users)
// ---------------------------------------------------------------------------

export async function getOverallChartData(): Promise<{
  scansOverTime: ScansOverTimePoint[]
  divisionBreakdown: DivisionBreakdownItem[]
  topSKUs: TopSKUItem[]
  entryTypeBreakdown: EntryTypeItem[]
  scansByUser: ScansByUserItem[]
}> {
  const allScans = await db.select().from(scans)

  const dayMap: Record<string, { scans: number; quantity: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    dayMap[key] = { scans: 0, quantity: 0 }
  }
  for (const scan of allScans) {
    const d = new Date(scan.scannedAt)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    if (key in dayMap) {
      dayMap[key].scans += 1
      dayMap[key].quantity += scan.quantity
    }
  }
  const scansOverTime: ScansOverTimePoint[] = Object.entries(dayMap).map(([date, v]) => ({
    date,
    scans: v.scans,
    quantity: v.quantity,
  }))

  const divMap: Record<string, number> = {}
  for (const scan of allScans) {
    const div = scan.division || 'Unknown'
    divMap[div] = (divMap[div] ?? 0) + scan.quantity
  }
  const divisionBreakdown: DivisionBreakdownItem[] = Object.entries(divMap)
    .map(([division, quantity]) => ({ division, quantity }))
    .sort((a, b) => b.quantity - a.quantity)

  const skuMap: Record<string, number> = {}
  for (const scan of allScans) {
    const key = [scan.artNumber, scan.colorNumber, scan.sizeNumber].filter(Boolean).join('-') || 'Unknown'
    skuMap[key] = (skuMap[key] ?? 0) + scan.quantity
  }
  const topSKUs: TopSKUItem[] = Object.entries(skuMap)
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  const typeMap: Record<string, number> = {}
  for (const scan of allScans) {
    typeMap[scan.entryType] = (typeMap[scan.entryType] ?? 0) + 1
  }
  const entryTypeBreakdown: EntryTypeItem[] = Object.entries(typeMap).map(([type, count]) => ({ type, count }))

  // Scans per user — total scans count + total quantity per scannedByName
  const userMap: Record<string, { scans: number; quantity: number }> = {}
  for (const scan of allScans) {
    const u = scan.scannedByName || 'Unknown'
    if (!userMap[u]) userMap[u] = { scans: 0, quantity: 0 }
    userMap[u].scans += 1
    userMap[u].quantity += scan.quantity
  }
  const scansByUser: ScansByUserItem[] = Object.entries(userMap)
    .map(([user, v]) => ({ user, scans: v.scans, quantity: v.quantity }))
    .sort((a, b) => b.scans - a.scans)

  return { scansOverTime, divisionBreakdown, topSKUs, entryTypeBreakdown, scansByUser }
}
