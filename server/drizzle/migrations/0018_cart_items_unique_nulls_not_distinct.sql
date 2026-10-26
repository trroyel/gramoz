-- Deduplicate existing cart_items if any exist, summing their quantities
WITH ranked AS (
  SELECT id, user_id, product_id, variant_id, quantity,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, product_id, variant_id
           ORDER BY created_at ASC
         ) as rn,
         SUM(quantity) OVER (
           PARTITION BY user_id, product_id, variant_id
         ) as aggregated_qty
  FROM "cart_items"
),
updated AS (
  UPDATE "cart_items" c
  SET quantity = r.aggregated_qty, updated_at = NOW()
  FROM ranked r
  WHERE c.id = r.id AND r.rn = 1 AND r.aggregated_qty > c.quantity
)
DELETE FROM "cart_items" c
USING ranked r
WHERE c.id = r.id AND r.rn > 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_cart_items_user_product_variant'
  ) THEN
    ALTER TABLE "cart_items"
    ADD CONSTRAINT "uq_cart_items_user_product_variant"
    UNIQUE NULLS NOT DISTINCT ("user_id", "product_id", "variant_id");
  END IF;
END $$;
