-- =============================================================================
-- Migration 0006: Refunds table
-- =============================================================================

-- Enum types for refund status and reason
CREATE TYPE refund_status AS ENUM (
  'requested',
  'approved',
  'processed',
  'rejected'
);

CREATE TYPE refund_reason AS ENUM (
  'damaged_item',
  'wrong_item',
  'not_received',
  'quality_issue',
  'changed_mind',
  'other'
);

-- Main refunds table
CREATE TABLE IF NOT EXISTS refunds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id        UUID REFERENCES payments(id),
  requested_by      UUID NOT NULL REFERENCES users(id),
  processed_by      UUID REFERENCES users(id),

  amount            DECIMAL(10, 2) NOT NULL,
  reason            refund_reason NOT NULL,
  notes             TEXT,                    -- Customer's description
  admin_notes       TEXT,                    -- Internal admin notes
  status            refund_status NOT NULL DEFAULT 'requested',

  -- Gateway refund transaction reference (SSLCommerz, etc.)
  gateway_refund_id VARCHAR(255),

  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for fast admin lookups
CREATE INDEX IF NOT EXISTS idx_refunds_order_id     ON refunds (order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status       ON refunds (status);
CREATE INDEX IF NOT EXISTS idx_refunds_requested_by ON refunds (requested_by);
