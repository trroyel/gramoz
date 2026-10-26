-- Migration 0027: Wishlists and Reviews Supporting Indexes for Cascades and User Queries
CREATE INDEX IF NOT EXISTS "idx_wishlists_product_id" ON "wishlists" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_wishlists_user_created" ON "wishlists" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_reviews_user_created" ON "reviews" ("user_id", "created_at" DESC);
