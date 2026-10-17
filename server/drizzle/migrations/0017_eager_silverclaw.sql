ALTER TYPE "public"."order_status" ADD VALUE 'out_for_delivery' BEFORE 'delivered';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;