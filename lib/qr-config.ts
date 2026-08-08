// Edit this file to add article-type prefixes or remap divisions.
// No logic changes needed — values are read at parse time.

// Sorted longest-first so a longer prefix like "FL" is matched before a
// hypothetical single-char prefix like "F".
export const ARTICLE_TYPE_PREFIXES: string[] = ['FL', 'P', 'S']

export const DIVISION_MAP: Record<string, string> = {
  FL: 'Flite EVA',
  P: 'Flite PU',
  S: 'Sparx',
}

export const DEFAULT_DIVISION = 'Bahamas'
