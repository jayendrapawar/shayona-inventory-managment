'use server'

import { db, pool } from '@/lib/db'
import { orderSets, user } from '@/lib/db/schema'
import { asc, eq, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export type OrderSet = typeof orderSets.$inferSelect

async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  // Role is stored in the DB, not on the session object — must query
  const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
  const roles = (u?.role ?? '').split(',').map((r: string) => r.trim())
  if (!roles.includes('admin')) throw new Error('Forbidden')
}

// ── Auto-migrate: create the table if it doesn't exist yet ───────────────────
// Runs once on first call; subsequent calls are no-ops (IF NOT EXISTS).
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "order_sets" (
      "id"         SERIAL PRIMARY KEY,
      "name"       TEXT NOT NULL,
      "quantities" JSONB NOT NULL DEFAULT '{}',
      "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE "order_sets" ADD CONSTRAINT "order_sets_name_unique" UNIQUE ("name");
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$
  `)
}

// ── Fetch all sets ────────────────────────────────────────────────────────────
export async function getSets(): Promise<OrderSet[]> {
  await requireAuth()
  await ensureTable()
  return db.select().from(orderSets).orderBy(asc(orderSets.name))
}

// ── Save (upsert) a single set ────────────────────────────────────────────────
export async function saveSet(
  input: { name: string; quantities: Record<string, number>; id?: number }
): Promise<OrderSet[]> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Set name is required')

  if (input.id) {
    await db
      .update(orderSets)
      .set({
        name: input.name.trim(),
        quantities: input.quantities,
        updatedAt: sql`now()`,
      })
      .where(eq(orderSets.id, input.id))
  } else {
    await db.insert(orderSets).values({
      name: input.name.trim(),
      quantities: input.quantities,
    })
  }
  return db.select().from(orderSets).orderBy(asc(orderSets.name))
}

// ── Delete a single set ───────────────────────────────────────────────────────
export async function deleteSet(id: number): Promise<OrderSet[]> {
  await requireAdmin()
  await db.delete(orderSets).where(eq(orderSets.id, id))
  return db.select().from(orderSets).orderBy(asc(orderSets.name))
}
