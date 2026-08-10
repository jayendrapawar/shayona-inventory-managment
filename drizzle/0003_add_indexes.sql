-- Index on rawQrCode for the duplicate-scan check (used on every camera scan)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scans_rawQrCode_idx"
  ON "scans" ("rawQrCode");

-- Index on scannedByName + scannedAt for the per-user recent-scans query
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scans_scannedByName_scannedAt_idx"
  ON "scans" ("scannedByName", "scannedAt" DESC);

-- Index on artNumber + colorNumber + sizeNumber for the quantity-merge check
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scans_sku_idx"
  ON "scans" ("artNumber", "colorNumber", "sizeNumber");
