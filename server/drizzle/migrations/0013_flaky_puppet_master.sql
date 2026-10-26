ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "uq_cart_items_user_product";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_cart_items_user_product";--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" uuid;