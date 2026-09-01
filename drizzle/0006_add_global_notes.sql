CREATE TABLE IF NOT EXISTS "global_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "content" text NOT NULL,
  "authorId" text REFERENCES "user"("id") ON DELETE SET NULL,
  "authorName" text,
  "pinned" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "global_notes_created_at_idx" ON "global_notes" ("createdAt");
