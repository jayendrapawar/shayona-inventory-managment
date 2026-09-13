// Separate helper file for matching article codes (e.g. A1SF0204G matches SFG-204, or FL0548L matches FL-548L)

export function articlesMatch(a: string, b: string): boolean {
  const normA = a.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normB = b.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (normA === normB) return true;

  // Strip leading single-letter + single-digit prefix (like A1, B1, etc.)
  const cleanA = normA.replace(/^[A-Z]\d/, '');
  const cleanB = normB.replace(/^[A-Z]\d/, '');

  if (cleanA === cleanB) return true;

  // Extract sorted letter parts and numeric parts
  const lettersA = cleanA.replace(/[^A-Z]/g, '').split('').sort().join('');
  const lettersB = cleanB.replace(/[^A-Z]/g, '').split('').sort().join('');

  const digitsA = cleanA.replace(/[^0-9]/g, '');
  const digitsB = cleanB.replace(/[^0-9]/g, '');

  const numA = digitsA ? parseInt(digitsA, 10) : null;
  const numB = digitsB ? parseInt(digitsB, 10) : null;

  return lettersA === lettersB && numA === numB;
}
