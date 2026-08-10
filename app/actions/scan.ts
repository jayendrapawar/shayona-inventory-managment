'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans } from '@/lib/db/schema'
import { and, eq, isNull, desc, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DUPLICATE_QR_ERROR, INVALID_QR_ERROR } from '@/lib/errors'
import { parseQr, isValidWarehouseQr } from '@/lib/qr-parser'

async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return { id: session.user.id, name: session.user.name ?? null }
}

// Returns the current logged-in user's display name — used by the scanner header
export async function getCurrentUserName(): Promise<string | null> {
  const user = await getUser()
  return user.name
}

export type RecordScanResult =
  | { ok: true; data: typeof scans.$inferSelect }
  | { ok: false; error: typeof DUPLICATE_QR_ERROR | typeof INVALID_QR_ERROR | 'ERROR'; scannedByName?: string | null }

// Nullable-safe equality: uses IS NULL when value is absent, eq() otherwise
function colEq(col: Parameters<typeof eq>[0], val: string | undefined) {
  return val ? eq(col, val) : isNull(col)
}

export async function recordScan(rawQrCode: string): Promise<RecordScanResult> {
  // Reject before any DB call if QR doesn't match warehouse format
  if (!isValidWarehouseQr(rawQrCode)) {
    return { ok: false, error: INVALID_QR_ERROR }
  }

  const user = await getUser()
  const parsed = parseQr(rawQrCode)

  // Duplicate check — same box code already scanned (stored in rawQrCode of first-box rows
  // or in the boxCodes jsonb array for merged rows)
  const existing = await db
    .select({ id: scans.id, scannedByName: scans.scannedByName })
    .from(scans)
    .where(
      sql`${scans.rawQrCode} = ${rawQrCode}
          OR ${scans.boxCodes} @> ${JSON.stringify([rawQrCode])}::jsonb`
    )
    .limit(1)

  if (existing.length > 0) {
    return { ok: false, error: DUPLICATE_QR_ERROR, scannedByName: existing[0].scannedByName }
  }

  // Quantity-merge check — same Art+Color+Size+Division+MRP+MfgMonth+MfgYear → increment
  const artNumber    = parsed.articleCode || undefined
  const colorNumber  = parsed.colorCode   || undefined
  const sizeNumber   = parsed.size        || undefined
  const division     = parsed.division    || undefined
  const mrp          = parsed.mrp ? String(parsed.mrp) : undefined
  const mfgMonth     = parsed.mfgMonth    || undefined
  const mfgYear      = parsed.mfgYear     || undefined

  const matched = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        colEq(scans.artNumber,   artNumber),
        colEq(scans.colorNumber, colorNumber),
        colEq(scans.sizeNumber,  sizeNumber),
        colEq(scans.division,    division),
        colEq(scans.mrp,         mrp),
        mfgMonth !== undefined ? eq(scans.mfgMonth, mfgMonth) : isNull(scans.mfgMonth),
        mfgYear  !== undefined ? eq(scans.mfgYear,  mfgYear)  : isNull(scans.mfgYear),
      )
    )
    .limit(1)

  if (matched.length > 0) {
    const rows = await db
      .update(scans)
      .set({
        quantity:  sql`${scans.quantity} + 1`,
        boxCodes:  sql`COALESCE(${scans.boxCodes}, '[]'::jsonb) || ${JSON.stringify([rawQrCode])}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(eq(scans.id, matched[0].id))
      .returning()

    revalidatePath('/scanner')
    return { ok: true, data: rows[0] }
  }

  const rows = await db
    .insert(scans)
    .values({
      entryType: 'scan',
      rawQrCode,
      boxCodes:  [rawQrCode],
      artNumber,
      colorNumber,
      sizeNumber,
      division,
      mrp,
      mfgMonth,
      mfgYear,
      scannedByName: user.name ?? undefined,
      quantity: 1,
    })
    .returning()

  revalidatePath('/scanner')
  return { ok: true, data: rows[0] }
}

// Last 50 box-level entries for the logged-in user, newest first.
// Each camera-scan row is expanded into one virtual entry per boxCode so the
// caller sees individual boxes (qty=1 each) rather than merged SKU totals.
// Manual entries (no boxCodes) appear as a single entry with their set quantity.
export async function getRecentScans(limit = 50) {
  const user = await getUser()

  // Fetch more rows than needed so expansion still yields enough after slicing
  const dbRows = await db
    .select()
    .from(scans)
    .where(eq(scans.scannedByName, user.name ?? ''))
    .orderBy(desc(scans.scannedAt))
    .limit(limit * 4)

  type ScanRow = typeof scans.$inferSelect

  const expanded: Array<ScanRow & { _boxCode?: string }> = []

  for (const row of dbRows) {
    const codes: string[] = Array.isArray(row.boxCodes) && row.boxCodes.length > 0
      ? (row.boxCodes as string[])
      : row.rawQrCode ? [row.rawQrCode] : []

    if (codes.length > 0) {
      // One virtual entry per box, newest box first
      for (let i = codes.length - 1; i >= 0; i--) {
        expanded.push({ ...row, quantity: 1, rawQrCode: codes[i], _boxCode: codes[i] })
        if (expanded.length >= limit) break
      }
    } else {
      // Manual entry — show as-is
      expanded.push(row)
    }
    if (expanded.length >= limit) break
  }

  return expanded.slice(0, limit)
}

export async function updateScanQuantity(scanId: number, quantity: number) {
  const result = await db
    .update(scans)
    .set({ quantity })
    .where(eq(scans.id, scanId))
    .returning()

  revalidatePath('/scanner')
  revalidatePath('/dashboard')
  return result[0]
}

// Decrements quantity by 1 for the given row, removing boxCode from the
// boxCodes array when provided. Deletes the row entirely when quantity hits 0.
// Returns the updated row, or null if the row was deleted.
export async function deleteScan(
  scanId: number,
  boxCode?: string,
): Promise<typeof scans.$inferSelect | null> {
  const rows = await db
    .select({ id: scans.id, quantity: scans.quantity })
    .from(scans)
    .where(eq(scans.id, scanId))
    .limit(1)

  if (rows.length === 0) return null

  const { id, quantity } = rows[0]

  if (quantity <= 1) {
    await db.delete(scans).where(eq(scans.id, id))
    revalidatePath('/scanner')
    revalidatePath('/dashboard')
    return null
  }

  const updated = await db
    .update(scans)
    .set({
      quantity:  sql`${scans.quantity} - 1`,
      // Remove the specific boxCode from the array if provided
      ...(boxCode
        ? { boxCodes: sql`(SELECT jsonb_agg(v) FROM jsonb_array_elements_text(COALESCE(${scans.boxCodes}, '[]'::jsonb)) v WHERE v != ${boxCode})` }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(scans.id, id))
    .returning()

  revalidatePath('/scanner')
  revalidatePath('/dashboard')
  return updated[0]
}

export async function getAllScans() {
  return db
    .select()
    .from(scans)
    .orderBy(desc(scans.createdAt))
}
