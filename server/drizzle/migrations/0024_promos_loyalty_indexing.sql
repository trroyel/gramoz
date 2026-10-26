CREATE INDEX IF NOT EXISTS "idx_loyalty_points_user_id" ON "loyalty_points" USING btree ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_loyalty_points_reference_id" ON "loyalty_points" USING btree ("reference_id");
CREATE INDEX IF NOT EXISTS "idx_promos_active_expires" ON "promos" USING btree ("is_active", "expires_at");
