'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans } from '@/lib/db/schema'
import { and, eq, isNull, desc, sql, count, sum } from 'drizzle-orm'
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
  const user = await getUser()
  // Aggregate in SQL — one query, no JS reduce over unbounded rows
  const rows = await db
    .select({
      artNumber:     scans.artNumber,
      colorNumber:   scans.colorNumber,
      sizeNumber:    scans.sizeNumber,
      division:      scans.division,
      mrp:           scans.mrp,
      mfgMonth:      scans.mfgMonth,
      mfgYear:       scans.mfgYear,
      scannedByName: scans.scannedByName,
      entryType:     scans.entryType,
      quantity:      sql<number>`sum(${scans.quantity})::int`,
      count:         sql<number>`count(*)::int`,
      lastScanned:   sql<Date>`max(${scans.scannedAt})`,
    })
    .from(scans)
    .where(eq(scans.scannedByName, user.name ?? ''))
    .groupBy(
      scans.artNumber, scans.colorNumber, scans.sizeNumber,
      scans.division, scans.mrp, scans.mfgMonth, scans.mfgYear,
      scans.scannedByName, scans.entryType,
    )
    .orderBy(desc(sql`max(${scans.scannedAt})`))

  return rows.map((r) => ({
    ...r,
    mrp: r.mrp != null ? Number(r.mrp) : undefined,
    artNumber: r.artNumber ?? undefined,
    colorNumber: r.colorNumber ?? undefined,
    sizeNumber: r.sizeNumber ?? undefined,
    division: r.division ?? undefined,
    scannedByName: r.scannedByName ?? undefined,
    mfgMonth: r.mfgMonth ?? undefined,
    mfgYear: r.mfgYear ?? undefined,
  }))
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
  const user = await getUser()
  const name = user.name ?? ''
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [totals] = await db
    .select({
      totalScans:    sql<number>`count(*)::int`,
      totalItems:    sql<number>`sum(${scans.quantity})::int`,
      uniqueItems:   sql<number>`count(distinct (${scans.artNumber}, ${scans.colorNumber}, ${scans.sizeNumber}))::int`,
      scansLast24h:  sql<number>`count(*) filter (where ${scans.scannedAt} > ${oneDayAgo})::int`,
    })
    .from(scans)
    .where(eq(scans.scannedByName, name))

  return {
    totalScans:   totals?.totalScans   ?? 0,
    totalItems:   totals?.totalItems   ?? 0,
    uniqueItems:  totals?.uniqueItems  ?? 0,
    scansLast24h: totals?.scansLast24h ?? 0,
  }
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
  const rows = await db
    .select({
      artNumber:     scans.artNumber,
      colorNumber:   scans.colorNumber,
      sizeNumber:    scans.sizeNumber,
      division:      scans.division,
      mrp:           scans.mrp,
      mfgMonth:      scans.mfgMonth,
      mfgYear:       scans.mfgYear,
      scannedByName: scans.scannedByName,
      entryType:     scans.entryType,
      totalQuantity: sql<number>`sum(${scans.quantity})::int`,
      totalScans:    sql<number>`count(*)::int`,
      lastUpdated:   sql<Date>`max(${scans.scannedAt})`,
    })
    .from(scans)
    .groupBy(
      scans.artNumber, scans.colorNumber, scans.sizeNumber,
      scans.division, scans.mrp, scans.mfgMonth, scans.mfgYear,
      scans.scannedByName, scans.entryType,
    )
    .orderBy(desc(sql`max(${scans.scannedAt})`))

  return rows.map((r) => ({
    artNumber:     r.artNumber ?? undefined,
    colorNumber:   r.colorNumber ?? undefined,
    sizeNumber:    r.sizeNumber ?? undefined,
    division:      r.division ?? undefined,
    mrp:           r.mrp != null ? Number(r.mrp) : undefined,
    mfgMonth:      r.mfgMonth ?? undefined,
    mfgYear:       r.mfgYear ?? undefined,
    scannedByName: r.scannedByName ?? undefined,
    entryType:     r.entryType,
    totalQuantity: r.totalQuantity,
    totalScans:    r.totalScans,
    lastUpdated:   r.lastUpdated,
  }))
}

