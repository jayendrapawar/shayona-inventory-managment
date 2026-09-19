-- Migration: add order_sets table for admin-defined size+quantity templates

CREATE TABLE IF NOT EXISTS "order_sets" (
  "id"         SERIAL PRIMARY KEY,
  "name"       TEXT NOT NULL,
  "quantities" JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE "order_sets" ADD CONSTRAINT "order_sets_name_unique" UNIQUE ("name");
