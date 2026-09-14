// Separate helper file for matching article codes (e.g. A1SF0204G matches SFG-204, or FL0548L matches FL-548L)

export function articlesMatch(databaseArticle: string, scannedArticle: string): boolean {
  if (!databaseArticle || !scannedArticle) return false;

  const dbUpper = databaseArticle.toUpperCase();
  const scanUpper = scannedArticle.toUpperCase().replace(/[^A-Z0-9]/g, ''); // strip dashes/spaces from scanned article

  // Ignore test articles
  if (dbUpper.includes('TEST') || dbUpper.includes('TEST ARTICLE')) {
    return false;
  }

  // Clean database article:
  // 1. Remove anything in parentheses (e.g. "(kid)", "(Women Sandal)", "(Men)", etc.)
  let cleanDb = dbUpper.replace(/\s*\(.*?\)/g, '');

  // 2. Strip trailing 'S' if it follows a digit (e.g. "FL-02S" -> "FL-02", "FLK-2035S" -> "FLK-2035")
  cleanDb = cleanDb.replace(/(\d+)S\s*$/g, '$1');

  // Extract letter prefix from cleanDb
  const letterMatch = cleanDb.match(/^[A-Z]+/);
  const dbLetters = letterMatch ? letterMatch[0] : '';

  // Extract digits from cleanDb
  const digitMatch = cleanDb.match(/\d+/);
  const dbDigits = digitMatch ? digitMatch[0] : '';

  if (dbLetters.length < 2) {
    // Fallback to exact match if not enough letters are found
    const normDb = cleanDb.replace(/[^A-Z0-9]/g, '');
    return normDb === scanUpper;
  }

  // Validate first 2 letters
  const firstTwo = dbLetters.substring(0, 2);
  if (!scanUpper.includes(firstTwo)) {
    return false;
  }

  // Validate 3rd letter if present in database article prefix
  if (dbLetters.length >= 3) {
    const thirdLetter = dbLetters.charAt(2);
    if (!scanUpper.endsWith(thirdLetter)) {
      return false;
    }
  }

  // Validate digits sequence (stripping leading zeroes)
  if (dbDigits) {
    const cleanDbDigits = dbDigits.replace(/^0+/, '') || '0';
    if (!scanUpper.includes(cleanDbDigits)) {
      return false;
    }
  }

  return true;
}
