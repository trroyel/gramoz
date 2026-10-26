CREATE INDEX IF NOT EXISTS "idx_reviews_product_approved_rating" ON "reviews" USING btree ("product_id","rating") WHERE status = 'approved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reviews_product_approved_created" ON "reviews" USING btree ("product_id","created_at" DESC) WHERE status = 'approved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reviews_status_created_at" ON "reviews" USING btree ("status","created_at" DESC);
