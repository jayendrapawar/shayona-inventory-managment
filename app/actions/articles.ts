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


// ── Fetch all articles ────────────────────────────────────────────────────────
export async function getArticles(): Promise<Article[]> {
  await requireAuth()
  return db.select().from(articles).orderBy(asc(articles.artName))
}

// ── Save (upsert) a single article ───────────────────────────────────────────
export async function saveArticle(
  input: Omit<Article, 'id' | 'createdAt' | 'updatedAt'> & { id?: number; customSizes?: string }
): Promise<Article[]> {
  await requireAuth()

  // Extract customSizes so we don't insert it into articles database table which has no such column
  const { customSizes, ...cleanInput } = input

  await db.transaction(async (tx) => {
    let articleId: number

    if (cleanInput.id) {
      await tx
        .insert(articles)
        .values({ ...cleanInput, id: cleanInput.id })
        .onConflictDoUpdate({
          target: articles.id,
          set: {
            artName:   cleanInput.artName,
            artCode:   cleanInput.artCode,
            color:     cleanInput.color,
            colorCode: cleanInput.colorCode,
            maxSize:   cleanInput.maxSize,
            minSize:   cleanInput.minSize,
            updatedAt: sql`now()`,
          },
        })
      articleId = cleanInput.id
    } else {
      const [inserted] = await tx
        .insert(articles)
        .values({ ...cleanInput })
        .returning({ id: articles.id })
      articleId = inserted.id
    }

    // Sync article_colors
    await tx.delete(articleColors).where(eq(articleColors.articleId, articleId))
    if (cleanInput.color.trim()) {
      await tx.insert(articleColors).values({
        articleId,
        colorName: cleanInput.color.trim(),
        colorHex:  cleanInput.colorCode.trim() || null,
      })
    }

    // Sync article_sizes
    const min = parseInt(cleanInput.minSize, 10)
    const max = parseInt(cleanInput.maxSize, 10)
    await tx.delete(articleSizes).where(eq(articleSizes.articleId, articleId))
    
    const sizeLabels = new Set<string>()

    // 1. Process custom sizes if present
    if (customSizes) {
      const customs = customSizes
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      for (const custom of customs) {
        sizeLabels.add(custom)
      }
    }

    // 2. Process sequential size range
    if (!isNaN(min) && !isNaN(max) && min <= max) {
      for (let size = min; size <= max; size++) {
        sizeLabels.add(String(size))
      }
    }

    if (sizeLabels.size > 0) {
      // Sort collected sizes naturally (numerics first, then XS/S/M/L, then alphanumeric strings)
      const sortedLabels = Array.from(sizeLabels).sort((a, b) => {
        const numA = parseInt(a, 10)
        const numB = parseInt(b, 10)
        
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB
        }
        if (!isNaN(numA)) return -1
        if (!isNaN(numB)) return 1
        
        const standardOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '4XL']
        const idxA = standardOrder.indexOf(a.toUpperCase())
        const idxB = standardOrder.indexOf(b.toUpperCase())
        
        if (idxA !== -1 && idxB !== -1) {
          return idxA - idxB
        }
        if (idxA !== -1) return -1
        if (idxB !== -1) return 1
        
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      })

      const sizeRows = sortedLabels.map((label, idx) => ({
        articleId,
        sizeLabel: label,
        sortOrder: idx + 1
      }))

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

// ── Fetch size labels for a single article ───────────────────────────────────
export async function getArticleSizes(articleId: number): Promise<string[]> {
  await requireAuth()
  const rows = await db
    .select({ sizeLabel: articleSizes.sizeLabel })
    .from(articleSizes)
    .where(eq(articleSizes.articleId, articleId))
    .orderBy(articleSizes.sortOrder)
  return rows.map(r => r.sizeLabel)
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
