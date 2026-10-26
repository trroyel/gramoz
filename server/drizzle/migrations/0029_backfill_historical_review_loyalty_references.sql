-- Migration 0029: Backfill Historical Review Loyalty References to Stable Order Items (TASK-23G)
-- Maps legacy loyalty_points records where reference_id was set to review.id
-- to the stable order_items.id representing the purchased product entitlement.
-- Fully idempotent and safe against duplicate conflicts.
--
-- Canonical purchase identity (TASK-26): a review entitles ONE reward per (order, product).
-- The canonical order item is the LOWEST order_items.id for that (order, product); the runtime
-- (ReviewsService.submitReview) selects the same item, so reward deduplication after review
-- deletion/recreation is keyed on an identical value. A second historical reward for the same
-- review (e.g. legacy text + media) cannot also map to the canonical item (unique index
-- idx_loyalty_points_review_reward_unique) and intentionally keeps its legacy review.id reference.

WITH candidate_pairs AS (
  SELECT
    lp.id AS loyalty_point_id,
    oi.id AS order_item_id,
    ROW_NUMBER() OVER (
      PARTITION BY lp.id
      ORDER BY oi.id ASC
    ) AS lp_rn,
    ROW_NUMBER() OVER (
      PARTITION BY oi.id
      ORDER BY lp.created_at ASC, lp.id ASC
    ) AS oi_rn
  FROM loyalty_points lp
  JOIN reviews r ON lp.reference_id = r.id
  JOIN order_items oi ON oi.order_id = r.order_id AND oi.product_id = r.product_id
  WHERE lp.type IN ('earned_review_text', 'earned_review_media')
    AND NOT EXISTS (
      SELECT 1 FROM loyalty_points existing
      WHERE existing.reference_id = oi.id
        AND existing.type IN ('earned_review_text', 'earned_review_media')
        AND existing.id != lp.id
    )
),
mapped_items AS (
  SELECT loyalty_point_id, order_item_id
  FROM candidate_pairs
  WHERE lp_rn = 1 AND oi_rn = 1
)
UPDATE loyalty_points lp
SET reference_id = mi.order_item_id
FROM mapped_items mi
WHERE lp.id = mi.loyalty_point_id;
