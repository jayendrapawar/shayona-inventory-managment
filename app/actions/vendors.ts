'use server'

import { db } from '@/lib/db'
import { vendors } from '@/lib/db/schema'
import { eq, asc, ilike, or, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

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
        partyOwner: input.partyOwner,
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
  const base = db
    .select()
    .from(vendors)
    .where(eq(vendors.status, 'active'))

  if (!q) {
    return base.orderBy(asc(vendors.partyName)).limit(20)
  }

  return db
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
    .limit(20)
}
