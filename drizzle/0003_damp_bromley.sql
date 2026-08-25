CREATE TABLE "article_colors" (
	"id" serial PRIMARY KEY NOT NULL,
	"articleId" integer NOT NULL,
	"colorName" text NOT NULL,
	"colorHex" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_sizes" (
	"id" serial PRIMARY KEY NOT NULL,
	"articleId" integer NOT NULL,
	"sizeLabel" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"artNumber" text NOT NULL,
	"mrp" numeric,
	"rate" numeric,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "articles_artNumber_unique" UNIQUE("artNumber")
);
--> statement-breakpoint
CREATE TABLE "shopkeepers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"phone" text,
	"address" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_colors" ADD CONSTRAINT "article_colors_articleId_articles_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sizes" ADD CONSTRAINT "article_sizes_articleId_articles_id_fk" FOREIGN KEY ("articleId") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_art_number_idx" ON "articles" USING btree ("artNumber");--> statement-breakpoint
CREATE INDEX "shopkeepers_name_idx" ON "shopkeepers" USING btree ("name");