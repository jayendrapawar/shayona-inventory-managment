import { ARTICLE_TYPE_PREFIXES, DIVISION_MAP, DEFAULT_DIVISION } from './qr-config'

export interface ParsedQr {
  normalized: string    // URL-stripped, uppercased
  articleCode: string   // e.g. "FL0548L"
  colorCode: string     // e.g. "SASA"  (first 4 chars of field 1)
  size: string          // e.g. "6"     (last 2 digits of field 1 remainder)
  division: string      // e.g. "Flite EVA"
  mrp: number           // e.g. 289.50  (field 3)
  mfgMonth: number      // e.g. 4       (first 2 chars of field 2 MMYY)
  mfgYear: number       // e.g. 2026    (last 2 chars of field 2 MMYY + 2000)
}

/**
 * Normalize a raw QR string:
 *   - strip leading https?://
 *   - strip trailing /
 *   - uppercase
 */
export function normalizeQr(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .toUpperCase()
}

/**
 * Parse a raw QR string into its structured fields.
 * The normalized form is stored alongside raw in the DB.
 */
export function parseQr(raw: string): ParsedQr {
  const normalized = normalizeQr(raw)
  const fields = normalized.split('-')

  // --- Field 0: find first known article-type prefix (longest-first) --------
  const sortedPrefixes = [...ARTICLE_TYPE_PREFIXES].sort((a, b) => b.length - a.length)
  const field0 = fields[0] ?? ''
  let articleCode = field0
  let division = DEFAULT_DIVISION
  for (const prefix of sortedPrefixes) {
    const idx = field0.indexOf(prefix)
    if (idx !== -1) {
      articleCode = field0.slice(idx)
      division = DIVISION_MAP[prefix] ?? DEFAULT_DIVISION
      break
    }
  }

  // --- Field 1: colorCode (first 4 chars) + size (last 2 digits of rest) ----
  const field1 = fields[1] ?? ''
  const colorCode = field1.slice(0, 4)
  const digitRun = field1.slice(4).replace(/\D/g, '')
  const size =
    digitRun.length >= 2
      ? String(parseInt(digitRun.slice(-2), 10))
      : digitRun || '0'

  // --- Field 2: MMYY (first 4 chars) ----------------------------------------
  const field2 = fields[2] ?? ''
  const mmyy = field2.slice(0, 4)
  const mfgMonth = mmyy.length >= 2 ? parseInt(mmyy.slice(0, 2), 10) || 0 : 0
  const mfgYear = mmyy.length === 4 ? 2000 + (parseInt(mmyy.slice(2, 4), 10) || 0) : 0

  // --- Field 3: MRP ----------------------------------------------------------
  const mrp = parseFloat(fields[3] ?? '0') || 0

  return { normalized, articleCode, colorCode, size, division, mrp, mfgMonth, mfgYear }
}
