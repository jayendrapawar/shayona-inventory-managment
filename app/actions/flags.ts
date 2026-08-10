'use server'

import { db } from '@/lib/db'
import { flags } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'

/** Return all flags ordered by creation time (oldest first). */
export async function getFlags(): Promise<string[]> {
  try {
    const rows = await db.select({ name: flags.name }).from(flags).orderBy(asc(flags.createdAt))
    return rows.map((r) => r.name)
  } catch {
    // Table may not exist yet (migration pending) or DB unreachable — return empty
    return []
  }
}

/**
 * Create a new flag if the name doesn't already exist.
 * Returns the updated full list of flag names.
 */
export async function createFlag(name: string): Promise<{ ok: true; flags: string[] } | { ok: false; error: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'Name is required' }
  if (trimmed.length > 50) return { ok: false, error: 'Name too long' }

  try {
    await db.insert(flags).values({ name: trimmed }).onConflictDoNothing()
  } catch {
    return { ok: false, error: 'Could not create flag' }
  }

  const updated = await getFlags()
  return { ok: true, flags: updated }
}
