/**
 * Lightweight fuzzy search using Levenshtein distance.
 *
 * Strategy:
 *  1. Exact substring match  → always passes (score 0)
 *  2. Token-level prefix match → passes (score 1)
 *  3. Levenshtein distance on each query token vs each field token
 *     — allowed distance scales with token length (1 error per 4 chars)
 *     — if any token pair is within tolerance → passes (score 2+)
 *  4. No match → filtered out
 *
 * Returns a numeric score: lower = better match.
 * Returns Infinity when there is no match at all.
 */

/** Compute Levenshtein distance between two strings (iterative, O(m*n)). */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  // Use two rows to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/** Max allowed Levenshtein distance for a given token length. */
function tolerance(len: number): number {
  if (len <= 2) return 0   // very short tokens must match exactly
  if (len <= 4) return 1   // 3–4 chars: 1 typo
  if (len <= 7) return 2   // 5–7 chars: 2 typos
  return 3                 // 8+ chars: 3 typos
}

/**
 * Score how well `haystack` matches `query`.
 * Lower is better. Infinity means no match.
 *
 * @param haystack - The string being searched (e.g. a vendor name)
 * @param query    - The user's search input
 */
export function fuzzyScore(haystack: string, query: string): number {
  const h = haystack.toLowerCase().trim()
  const q = query.toLowerCase().trim()
  if (!q) return 0

  // 1. Exact substring — best possible match
  if (h.includes(q)) {
    // Rank: starts-with < word-start < substring
    if (h === q) return 0
    if (h.startsWith(q)) return 1
    if (h.split(/[\s_-]+/).some(w => w.startsWith(q))) return 2
    return 3
  }

  // 2. Split both into tokens and do fuzzy token matching
  const hTokens = h.split(/[\s_\-/]+/).filter(Boolean)
  const qTokens = q.split(/[\s_\-/]+/).filter(Boolean)

  let totalScore = 0

  for (const qt of qTokens) {
    let bestForToken = Infinity

    for (const ht of hTokens) {
      // Token prefix
      if (ht.startsWith(qt)) {
        bestForToken = Math.min(bestForToken, 4)
        continue
      }
      // Levenshtein
      const dist = levenshtein(qt, ht)
      if (dist <= tolerance(qt.length)) {
        bestForToken = Math.min(bestForToken, 5 + dist)
      }
    }

    // Also try against the full haystack string (handles no-space article codes like "FL02")
    const distFull = levenshtein(qt, h.slice(0, qt.length + 3))
    if (distFull <= tolerance(qt.length)) {
      bestForToken = Math.min(bestForToken, 5 + distFull)
    }

    if (bestForToken === Infinity) return Infinity // this token had no match at all
    totalScore += bestForToken
  }

  return totalScore
}

/**
 * Filter and rank an array of items by fuzzy match against one or more fields.
 *
 * @param items     - The array to search
 * @param query     - The user's search input
 * @param getFields - Function returning the strings to match against for each item
 * @returns Filtered + sorted array (best matches first)
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getFields: (item: T) => (string | null | undefined)[],
): T[] {
  const q = query.trim()
  if (!q) return items

  const scored: { item: T; score: number }[] = []

  for (const item of items) {
    const fields = getFields(item).filter(Boolean) as string[]
    // Best (lowest) score across all fields
    const score = Math.min(...fields.map(f => fuzzyScore(f, q)))
    if (score < Infinity) {
      scored.push({ item, score })
    }
  }

  scored.sort((a, b) => a.score !== b.score ? a.score - b.score : 0)
  return scored.map(s => s.item)
}
