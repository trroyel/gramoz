DROP INDEX "uq_cart_items_user_product";--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "variant_id" uuid;