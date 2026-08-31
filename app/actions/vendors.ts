'use server'

import { db } from '@/lib/db'
import { vendors } from '@/lib/db/schema'
import { eq, asc, ilike, or, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { fuzzyScore } from '@/lib/fuzzy'

async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
}

export type Vendor = typeof vendors.$inferSelect

// ── Generate next ID (V001, V002, …) ─────────────────────────────────────────
async function genId(): Promise<string> {
  const [row] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .orderBy(sql`CAST(SUBSTRING(id, 2) AS INTEGER) DESC`)
    .limit(1)
  if (!row) return 'V001'
  const num = parseInt(row.id.replace('V', ''), 10)
  return `V${String(num + 1).padStart(3, '0')}`
}

// ── Bulk import vendors from parsed CSV rows ──────────────────────────────────
export async function importVendors(
  rows: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<{ imported: number; skipped: number; list: Vendor[] }> {
  await requireAuth()

  // Load existing partyNames (lowercase) to deduplicate
  const existing = await db.select({ partyName: vendors.partyName }).from(vendors)
  const existingNames = new Set(existing.map(v => v.partyName.toLowerCase().trim()))

  // Filter out rows whose partyName already exists
  const newRows = rows.filter(r => !existingNames.has(r.partyName.toLowerCase().trim()))
  const skipped = rows.length - newRows.length

  if (newRows.length > 0) {
    // Get current highest ID for sequential assignment
    const [last] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .orderBy(sql`CAST(SUBSTRING(id, 2) AS INTEGER) DESC`)
      .limit(1)

    let next = last ? parseInt(last.id.replace('V', ''), 10) + 1 : 1

    for (const row of newRows) {
      const id = `V${String(next++).padStart(3, '0')}`
      await db.insert(vendors).values({ ...row, id })
    }
  }

  const list = await db.select().from(vendors).orderBy(asc(vendors.partyName))
  return { imported: newRows.length, skipped, list }
}

// ── Fetch all vendors ─────────────────────────────────────────────────────────
export async function getVendors(): Promise<Vendor[]> {
  await requireAuth()
  return db.select().from(vendors).orderBy(asc(vendors.partyName))
}

// ── Save (upsert) a single vendor ─────────────────────────────────────────────
export async function saveVendor(
  input: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<Vendor[]> {
  await requireAuth()
  const id = input.id || (await genId())
  await db
    .insert(vendors)
    .values({ ...input, id })
    .onConflictDoUpdate({
      target: vendors.id,
      set: {
        partyName:  input.partyName,
        gst:        input.gst,
        phone:      input.phone,
        address:    input.address,
        city:       input.city,
        area:       input.area,
        day:        input.day,
        salesman:   input.salesman,
        status:     input.status,
        updatedAt:  sql`now()`,
      },
    })
  return db.select().from(vendors).orderBy(asc(vendors.partyName))
}

// ── Search vendors (used by salesman dashboard) ───────────────────────────────
export async function searchVendors(query: string): Promise<Vendor[]> {
  await requireAuth()
  const q = query.trim()

  if (!q) {
    return db.select().from(vendors).where(eq(vendors.status, 'active')).orderBy(asc(vendors.partyName)).limit(20)
  }

  // Broad DB fetch — pull any row that substring-matches on key fields
  const rows = await db
    .select()
    .from(vendors)
    .where(
      or(
        ilike(vendors.partyName, `%${q}%`),
        ilike(vendors.area, `%${q}%`),
        ilike(vendors.city, `%${q}%`),
        ilike(vendors.phone, `%${q}%`),
      )
    )
    .orderBy(asc(vendors.partyName))
    .limit(100)

  // Also fetch a wider set for fuzzy (typo tolerance) — up to 200 active vendors
  const wider = await db
    .select()
    .from(vendors)
    .where(eq(vendors.status, 'active'))
    .orderBy(asc(vendors.partyName))
    .limit(200)

  // Merge: start with broader set, score every row, keep top matches
  const seen = new Set<string>()
  const candidates = [...rows, ...wider].filter(v => {
    if (seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })

  const scored = candidates
    .map(v => ({
      v,
      score: Math.min(
        fuzzyScore(v.partyName, q),
        fuzzyScore(v.area ?? '', q),
        fuzzyScore(v.city ?? '', q),
        fuzzyScore(v.phone ?? '', q),
      ),
    }))
    .filter(x => x.score < Infinity)
    .sort((a, b) => a.score !== b.score ? a.score - b.score : a.v.partyName.localeCompare(b.v.partyName))

  return scored.slice(0, 20).map(x => x.v)
}
