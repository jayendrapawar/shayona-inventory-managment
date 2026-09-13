-- Add 'billed' to the order_status enum
ALTER TYPE "order_status" ADD VALUE 'billed';

-- Add billerId and billedAt columns to orders table
ALTER TABLE "orders" ADD COLUMN "billerId" text REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "orders" ADD COLUMN "billedAt" timestamp;
