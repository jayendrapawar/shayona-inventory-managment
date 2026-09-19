ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "isEmergency" boolean NOT NULL DEFAULT false;