export async function getOverallStockStats(): Promise<OverallStockStats> {
  // Compute per-SKU totals in a CTE, then aggregate the outer stats in one query
  const result = await db.execute<{
    total_stock_items: string
    unique_sk_us: string
    total_locations: string
    low_stock_items: string
  }>(sql`
    WITH sku_totals AS (
      SELECT
        coalesce("artNumber", '') || '-' || coalesce("colorNumber", '') || '-' || coalesce("sizeNumber", '') AS sku,
        sum("quantity")::int AS qty
      FROM "scans"
      GROUP BY "artNumber", "colorNumber", "sizeNumber"
    )
    SELECT
      (SELECT sum("quantity")::int FROM "scans")                          AS total_stock_items,
      count(*)::int                                                        AS unique_sk_us,
      (SELECT count(distinct "scannedByName")::int FROM "scans")          AS total_locations,
      count(*) filter (where qty <= 5)::int                               AS low_stock_items
    FROM sku_totals
  `)

  const row = result.rows?.[0]
  return {
    totalStockItems: Number(row?.total_stock_items ?? 0),
    uniqueSKUs:      Number(row?.unique_sk_us      ?? 0),
    totalLocations:  Number(row?.total_locations   ?? 0),
    lowStockItems:   Number(row?.low_stock_items   ?? 0),
  }
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
  const name = user.name ?? ''
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const [timeRows, divRows, skuRows, typeRows] = await Promise.all([
    // Scans over time — grouped by calendar day
    db.select({
      day:      sql<string>`to_char(${scans.scannedAt}, 'MM/DD')`,
      scans:    sql<number>`count(*)::int`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .where(and(eq(scans.scannedByName, name), sql`${scans.scannedAt} >= ${fourteenDaysAgo}`))
      .groupBy(sql`to_char(${scans.scannedAt}, 'MM/DD')`)
      .orderBy(sql`to_char(${scans.scannedAt}, 'MM/DD')`),

    // Division breakdown
    db.select({
      division: sql<string>`coalesce(${scans.division}, 'Unknown')`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .where(eq(scans.scannedByName, name))
      .groupBy(sql`coalesce(${scans.division}, 'Unknown')`)
      .orderBy(desc(sql`sum(${scans.quantity})`)),

    // Top SKUs
    db.select({
      sku:      sql<string>`coalesce(${scans.artNumber} || '-' || ${scans.colorNumber} || '-' || ${scans.sizeNumber}, 'Unknown')`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .where(eq(scans.scannedByName, name))
      .groupBy(scans.artNumber, scans.colorNumber, scans.sizeNumber)
      .orderBy(desc(sql`sum(${scans.quantity})`))
      .limit(10),

    // Entry type breakdown
    db.select({
      type:  scans.entryType,
      count: sql<number>`count(*)::int`,
    }).from(scans)
      .where(eq(scans.scannedByName, name))
      .groupBy(scans.entryType),
  ])

  // Build a full 14-day skeleton and fill in DB results
  const dayMap: Record<string, { scans: number; quantity: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    dayMap[key] = { scans: 0, quantity: 0 }
  }
  for (const r of timeRows) {
    if (r.day in dayMap) { dayMap[r.day].scans = r.scans; dayMap[r.day].quantity = r.quantity }
  }

  return {
    scansOverTime:      Object.entries(dayMap).map(([date, v]) => ({ date, scans: v.scans, quantity: v.quantity })),
    divisionBreakdown:  divRows.map((r) => ({ division: r.division, quantity: r.quantity })),
    topSKUs:            skuRows.map((r) => ({ sku: r.sku, quantity: r.quantity })),
    entryTypeBreakdown: typeRows.map((r) => ({ type: r.type, count: r.count })),
  }
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
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  const [timeRows, divRows, skuRows, typeRows, userRows] = await Promise.all([
    db.select({
      day:      sql<string>`to_char(${scans.scannedAt}, 'MM/DD')`,
      scans:    sql<number>`count(*)::int`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .where(sql`${scans.scannedAt} >= ${fourteenDaysAgo}`)
      .groupBy(sql`to_char(${scans.scannedAt}, 'MM/DD')`)
      .orderBy(sql`to_char(${scans.scannedAt}, 'MM/DD')`),

    db.select({
      division: sql<string>`coalesce(${scans.division}, 'Unknown')`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .groupBy(sql`coalesce(${scans.division}, 'Unknown')`)
      .orderBy(desc(sql`sum(${scans.quantity})`)),

    db.select({
      sku:      sql<string>`coalesce(${scans.artNumber} || '-' || ${scans.colorNumber} || '-' || ${scans.sizeNumber}, 'Unknown')`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .groupBy(scans.artNumber, scans.colorNumber, scans.sizeNumber)
      .orderBy(desc(sql`sum(${scans.quantity})`))
      .limit(10),

    db.select({
      type:  scans.entryType,
      count: sql<number>`count(*)::int`,
    }).from(scans).groupBy(scans.entryType),

    db.select({
      user:     sql<string>`coalesce(${scans.scannedByName}, 'Unknown')`,
      scans:    sql<number>`count(*)::int`,
      quantity: sql<number>`sum(${scans.quantity})::int`,
    }).from(scans)
      .groupBy(sql`coalesce(${scans.scannedByName}, 'Unknown')`)
      .orderBy(desc(sql`count(*)`)),
  ])

  const dayMap: Record<string, { scans: number; quantity: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    dayMap[key] = { scans: 0, quantity: 0 }
  }
  for (const r of timeRows) {
    if (r.day in dayMap) { dayMap[r.day].scans = r.scans; dayMap[r.day].quantity = r.quantity }
  }

  return {
    scansOverTime:      Object.entries(dayMap).map(([date, v]) => ({ date, scans: v.scans, quantity: v.quantity })),
    divisionBreakdown:  divRows,
    topSKUs:            skuRows,
    entryTypeBreakdown: typeRows,
    scansByUser:        userRows,
  }
}
