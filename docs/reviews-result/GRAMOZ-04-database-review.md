# GRAMOZ-04: Database Architecture, Schema Integrity & Query Performance Review

**Project:** Gramoz E-Commerce Platform  
**Auditor:** Staff Database Architect & Production DBA  
**Scope:** PostgreSQL 16, Drizzle ORM Schema (20 Tables), Migration Pipeline, Indexing Strategy, and Pool Sizing  
**Date:** October 2026  
**Status:** Complete Audit  

---

## 1. Database Schema & Entity Relationship Overview

The Gramoz data model comprises **20 relation tables** managed via Drizzle ORM under [`server/src/database/schema/`](file:///home/trroyel/gramoz/server/src/database/schema/).

```
+----------------------------------------------------------------------------------------------------+
|                                    GRAMOZ ENTITY-RELATIONSHIP MAP                                   |
+----------------------------------------------------------------------------------------------------+
                                              +---------------+
                                              |     users     |
                                              +---------------+
                                                /     |     \
                                   +-----------+      |      +------------+
                                   |                  |                   |
                                   v                  v                   v
                            +-------------+    +--------------+    +--------------+
                            |  addresses  |    |  cart_items  |    | notifications|
                            +-------------+    +--------------+    +--------------+
                                   |                  |
                                   v                  v
                            +-------------+    +--------------+
                            |   orders    |    |   products   |<---+
                            +-------------+    +--------------+    |
                              /    |    \             |            |
                             /     |     \            v            |
                            v      v      v    +----------------+  |
                    +---------+ +-------+ +---+|product_variants|  |
                    |order_   | |pay-   | |re-|+----------------+  |
                    |items    | |ments  | |funds                   |
                    +---------+ +-------+ +---+                    |
                                                           +---------------+
                                                           |   reviews     |
                                                           +---------------+
```

### 1.1 Core Entity Schema Summary

| Table | Primary Key | Key Foreign Keys | Purpose | Financial / Integrity Types |
| :--- | :--- | :--- | :--- | :--- |
| `users` | UUID | None | Customer & staff identities | Argon2 hashes, platform roles enum |
| `products` | UUID | `category_id` -> `categories.id` | Base catalog products | `price numeric(10,2)`, `stock integer`, soft-delete `deletedAt` |
| `product_variants` | UUID | `product_id` -> `products.id` | SKU variations (color, size) | `price numeric(10,2)`, `stock integer`, attributes `jsonb` |
| `orders` | UUID | `user_id`, `shipping_address_id`, `promo_id` | Master order headers | `total_amount numeric(10,2)`, `delivery_charge numeric(10,2)` |
| `order_items` | UUID | `order_id`, `product_id`, `variant_id` | Order line items | `unit_price numeric(10,2)`, `quantity integer` |
| `payments` | UUID | `order_id` -> `orders.id` | Gateway transaction logs | `amount numeric(10,2)`, `transaction_id unique`, `gateway_response jsonb` |
| `refunds` | UUID | `order_id`, `payment_id`, `requested_by` | Return & refund requests | `amount numeric(10,2)`, reason enum, status enum |
| `inventory_transactions`| UUID | `product_id` -> `products.id` | Double-entry stock ledger | `quantity integer`, `type ('in', 'out', 'adjustment')` |
| `outbox_events` | UUID | None | Transactional outbox queue | `payload jsonb`, `status enum`, `attempts integer` |

---

## 2. Indexing Strategy & Query Performance Audit

### 2.1 Existing Performance Indexes (Migration `0005`)

Inspection of [`0005_performance_and_integrity.sql`](file:///home/trroyel/gramoz/server/drizzle/migrations/0005_performance_and_integrity.sql) confirms standard indexes for high-traffic FKs:
- `idx_cart_items_user_id` on `cart_items(user_id)`
- `idx_orders_user_id` on `orders(user_id)`
- `idx_orders_status` on `orders(status)`
- `idx_order_items_order_id` on `order_items(order_id)`
- `idx_payments_transaction_id` on `payments(transaction_id)`
- `idx_inventory_transactions_product_id` on `inventory_transactions(product_id)`
- `idx_notifications_user_id_is_read` on `notifications(user_id, is_read)`
- `idx_products_deleted_at` on `products(deleted_at) WHERE deleted_at IS NULL` (Partial Index)
- `idx_products_category_id` on `products(category_id)`

---

### 2.2 P1 - HIGH: Missing Critical Indexes on High-Frequency Workloads

#### 1. Outbox Processor Table Scan:
- **Query Executed Every 30 Seconds** ([`outbox.processor.ts:49-65`](file:///home/trroyel/gramoz/server/src/modules/orders/outbox.processor.ts#L49-L65)):
  ```sql
  SELECT id FROM outbox_events
  WHERE status = 'pending' AND attempts < 3
  ORDER BY created_at ASC
  LIMIT 10
  FOR UPDATE SKIP LOCKED;
  ```
- **Current Index Status:** None.
- **Performance Impact:** As historical outbox events accumulate (tens of thousands over months), PostgreSQL must perform a full sequential scan of `outbox_events` every 30 seconds to filter `status = 'pending'`.
- **Required Index:**
  ```sql
  CREATE INDEX idx_outbox_events_pending_claim
    ON outbox_events (created_at ASC)
    WHERE status = 'pending' AND attempts < 3;
  ```
  *(A partial B-tree index on `created_at` containing only uncompleted events keeps the index size near zero and ensures instant index scans).*

#### 2. Review Aggregation Correlated Subquery:
- **Query Executed on Catalog Browse** ([`products.service.ts:178`](file:///home/trroyel/gramoz/server/src/modules/products/products.service.ts#L178)):
  ```sql
  SELECT AVG(rating) FROM reviews WHERE product_id = :id AND status = 'approved';
  ```
- **Current Index Status:** No composite index on `reviews(product_id, status)`.
- **Performance Impact:** Causes repeated index or sequential scans across the reviews table for each product row on every catalog browse request.
- **Required Index:**
  ```sql
  CREATE INDEX idx_reviews_product_approved_rating
    ON reviews (product_id, rating)
    WHERE status = 'approved';
  ```

#### 3. Cart Deduplication Composite Index:
- **Current Status:** No database index prevents duplicate cart additions for the same user, product, and variant.
- **Required Index:**
  ```sql
  CREATE UNIQUE INDEX uq_cart_items_user_product_variant
    ON cart_items (user_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
  ```

---

## 3. Migration Pipeline & Schema Evolution Audit

### 3.1 P0 - CRITICAL: Conflicting DROP INDEX in Migration `0013`

#### Code Evidence:
1. In [`0005_performance_and_integrity.sql:60-62`](file:///home/trroyel/gramoz/server/drizzle/migrations/0005_performance_and_integrity.sql#L60-L62):
   ```sql
   ALTER TABLE cart_items
     ADD CONSTRAINT uq_cart_items_user_product
     UNIQUE (user_id, product_id);
   ```
2. In [`0013_flaky_puppet_master.sql:1`](file:///home/trroyel/gramoz/server/drizzle/migrations/0013_flaky_puppet_master.sql#L1):
   ```sql
   DROP INDEX "uq_cart_items_user_product";--> statement-breakpoint
   ALTER TABLE "cart_items" ADD COLUMN "variant_id" uuid;
   ```

#### Defect Analysis:
- In PostgreSQL, when a unique constraint is created via `ALTER TABLE ADD CONSTRAINT ... UNIQUE`, Postgres automatically generates an underlying index with the same name.
- If an automated migration tool runs `DROP INDEX "uq_cart_items_user_product"`, PostgreSQL **refuses to execute the command**:
  ```
  ERROR: cannot drop index uq_cart_items_user_product because constraint uq_cart_items_user_product on table cart_items requires it
  HINT: You can drop constraint uq_cart_items_user_product on table cart_items instead.
  ```
- **Production Consequence:** Running fresh database migrations (`drizzle-kit migrate` or startup migrations) on a clean database cluster aborts at migration `0013`, failing deployment.

#### Remediation:
Modify migration `0013_flaky_puppet_master.sql` (or provide an idempotent migration script):
```sql
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "uq_cart_items_user_product";
DROP INDEX IF EXISTS "uq_cart_items_user_product";
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" uuid;
```

---

## 4. Connection Pool & Transaction Management

### 4.1 Connection Pool Sizing (`server/src/database/database.module.ts`)

```typescript
const pool = new Pool({
  connectionString,
  max: config.dbPoolMax,        // Default: 20
  min: config.dbPoolMin,        // Default: 2
  idleTimeoutMillis: 30000,     // 30 seconds
  connectionTimeoutMillis: 5000,// 5 seconds
});
```

#### Evaluation:
1. **Pool Capacity:** A max pool of 20 connections is suitable for low-to-medium traffic on a single Node.js instance.
2. **Exhaustion Risk Under Multi-Pod Scaling:** If 4 backend replicas run concurrently, total pool demand is `4 * 20 = 80` connections. PostgreSQL default `max_connections` is typically 100, leaving very little headroom for background processors, migrations, or administrative connections.
3. **P1 - High: Long-Running External Logic Inside Database Transaction:**
   - In [`orders.service.ts:124`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L124):
     ```typescript
     const result = await this.ordersStore.runTransaction(async (tx) => {
       ...
       let deliveryCharge = 0;
       if (dto.zoneId && dto.deliveryMethod) {
         const totalWeight = cartItems.length * 0.5;
         const calc = await this.courierService.calculateCharge(dto.zoneId, dto.deliveryMethod, totalWeight);
         deliveryCharge = calc.charge;
       }
       ...
     ```
   - While `calculateCharge` currently performs a local DB lookup, placing courier rate calculation inside the write transaction holds open an active PostgreSQL transaction lock longer than necessary.
   - **Remediation:** Calculate delivery fees and promo discounts *prior* to opening the write transaction `ordersStore.runTransaction`.

---

## 5. Financial Data Integrity & Decimal Precision

1. **Floating Point Safety:**
   - Currency values (`price`, `total_amount`, `discount_amount`, `delivery_charge`) are strictly mapped to `decimal({ precision: 10, scale: 2 })` or `numeric(10, 2)` in PostgreSQL schema definitions.
   - In [`orders.service.ts:40-46`](file:///home/trroyel/gramoz/server/src/modules/orders/orders.service.ts#L40-L46), subtotals are computed by converting prices to cents (`Math.round(parseFloat(priceStr) * 100)`), completely preventing binary floating-point rounding errors (e.g., `0.1 + 0.2 = 0.30000000000000004`).
2. **Audit Trails:**
   - The `inventory_transactions` table logs every unit entry, deduction, and adjustment, linking directly to `order_id` or `refund_id`.

---

## 6. Database Remediation Priority Plan

| Priority | Issue | Component | Remediation |
| :--- | :--- | :--- | :--- |
| **P0** | Migration `0013` `DROP INDEX` on constraint | Migration 0013 | Replace `DROP INDEX` with `ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS`. |
| **P1** | Full table scan on `outbox_events` | `outbox_events` table | Add partial B-tree index `WHERE status = 'pending' AND attempts < 3`. |
| **P1** | Missing unique index on cart items | `cart_items` table | Add composite unique index on user, product, variant. |
| **P2** | Reviews correlated subquery performance | `reviews` table | Add composite index `(product_id, rating) WHERE status = 'approved'`. |
| **P2** | Pre-transaction calculation decoupling | `orders.service.ts` | Move `calculateCharge` outside `ordersStore.runTransaction`. |
