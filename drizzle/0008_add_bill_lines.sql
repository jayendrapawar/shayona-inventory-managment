CREATE TABLE IF NOT EXISTS "bill_lines" (
  "id"          serial PRIMARY KEY,
  "orderId"     integer NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "artNumber"   text NOT NULL,
  "mrp"         numeric(10, 2) NOT NULL,
  "qty"         integer NOT NULL,
  "lineDiscPct" numeric(5, 2) NOT NULL DEFAULT '30',
  "createdAt"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bill_lines_orderId_idx" ON "bill_lines" ("orderId");
