-- =============================================================================
-- Migration 0005: Performance indexes + data integrity constraints
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Missing indexes on high-traffic foreign key / filter columns
-- ─────────────────────────────────────────────────────────────────────────────

-- cart_items: fetched on every page load for logged-in users
CREATE INDEX IF NOT EXISTS idx_cart_items_user_id
  ON cart_items (user_id);

-- orders: fetched per user on dashboard + per admin listing
CREATE INDEX IF NOT EXISTS idx_orders_user_id
  ON orders (user_id);

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status);

-- order_items: fetched for every order detail view
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items (order_id);

-- payments: looked up by transaction_id on every IPN callback
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id
  ON payments (transaction_id);

-- inventory_transactions: queried per product for stock reports
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_id
  ON inventory_transactions (product_id);

-- notifications: fetched per user for the notification bell
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read
  ON notifications (user_id, is_read);

-- products: soft-delete filter + category browsing
CREATE INDEX IF NOT EXISTS idx_products_deleted_at
  ON products (deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_id
  ON products (category_id);

CREATE INDEX IF NOT EXISTS idx_products_status
  ON products (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Data integrity constraints
-- ─────────────────────────────────────────────────────────────────────────────

-- Prevent duplicate payment records for the same gateway transaction
ALTER TABLE payments
  ADD CONSTRAINT uq_payments_transaction_id
  UNIQUE (transaction_id);

-- Prevent duplicate cart rows for the same (user, product) pair
ALTER TABLE cart_items
  ADD CONSTRAINT uq_cart_items_user_product
  UNIQUE (user_id, product_id);
