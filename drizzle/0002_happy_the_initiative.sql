CREATE TYPE "public"."order_item_status" AS ENUM('pending', 'packed', 'out_of_stock');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"artNumber" text NOT NULL,
	"colorNumber" text,
	"sizeNumber" text,
	"quantityOrdered" integer DEFAULT 1 NOT NULL,
	"quantityPacked" integer DEFAULT 0 NOT NULL,
	"status" "order_item_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderNumber" text NOT NULL,
	"shopkeeperName" text NOT NULL,
	"shopkeeperPhone" text,
	"shopkeeperAddress" text,
	"salesmanId" text,
	"pickerId" text,
	"dispatcherId" text,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"orderedAt" timestamp DEFAULT now() NOT NULL,
	"packedAt" timestamp,
	"dispatchedAt" timestamp,
	"deliveredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_orderNumber_unique" UNIQUE("orderNumber")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_salesmanId_user_id_fk" FOREIGN KEY ("salesmanId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickerId_user_id_fk" FOREIGN KEY ("pickerId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_dispatcherId_user_id_fk" FOREIGN KEY ("dispatcherId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;