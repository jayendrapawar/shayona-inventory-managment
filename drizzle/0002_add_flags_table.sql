CREATE TABLE "flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "flags" ("name") VALUES ('Ideal'), ('Cartoon No') ON CONFLICT DO NOTHING;
