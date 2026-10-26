CREATE INDEX IF NOT EXISTS "idx_cart_items_abandoned" ON "cart_items" USING btree ("updated_at" ASC) WHERE abandoned_email_sent = false;
