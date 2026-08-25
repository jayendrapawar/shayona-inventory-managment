'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { shopkeepers, articles, articleColors, articleSizes } from '@/lib/db/schema'
import { ilike, asc, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'

async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user
}

// ── Shopkeeper search ─────────────────────────────────────────────────────────

export interface ShopkeeperResult {
  id: number
  name: string
  code: string | null
  phone: string | null
  address: string | null
}

export async function searchShopkeepers(query: string): Promise<ShopkeeperResult[]> {
  await requireAuth()
  const q = query.trim()
  if (!q) {
    // Return first 20 alphabetically when no query
    return db
      .select({ id: shopkeepers.id, name: shopkeepers.name, code: shopkeepers.code, phone: shopkeepers.phone, address: shopkeepers.address })
      .from(shopkeepers)
      .orderBy(asc(shopkeepers.name))
      .limit(20)
  }

  const rows = await db
    .select({ id: shopkeepers.id, name: shopkeepers.name, code: shopkeepers.code, phone: shopkeepers.phone, address: shopkeepers.address })
    .from(shopkeepers)
    .where(ilike(shopkeepers.name, `%${q}%`))
    .orderBy(asc(shopkeepers.name))
    .limit(20)

  return rankResults(rows, q, r => r.name)
}

// ── Article search ────────────────────────────────────────────────────────────

export interface ArticleResult {
  id: number
  artNumber: string
  mrp: string | null
  rate: string | null
}

export async function searchArticles(query: string): Promise<ArticleResult[]> {
  await requireAuth()
  const q = query.trim()
  if (!q) {
    return db
      .select({ id: articles.id, artNumber: articles.artNumber, mrp: articles.mrp, rate: articles.rate })
      .from(articles)
      .orderBy(asc(articles.artNumber))
      .limit(20)
  }

  // Use a DB-level CASE ranking so prefix matches sort before mid-string matches,
  // reducing the need for JS post-processing in the common case.
  // Note: server actions can't be cancelled mid-flight; the seq-number pattern
  // in the client already handles stale responses from prior keystrokes.
  return db
    .select({ id: articles.id, artNumber: articles.artNumber, mrp: articles.mrp, rate: articles.rate })
    .from(articles)
    .where(ilike(articles.artNumber, `%${q}%`))
    .orderBy(
      sql`CASE
        WHEN lower("artNumber") = lower(${q}) THEN 0
        WHEN lower("artNumber") LIKE lower(${q}) || '%' THEN 1
        ELSE 2
      END`,
      asc(articles.artNumber),
    )
    .limit(20)
}

// ── Article detail (colors + sizes) ──────────────────────────────────────────

export interface ArticleDetail {
  id: number
  artNumber: string
  mrp: string | null
  rate: string | null
  colors: { id: number; colorName: string; colorHex: string | null }[]
  sizes: { id: number; sizeLabel: string; sortOrder: number }[]
}

export async function getArticleDetailByNumber(artNumber: string): Promise<ArticleDetail | null> {
  await requireAuth()
  const [article] = await db
    .select({ id: articles.id, artNumber: articles.artNumber, mrp: articles.mrp, rate: articles.rate })
    .from(articles)
    .where(eq(articles.artNumber, artNumber))
    .limit(1)
  if (!article) return null
  const [colors, sizes] = await Promise.all([
    db.select({ id: articleColors.id, colorName: articleColors.colorName, colorHex: articleColors.colorHex })
      .from(articleColors).where(eq(articleColors.articleId, article.id)).orderBy(asc(articleColors.id)),
    db.select({ id: articleSizes.id, sizeLabel: articleSizes.sizeLabel, sortOrder: articleSizes.sortOrder })
      .from(articleSizes).where(eq(articleSizes.articleId, article.id)).orderBy(asc(articleSizes.sortOrder)),
  ])
  return { ...article, colors, sizes }
}

export async function getArticleDetail(articleId: number): Promise<ArticleDetail | null> {
  await requireAuth()

  const [article] = await db
    .select({ id: articles.id, artNumber: articles.artNumber, mrp: articles.mrp, rate: articles.rate })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)

  if (!article) return null

  const [colors, sizes] = await Promise.all([
    db.select({ id: articleColors.id, colorName: articleColors.colorName, colorHex: articleColors.colorHex })
      .from(articleColors)
      .where(eq(articleColors.articleId, articleId))
      .orderBy(asc(articleColors.id)),
    db.select({ id: articleSizes.id, sizeLabel: articleSizes.sizeLabel, sortOrder: articleSizes.sortOrder })
      .from(articleSizes)
      .where(eq(articleSizes.articleId, articleId))
      .orderBy(asc(articleSizes.sortOrder)),
  ])

  return { ...article, colors, sizes }
}

// ── Ranking helper ────────────────────────────────────────────────────────────

function rankResults<T>(rows: T[], query: string, getKey: (r: T) => string): T[] {
  const q = query.toLowerCase()
  const scored = rows.map(r => {
    const key = getKey(r).toLowerCase()
    let score = 3 // contains
    if (key === q) score = 0                             // exact
    else if (key.startsWith(q)) score = 1               // starts with
    else if (key.split(/\s+/).some(w => w.startsWith(q))) score = 2 // word starts with
    return { r, score }
  })
  scored.sort((a, b) => a.score !== b.score ? a.score - b.score : getKey(a.r).localeCompare(getKey(b.r)))
  return scored.map(s => s.r)
}
