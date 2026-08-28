'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { articles, articleColors, articleSizes } from '@/lib/db/schema'
import { ilike, asc, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { searchVendors } from '@/app/actions/vendors'

async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user
}

// ── Shopkeeper search (backed by vendors DB table) ────────────────────────────

export interface ShopkeeperResult {
  id: number
  name: string
  code: string | null
  phone: string | null
  address: string | null
}

export async function searchShopkeepers(query: string): Promise<ShopkeeperResult[]> {
  await requireAuth()
  const rows = await searchVendors(query)
  return rows.map(v => ({
    id: 0,                         // unused — orders store shopkeeperName as text
    name: v.partyName,
    code: v.area || null,
    phone: v.phone || null,
    address: [v.address, v.city].filter(Boolean).join(', ') || null,
  }))
}

// ── Article search ────────────────────────────────────────────────────────────

export interface ArticleResult {
  id: number
  artNumber: string
}

export async function searchArticles(query: string): Promise<ArticleResult[]> {
  await requireAuth()
  const q = query.trim()
  if (!q) {
    return db
      .select({ id: articles.id, artNumber: articles.artName })
      .from(articles)
      .orderBy(asc(articles.artName))
      .limit(20)
  }

  return db
    .select({ id: articles.id, artNumber: articles.artName })
    .from(articles)
    .where(ilike(articles.artName, `%${q}%`))
    .orderBy(
      sql`CASE
        WHEN lower("artName") = lower(${q}) THEN 0
        WHEN lower("artName") LIKE lower(${q}) || '%' THEN 1
        ELSE 2
      END`,
      asc(articles.artName),
    )
    .limit(20)
}

// ── Article detail (colors + sizes) ──────────────────────────────────────────

export interface ArticleDetail {
  id: number
  artNumber: string
  colors: { id: number; colorName: string; colorHex: string | null }[]
  sizes: { id: number; sizeLabel: string; sortOrder: number }[]
}

export async function getArticleDetailByNumber(artNumber: string): Promise<ArticleDetail | null> {
  await requireAuth()
  const [article] = await db
    .select({ id: articles.id, artNumber: articles.artName })
    .from(articles)
    .where(eq(articles.artName, artNumber))
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
    .select({ id: articles.id, artNumber: articles.artName })
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
