-- TASK-22F: Refunds Idempotency Claim & Active Refund Uniqueness
-- 1. Add 'processing' state to refund_status enum for atomic in-flight claim before external network I/O
ALTER TYPE "public"."refund_status" ADD VALUE IF NOT EXISTS 'processing' AFTER 'approved';

-- 2. Update uq_refunds_order_id to be a partial unique index allowing rejected requests to be re-submitted
DROP INDEX IF EXISTS uq_refunds_order_id;
CREATE UNIQUE INDEX uq_refunds_order_id ON refunds (order_id) WHERE status != 'rejected';
