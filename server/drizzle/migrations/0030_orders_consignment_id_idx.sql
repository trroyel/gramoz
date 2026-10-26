-- Migration 0030: Add index on orders(consignment_id) for courier tracking and reconciliation (TASK-24)
CREATE INDEX IF NOT EXISTS "orders_consignment_id_idx"
ON "orders" ("consignment_id")
WHERE "consignment_id" IS NOT NULL;
