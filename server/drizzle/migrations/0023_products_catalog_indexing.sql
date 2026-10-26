CREATE INDEX IF NOT EXISTS "idx_product_variants_product_id" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_active_created" ON "products" USING btree ("created_at" DESC) WHERE deleted_at IS NULL AND status = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_category_id" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_active_category" ON "products" USING btree ("category_id", "created_at" DESC) WHERE deleted_at IS NULL AND status = 'active';
