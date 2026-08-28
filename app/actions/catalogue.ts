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

// ── Article search — returns DISTINCT artName only ───────────────────────────
// Each artName may have multiple rows (one per color). We deduplicate here
// so the search dropdown shows each article name exactly once.

export interface ArticleResult {
  artNumber: string  // unique article name (artName column)
}

export async function searchArticles(query: string): Promise<ArticleResult[]> {
  await requireAuth()
  const q = query.trim()

  // Use DISTINCT ON to return one row per unique artName, ordered for relevance
  if (!q) {
    const rows = await db.execute(sql`
      SELECT DISTINCT "artName" AS "artNumber"
      FROM articles
      ORDER BY "artName" ASC
      LIMIT 20
    `)
    return (rows.rows as unknown[]).map(r => ({ artNumber: (r as Record<string, unknown>).artNumber as string }))
  }

  const rows = await db.execute(sql`
    SELECT "artNumber" FROM (
      SELECT DISTINCT "artName" AS "artNumber",
        CASE
          WHEN lower("artName") = lower(${q})           THEN 0
          WHEN lower("artName") LIKE lower(${q}) || '%' THEN 1
          ELSE 2
        END AS rank
      FROM articles
      WHERE lower("artName") LIKE ${'%' + q.toLowerCase() + '%'}
    ) sub
    ORDER BY rank ASC, "artNumber" ASC
    LIMIT 20
  `)
  return (rows.rows as unknown[]).map(r => ({ artNumber: (r as Record<string, unknown>).artNumber as string }))
}

// ── Article detail — all colors + sizes for a given artName ──────────────────
// Because artName has N rows (one per color), we fetch all matching article ids
// then aggregate their colors and sizes into a single detail object.
// The "id" returned is the first article id (used as a stable key only).

export interface ArticleDetail {
  id: number        // id of first article row for this artName (stable key)
  artNumber: string // the artName
  colors: { id: number; articleId: number; colorName: string; colorHex: string | null }[]
  sizes: { id: number; articleId: number; sizeLabel: string; sortOrder: number }[]
}

export async function getArticleDetailByName(artName: string): Promise<ArticleDetail | null> {
  await requireAuth()

  // All article rows for this artName (one per color)
  const artRows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.artName, artName))
    .orderBy(asc(articles.id))

  if (artRows.length === 0) return null

  const ids = artRows.map(r => r.id)
  const firstId = ids[0]

  // Use raw SQL with explicit int[] cast to avoid type mismatch errors
  const idList = ids.join(',')

  const [colorsRes, sizesRes] = await Promise.all([
    db.execute(sql.raw(`
      SELECT id, "articleId", "colorName", "colorHex"
      FROM article_colors
      WHERE "articleId" = ANY(ARRAY[${idList}]::int[])
      ORDER BY "articleId" ASC, id ASC
    `)),
    db.execute(sql.raw(`
      SELECT id, "articleId", "sizeLabel", "sortOrder"
      FROM article_sizes
      WHERE "articleId" = ANY(ARRAY[${idList}]::int[])
      ORDER BY "articleId" ASC, "sortOrder" ASC
    `)),
  ])

  const colors = colorsRes.rows as { id: number; articleId: number; colorName: string; colorHex: string | null }[]
  const sizes  = sizesRes.rows  as { id: number; articleId: number; sizeLabel: string; sortOrder: number }[]

  return { id: firstId, artNumber: artName, colors, sizes }
}

// ── Legacy compat — used by edit-order flow (load by artName string) ──────────
export async function getArticleDetailByNumber(artNumber: string): Promise<ArticleDetail | null> {
  return getArticleDetailByName(artNumber)
}

// ── Load detail by a specific article row id (used when editing order lines) ──
export async function getArticleDetail(articleId: number): Promise<ArticleDetail | null> {
  await requireAuth()
  const [row] = await db
    .select({ artName: articles.artName })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)
  if (!row) return null
  return getArticleDetailByName(row.artName)
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
