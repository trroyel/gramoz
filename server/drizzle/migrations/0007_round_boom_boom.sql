CREATE TYPE "public"."order_payment_status" AS ENUM('unpaid', 'initiated', 'paid', 'refunded', 'failed');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer'::text;--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('super_admin', 'admin', 'support', 'manager', 'customer');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer'::"public"."role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "order_payment_status" DEFAULT 'unpaid' NOT NULL;