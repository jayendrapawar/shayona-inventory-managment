-- Add totalBundles and deliveryAgentName columns to orders for dispatcher pickup flow
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "totalBundles" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveryAgentName" text;
