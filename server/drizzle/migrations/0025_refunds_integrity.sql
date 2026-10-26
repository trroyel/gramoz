-- Migration 0025: Refunds table integrity, unique order index, and payment lookup index
DROP INDEX IF EXISTS "idx_refunds_order_id";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_refunds_order_id" ON "refunds" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_refunds_payment_id" ON "refunds" ("payment_id");
