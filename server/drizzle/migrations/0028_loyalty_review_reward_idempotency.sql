-- Migration 0028: Enforce Review Loyalty Reward Idempotency at Database Level (TASK-23F)
-- Prevents duplicate review points for the same purchase (order_item) across concurrent requests
-- or repeated review deletion/recreation cycles.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_loyalty_points_review_reward_unique"
ON "loyalty_points" ("reference_id")
WHERE "type" IN ('earned_review_text', 'earned_review_media') AND "reference_id" IS NOT NULL;
