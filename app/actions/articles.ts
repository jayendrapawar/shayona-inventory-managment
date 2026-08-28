'use server'

import { db } from '@/lib/db'
import { articles } from '@/lib/db/schema'
import { asc, sql, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
}

export type Article = typeof articles.$inferSelect

// ── Fetch all articles ────────────────────────────────────────────────────────
export async function getArticles(): Promise<Article[]> {
  await requireAuth()
  return db.select().from(articles).orderBy(asc(articles.artName))
}

// ── Save (upsert) a single article ───────────────────────────────────────────
export async function saveArticle(
  input: Omit<Article, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }
): Promise<Article[]> {
  await requireAuth()

  if (input.id) {
    await db
      .insert(articles)
      .values({ ...input, id: input.id })
      .onConflictDoUpdate({
        target: articles.id,
        set: {
          artName:   input.artName,
          artCode:   input.artCode,
          color:     input.color,
          colorCode: input.colorCode,
          maxSize:   input.maxSize,
          minSize:   input.minSize,
          updatedAt: sql`now()`,
        },
      })
  } else {
    await db.insert(articles).values({ ...input })
  }

  return db.select().from(articles).orderBy(asc(articles.artName))
}

// ── Bulk import articles from parsed CSV rows ─────────────────────────────────
export async function importArticles(
  rows: Omit<Article, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<{ imported: number; skipped: number; list: Article[] }> {
  await requireAuth()

  // Deduplicate by artCode (non-empty) — skip rows whose artCode already exists
  const existing = await db.select({ artCode: articles.artCode }).from(articles)
  const existingCodes = new Set(
    existing.map(a => a.artCode.toLowerCase().trim()).filter(Boolean)
  )

  const newRows = rows.filter(r => {
    const code = r.artCode.toLowerCase().trim()
    // If artCode is blank treat each row as new; otherwise skip if already exists
    return !code || !existingCodes.has(code)
  })
  const skipped = rows.length - newRows.length

  if (newRows.length > 0) {
    for (const row of newRows) {
      await db.insert(articles).values({ ...row })
    }
  }

  const list = await db.select().from(articles).orderBy(asc(articles.artName))
  return { imported: newRows.length, skipped, list }
}
