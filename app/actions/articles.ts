'use server'

import { db } from '@/lib/db'
import { articles, articleSizes, articleColors } from '@/lib/db/schema'
import { asc, sql, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
}

export type Article = typeof articles.$inferSelect

// ── Sync article_colors for an article based on color + colorCode ─────────────
async function syncColor(articleId: number, colorName: string, colorHex: string) {
  await db.delete(articleColors).where(eq(articleColors.articleId, articleId))
  if (colorName.trim()) {
    await db.insert(articleColors).values({
      articleId,
      colorName: colorName.trim(),
      colorHex:  colorHex.trim() || null,
    })
  }
}

// ── Sync article_sizes for an article based on minSize..maxSize ───────────────
async function syncSizes(articleId: number, minSize: string, maxSize: string) {
  const min = parseInt(minSize, 10)
  const max = parseInt(maxSize, 10)

  await db.delete(articleSizes).where(eq(articleSizes.articleId, articleId))

  if (!isNaN(min) && !isNaN(max) && min <= max) {
    const rows = []
    for (let size = min, order = 1; size <= max; size++, order++) {
      rows.push({ articleId, sizeLabel: String(size), sortOrder: order })
    }
    await db.insert(articleSizes).values(rows)
  }
}

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

  await db.transaction(async (tx) => {
    let articleId: number

    if (input.id) {
      await tx
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
      articleId = input.id
    } else {
      const [inserted] = await tx
        .insert(articles)
        .values({ ...input })
        .returning({ id: articles.id })
      articleId = inserted.id
    }

    // Sync article_colors
    await tx.delete(articleColors).where(eq(articleColors.articleId, articleId))
    if (input.color.trim()) {
      await tx.insert(articleColors).values({
        articleId,
        colorName: input.color.trim(),
        colorHex:  input.colorCode.trim() || null,
      })
    }

    // Sync article_sizes
    const min = parseInt(input.minSize, 10)
    const max = parseInt(input.maxSize, 10)
    await tx.delete(articleSizes).where(eq(articleSizes.articleId, articleId))
    if (!isNaN(min) && !isNaN(max) && min <= max) {
      const sizeRows = []
      for (let size = min, order = 1; size <= max; size++, order++) {
        sizeRows.push({ articleId, sizeLabel: String(size), sortOrder: order })
      }
      await tx.insert(articleSizes).values(sizeRows)
    }
  })

  return db.select().from(articles).orderBy(asc(articles.artName))
}

// ── Delete a single article ──────────────────────────────────────────────────
export async function deleteArticle(id: number): Promise<Article[]> {
  await requireAuth()
  await db.delete(articles).where(eq(articles.id, id))
  return db.select().from(articles).orderBy(asc(articles.artName))
}


// ── Bulk import articles from parsed CSV rows ─────────────────────────────────
export async function importArticles(
  rows: Omit<Article, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<{ imported: number; skipped: number; list: Article[] }> {
  await requireAuth()

  // Deduplicate by artName + color composite key
  const existing = await db.select({ artName: articles.artName, color: articles.color }).from(articles)
  const existingKeys = new Set(
    existing.map(a => `${a.artName.toLowerCase().trim()}||${a.color.toLowerCase().trim()}`)
  )

  const newRows = rows.filter(r => {
    const key = `${r.artName.toLowerCase().trim()}||${r.color.toLowerCase().trim()}`
    return !existingKeys.has(key)
  })
  const skipped = rows.length - newRows.length

  for (const row of newRows) {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(articles)
        .values({ ...row })
        .returning({ id: articles.id })
      const articleId = inserted.id

      // Sync article_colors
      if (row.color.trim()) {
        await tx.insert(articleColors).values({
          articleId,
          colorName: row.color.trim(),
          colorHex:  row.colorCode.trim() || null,
        })
      }

      // Sync article_sizes
      const min = parseInt(row.minSize, 10)
      const max = parseInt(row.maxSize, 10)
      if (!isNaN(min) && !isNaN(max) && min <= max) {
        const sizeRows = []
        for (let size = min, order = 1; size <= max; size++, order++) {
          sizeRows.push({ articleId, sizeLabel: String(size), sortOrder: order })
        }
        await tx.insert(articleSizes).values(sizeRows)
      }
    })
  }

  const list = await db.select().from(articles).orderBy(asc(articles.artName))
  return { imported: newRows.length, skipped, list }
}
