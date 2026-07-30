'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans, manualEntries, user as userTable } from '@/lib/db/schema'
import { and, eq, desc, ilike, gte } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session
}

async function getUserId() {
  const session = await getSession()
  return session.user.id
}

// ── My Scans: scans belonging to the current user, with userName joined ──────

export async function getMyScans() {
  const userId = await getUserId()

  const rows = await db
    .select({
      id: scans.id,
      artNumber: scans.artNumber,
      colorNumber: scans.colorNumber,
      sizeNumber: scans.sizeNumber,
      quantity: scans.quantity,
      scannedAt: scans.scannedAt,
      userName: userTable.name,
    })
    .from(scans)
    .leftJoin(userTable, eq(scans.userId, userTable.id))
    .where(eq(scans.userId, userId))
    .orderBy(desc(scans.scannedAt))

  return rows
}

export async function getMyStatistics() {
  const userId = await getUserId()

  const scanData = await db.select().from(scans).where(eq(scans.userId, userId))

  const totalScans = scanData.length
  const totalItems = scanData.reduce((sum, s) => sum + s.quantity, 0)
  const uniqueItems = new Set(
    scanData.map((s) => `${s.artNumber}-${s.colorNumber}-${s.sizeNumber}`)
  ).size
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scansLast24h = scanData.filter((s) => new Date(s.scannedAt) > oneDayAgo).length

  return { totalScans, totalItems, uniqueItems, scansLast24h }
}

// ── Overall Stock: all users, aggregated, with last-scanned-by name ───────────

export async function getOverallStock() {
  // All scans across all users, joined with user name
  const rows = await db
    .select({
      id: scans.id,
      artNumber: scans.artNumber,
      colorNumber: scans.colorNumber,
      sizeNumber: scans.sizeNumber,
      quantity: scans.quantity,
      scannedAt: scans.scannedAt,
      userName: userTable.name,
    })
    .from(scans)
    .leftJoin(userTable, eq(scans.userId, userTable.id))
    .orderBy(desc(scans.scannedAt))

  // Aggregate by art+color+size
  const map = new Map<
    string,
    {
      artNumber: string | null
      colorNumber: string | null
      sizeNumber: string | null
      quantity: number
      lastScanned: Date
      lastScannedBy: string
      scanCount: number
    }
  >()

  for (const row of rows) {
    const key = `${row.artNumber}|${row.colorNumber}|${row.sizeNumber}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        artNumber: row.artNumber,
        colorNumber: row.colorNumber,
        sizeNumber: row.sizeNumber,
        quantity: row.quantity,
        lastScanned: row.scannedAt,
        lastScannedBy: row.userName ?? 'Unknown',
        scanCount: 1,
      })
    } else {
      existing.quantity += row.quantity
      existing.scanCount += 1
      if (row.scannedAt > existing.lastScanned) {
        existing.lastScanned = row.scannedAt
        existing.lastScannedBy = row.userName ?? 'Unknown'
      }
    }
  }

  return Array.from(map.values())
}

export async function getOverallStatistics() {
  const allScans = await db.select().from(scans)

  const totalScans = allScans.length
  const totalItems = allScans.reduce((sum, s) => sum + s.quantity, 0)
  const uniqueItems = new Set(
    allScans.map((s) => `${s.artNumber}-${s.colorNumber}-${s.sizeNumber}`)
  ).size
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scansLast24h = allScans.filter((s) => new Date(s.scannedAt) > oneDayAgo).length

  return { totalScans, totalItems, uniqueItems, scansLast24h }
}

// ── Existing actions (unchanged) ──────────────────────────────────────────────

export async function searchInventory(query: string) {
  const userId = await getUserId()
  if (!query.trim()) {
    return db.select().from(scans).where(eq(scans.userId, userId)).orderBy(desc(scans.createdAt))
  }
  return db
    .select()
    .from(scans)
    .where(and(eq(scans.userId, userId), ilike(scans.artNumber ?? '', `%${query}%`)))
    .orderBy(desc(scans.createdAt))
}

export async function getInventorySummary() {
  return getMyScans()
}

export async function addManualEntry(
  artNumber: string,
  colorNumber: string,
  sizeNumber: string,
  quantity: number,
  notes?: string
) {
  const userId = await getUserId()
  const result = await db
    .insert(manualEntries)
    .values({ userId, artNumber, colorNumber, sizeNumber, quantity, notes })
    .returning()
  revalidatePath('/dashboard')
  return result[0]
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
  return scanData.map((scan) => ({
    'Art Number': scan.artNumber || '',
    'Color Number': scan.colorNumber || '',
    'Size Number': scan.sizeNumber || '',
    Quantity: scan.quantity,
    'Scanned At': scan.scannedAt.toISOString(),
    'Raw QR': scan.rawQrCode,
  }))
}

export async function getStatistics() {
  return getMyStatistics()
}
