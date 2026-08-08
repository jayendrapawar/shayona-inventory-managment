'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans } from '@/lib/db/schema'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DUPLICATE_QR_ERROR } from '@/lib/errors'
import { parseQr } from '@/lib/qr-parser'

async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return { id: session.user.id, name: session.user.name ?? null }
}

export type RecordScanResult =
  | { ok: true; data: typeof scans.$inferSelect }
  | { ok: false; error: typeof DUPLICATE_QR_ERROR | 'ERROR' }

// Nullable-safe equality: uses IS NULL when value is absent, eq() otherwise
function colEq(col: Parameters<typeof eq>[0], val: string | undefined) {
  return val ? eq(col, val) : isNull(col)
}

export async function recordScan(rawQrCode: string): Promise<RecordScanResult> {
  const user = await getUser()
  const parsed = parseQr(rawQrCode)

  // Duplicate check — same Art + Color + Size already in scans
  const existing = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        colEq(scans.artNumber, parsed.articleCode),
        colEq(scans.colorNumber, parsed.colorCode),
        colEq(scans.sizeNumber, parsed.size)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    return { ok: false, error: DUPLICATE_QR_ERROR }
  }

  const rows = await db
    .insert(scans)
    .values({
      entryType: 'scan',
      rawQrCode,
      artNumber: parsed.articleCode || undefined,
      colorNumber: parsed.colorCode || undefined,
      sizeNumber: parsed.size || undefined,
      division: parsed.division || undefined,
      mrp: parsed.mrp ? String(parsed.mrp) : undefined,
      mfgMonth: parsed.mfgMonth || undefined,
      mfgYear: parsed.mfgYear || undefined,
      scannedByName: user.name ?? undefined,
      quantity: 1,
    })
    .returning()

  revalidatePath('/scanner')
  return { ok: true, data: rows[0] }
}

export async function getRecentScans(limit = 20) {
  return db
    .select()
    .from(scans)
    .where(eq(scans.entryType, 'scan'))
    .orderBy(desc(scans.scannedAt))
    .limit(limit)
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

export async function deleteScan(scanId: number) {
  await db.delete(scans).where(eq(scans.id, scanId))
  revalidatePath('/scanner')
  revalidatePath('/dashboard')
}

export async function getAllScans() {
  return db
    .select()
    .from(scans)
    .orderBy(desc(scans.createdAt))
}
