/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, or, isNull, gt, desc, sql, inArray } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

export type DbTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>['transaction']>[0]
>[0];
export type DbExecutor = NodePgDatabase<typeof schema> | DbTransaction;

export interface OrderCartItem {
  id: string;
  productId: string;
  quantity: number;
  productPrice: string | null;
  productStock: number | null;
  productName: string | null;
  variantId: string | null;
  variantPrice: string | null;
  variantStock: number | null;
  variantAttributes: Record<string, any> | null;
}

@Injectable()
export class OrdersStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async runTransaction<T>(cb: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return await this.db.transaction(cb);
  }

  // --- Cart ---
  async getCartItemsWithProducts(
    userId: string,
    tx?: DbExecutor,
  ): Promise<OrderCartItem[]> {
    const executor = tx || this.db;
    const items = await executor
      .select({
        id: schema.cartItems.id,
        productId: schema.cartItems.productId,
        quantity: schema.cartItems.quantity,
        productPrice: schema.products.price,
        productStock: schema.products.stock,
        productName: schema.products.name,
        variantId: schema.cartItems.variantId,
        variantPrice: schema.productVariants.price,
        variantStock: schema.productVariants.stock,
        variantAttributes: schema.productVariants.attributes,
      })
      .from(schema.cartItems)
      .leftJoin(
        schema.products,
        eq(schema.cartItems.productId, schema.products.id),
      )
      .leftJoin(
        schema.productVariants,
        eq(schema.cartItems.variantId, schema.productVariants.id),
      )
      .where(eq(schema.cartItems.userId, userId));
    return items as OrderCartItem[];
  }

  async getCartItemsCount(userId: string, tx?: any): Promise<number> {
    const executor = tx || this.db;
    const [result] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));
    return result?.count ?? 0;
  }

  async acquireUserCheckoutLock(userId: string, tx: any): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('checkout_' || ${userId}))`,
    );
  }

  async deleteCartItemsByUserId(userId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));
  }

  async deleteCartItemsByIds(
    cartItemIds: string[],
    userId: string,
    tx?: any,
  ): Promise<void> {
    if (cartItemIds.length === 0) return;
    const executor = tx || this.db;
    await executor
      .delete(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.userId, userId),
          inArray(schema.cartItems.id, cartItemIds),
        ),
      );
  }

  // --- Idempotency ---
  async findIdempotencyKey(
    userId: string,
    key: string,
    tx?: any,
  ): Promise<schema.IdempotencyKey | null> {
    const executor = tx || this.db;
    const [existing] = await executor
      .select()
      .from(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.userId, userId),
          eq(schema.idempotencyKeys.key, key),
        ),
      )
      .limit(1);
    return existing || null;
  }

  async findIdempotencyKeyForUpdate(
    userId: string,
    key: string,
    tx: any,
  ): Promise<schema.IdempotencyKey | null> {
    const [existing] = await tx
      .select()
      .from(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.userId, userId),
          eq(schema.idempotencyKeys.key, key),
        ),
      )
      .for('update')
      .limit(1);
    return existing || null;
  }

  async createIdempotencyKey(
    data: typeof schema.idempotencyKeys.$inferInsert,
    tx?: any,
  ): Promise<schema.IdempotencyKey> {
    const executor = tx || this.db;
    const [record] = await executor
      .insert(schema.idempotencyKeys)
      .values(data)
      .returning();
    return record;
  }

  async updateIdempotencyKey(
    id: string,
    data: Partial<typeof schema.idempotencyKeys.$inferInsert>,
    tx?: any,
  ): Promise<schema.IdempotencyKey | null> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.idempotencyKeys)
      .set(data)
      .where(eq(schema.idempotencyKeys.id, id))
      .returning();
    return updated || null;
  }

  // --- Addresses ---
  async findAddress(
    userId: string,
    addressLine1: string,
    city: string,
    tx?: any,
  ): Promise<schema.Address | null> {
    const executor = tx || this.db;
    const [existingAddress] = await executor
      .select()
      .from(schema.addresses)
      .where(
        and(
          eq(schema.addresses.userId, userId),
          eq(schema.addresses.addressLine1, addressLine1),
          eq(schema.addresses.city, city),
        ),
      )
      .limit(1);
    return existingAddress || null;
  }

  async createAddress(
    data: typeof schema.addresses.$inferInsert,
    tx?: any,
  ): Promise<schema.Address> {
    const executor = tx || this.db;
    const [address] = await executor
      .insert(schema.addresses)
      .values(data)
      .returning();
    return address;
  }

  /** Backfills zoneId on an existing address that was saved before this column existed. */
  async updateAddressZone(
    addressId: string,
    zoneId: string,
    tx?: any,
  ): Promise<schema.Address> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.addresses)
      .set({ zoneId, updatedAt: new Date() })
      .where(eq(schema.addresses.id, addressId))
      .returning();
    return updated;
  }

  // --- Orders & Items ---
  async createOrder(
    data: typeof schema.orders.$inferInsert,
    tx?: any,
  ): Promise<schema.Order> {
    const executor = tx || this.db;
    const [order] = await executor
      .insert(schema.orders)
      .values(data)
      .returning();
    return order;
  }

  async createOrderItem(
    data: typeof schema.orderItems.$inferInsert,
    tx?: any,
  ): Promise<schema.OrderItem> {
    const executor = tx || this.db;
    const [orderItem] = await executor
      .insert(schema.orderItems)
      .values(data)
      .returning();
    return orderItem;
  }

  async createOrderItems(
    data: (typeof schema.orderItems.$inferInsert)[],
    tx?: any,
  ): Promise<schema.OrderItem[]> {
    if (data.length === 0) return [];
    const executor = tx || this.db;
    const items = await executor
      .insert(schema.orderItems)
      .values(data)
      .returning();
    return items;
  }

  // --- Products & Inventory ---
  async deductProductStock(
    productId: string,
    quantity: number,
    tx?: any,
  ): Promise<boolean> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.products)
      .set({
        stock: sql`${schema.products.stock} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.products.id, productId),
          sql`${schema.products.stock} >= ${quantity}`,
        ),
      )
      .returning({ stock: schema.products.stock });

    return !!updated;
  }

  async deductVariantStock(
    variantId: string,
    quantity: number,
    tx?: any,
  ): Promise<boolean> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.productVariants)
      .set({
        stock: sql`${schema.productVariants.stock} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.productVariants.id, variantId),
          sql`${schema.productVariants.stock} >= ${quantity}`,
        ),
      )
      .returning({ stock: schema.productVariants.stock });

    return !!updated;
  }

  async createInventoryTransaction(
    data: typeof schema.inventoryTransactions.$inferInsert,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor.insert(schema.inventoryTransactions).values(data);
  }

  async createInventoryTransactions(
    data: (typeof schema.inventoryTransactions.$inferInsert)[],
    tx?: any,
  ): Promise<void> {
    if (data.length === 0) return;
    const executor = tx || this.db;
    await executor.insert(schema.inventoryTransactions).values(data);
  }

  // --- Promos ---
  async incrementPromoUsage(promoId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [updatedPromo] = await executor
      .update(schema.promos)
      .set({
        currentUses: sql`${schema.promos.currentUses} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.promos.id, promoId),
          eq(schema.promos.isActive, true),
          or(
            isNull(schema.promos.expiresAt),
            gt(schema.promos.expiresAt, new Date()),
          ),
          sql`(${schema.promos.maxUses} IS NULL OR ${schema.promos.currentUses} < ${schema.promos.maxUses})`,
        ),
      )
      .returning({ id: schema.promos.id });

    return !!updatedPromo;
  }

  // --- Users ---
  async getUserBasicInfo(
    userId: string,
    tx?: any,
  ): Promise<{ email: string; fullName: string; phone: string | null } | null> {
    const executor = tx || this.db;
    const [user] = await executor
      .select({
        email: schema.users.email,
        fullName: schema.users.fullName,
        phone: schema.users.phone,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user || null;
  }

  // --- Outbox ---
  async createOutboxEvent(
    data: typeof schema.outboxEvents.$inferInsert,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor.insert(schema.outboxEvents).values(data);
  }

  async createOutboxEvents(
    data: (typeof schema.outboxEvents.$inferInsert)[],
    tx?: any,
  ): Promise<void> {
    if (data.length === 0) return;
    const executor = tx || this.db;
    await executor.insert(schema.outboxEvents).values(data);
  }

  // --- Complex Queries ---
  async getUserOrdersWithPayments(
    userId: string,
    limit: number,
    offset: number,
  ) {
    const ordersWithPayments = await this.db.query.orders.findMany({
      where: eq(schema.orders.userId, userId),
      orderBy: [desc(schema.orders.createdAt)],
      limit,
      offset,
      with: {
        payments: {
          orderBy: [desc(schema.payments.createdAt)],
          limit: 1,
        },
      },
    });
    return ordersWithPayments;
  }

  async getOrderDetailsWithPayments(userId: string, orderId: string) {
    const order = await this.db.query.orders.findFirst({
      where: and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.userId, userId),
      ),
      with: {
        payments: {
          orderBy: [desc(schema.payments.createdAt)],
          limit: 1,
        },
      },
    });
    return order || null;
  }

  async getOrderItemsWithProducts(orderId: string) {
    return await this.db
      .select({
        id: schema.orderItems.id,
        productId: schema.orderItems.productId,
        variantId: schema.orderItems.variantId,
        variantAttributes: schema.orderItems.variantAttributes,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
        productImages: schema.products.images,
        variantImage: schema.productVariants.imageUrl,
      })
      .from(schema.orderItems)
      .leftJoin(
        schema.products,
        eq(schema.orderItems.productId, schema.products.id),
      )
      .leftJoin(
        schema.productVariants,
        eq(schema.orderItems.variantId, schema.productVariants.id),
      )
      .where(eq(schema.orderItems.orderId, orderId));
  }

  async getOrderDetailsAsAdmin(orderId: string) {
    const [order] = await this.db
      .select({
        id: schema.orders.id,
        totalAmount: schema.orders.totalAmount,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
        consignmentId: schema.orders.consignmentId,
        trackingUrl: schema.orders.trackingUrl,
        customerName: schema.users.fullName,
        customerEmail: schema.users.email,
        customerPhone: schema.users.phone,
        addressLine1: schema.addresses.addressLine1,
        city: schema.addresses.city,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .leftJoin(
        schema.addresses,
        eq(schema.orders.shippingAddressId, schema.addresses.id),
      )
      .where(eq(schema.orders.id, orderId));
    if (order && order.consignmentId === 'PENDING_DISPATCH') {
      order.consignmentId = null;
    }
    return order || null;
  }

  async getLatestPaymentByOrderId(orderId: string) {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    return payment || null;
  }

  async getAllOrdersWithRelationsAsAdmin(limit: number, offset: number) {
    return await this.db.query.orders.findMany({
      orderBy: [desc(schema.orders.createdAt)],
      limit,
      offset,
      with: {
        user: {
          columns: {
            fullName: true,
          },
        },
        payments: {
          orderBy: [desc(schema.payments.createdAt)],
          limit: 1,
        },
      },
    });
  }

  async updateOrderStatus(
    id: string,
    status: string,
    tx?: any,
  ): Promise<schema.Order | null> {
    const executor = tx || this.db;
    const [order] = await executor
      .update(schema.orders)
      .set({
        status: status as schema.Order['status'],
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id))
      .returning();
    return order || null;
  }

  // --- Cancellation, Restocking & Expiry (TASK-03) ---

  async findOrderById(orderId: string, tx?: any): Promise<schema.Order | null> {
    const executor = tx || this.db;
    const [order] = await executor
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    return order || null;
  }

  async findOrderByIdForUpdate(
    orderId: string,
    tx?: any,
  ): Promise<schema.Order | null> {
    const executor = tx || this.db;
    const [order] = await executor
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .for('update');
    return order || null;
  }

  async restoreProductStock(
    productId: string,
    quantity: number,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .update(schema.products)
      .set({
        stock: sql`${schema.products.stock} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.products.id, productId));
  }

  async restoreVariantStock(
    variantId: string,
    quantity: number,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .update(schema.productVariants)
      .set({
        stock: sql`${schema.productVariants.stock} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.productVariants.id, variantId));
  }

  async decrementPromoUsage(promoId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .update(schema.promos)
      .set({
        currentUses: sql`GREATEST(0, ${schema.promos.currentUses} - 1)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.promos.id, promoId),
          sql`${schema.promos.currentUses} > 0`,
        ),
      );
  }

  async getPointsSpentOnOrder(orderId: string, tx?: any): Promise<number> {
    const executor = tx || this.db;
    const [result] = await executor
      .select({
        total: sql<string>`COALESCE(SUM(${schema.loyaltyPoints.points}), 0)`,
      })
      .from(schema.loyaltyPoints)
      .where(
        and(
          eq(schema.loyaltyPoints.referenceId, orderId),
          eq(schema.loyaltyPoints.type, 'spent_checkout'),
        ),
      );
    // points in spent_checkout is negative, Math.abs yields the positive spent quantity
    return Math.abs(parseInt(result?.total || '0', 10));
  }

  async hasPointsBeenRefunded(orderId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [result] = await executor
      .select({ count: sql<string>`count(*)` })
      .from(schema.loyaltyPoints)
      .where(
        and(
          eq(schema.loyaltyPoints.referenceId, orderId),
          eq(schema.loyaltyPoints.type, 'admin_adjustment'),
          sql`${schema.loyaltyPoints.points} > 0`,
        ),
      );
    return parseInt(result?.count || '0', 10) > 0;
  }

  async getOrderItemsForRestock(
    orderId: string,
    tx?: any,
  ): Promise<
    Array<{
      id: string;
      productId: string;
      variantId: string | null;
      quantity: number;
    }>
  > {
    const executor = tx || this.db;
    return await executor
      .select({
        id: schema.orderItems.id,
        productId: schema.orderItems.productId,
        variantId: schema.orderItems.variantId,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
  }

  /**
   * Conditionally and atomically transitions an order status to 'cancelled'
   * ONLY IF its current status is 'pending' or 'processing'.
   * Returns the updated order row if successful, or null if the order was not eligible
   * (e.g. already cancelled, shipped, or nonexistent).
   */
  async transitionOrderStatusForCancellation(
    orderId: string,
    tx?: any,
  ): Promise<schema.Order | null> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.orders)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.orders.id, orderId),
          sql`${schema.orders.status} IN ('pending', 'processing')`,
        ),
      )
      .returning();
    return updated || null;
  }

  async failPendingPaymentsForOrder(orderId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .update(schema.payments)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.payments.orderId, orderId),
          eq(schema.payments.status, 'pending'),
        ),
      );
  }

  /**
   * Identifies stale pending orders eligible for automated checkout expiry.
   * Excludes:
   *  - COD orders (which are fulfilled and collected on delivery)
   *  - Paid orders
   *  - Active in-flight payment sessions updated within buffer period
   * Locks candidates using FOR UPDATE SKIP LOCKED to prevent multi-instance race conditions.
   */
  async findStaleUnpaidOrdersForExpiry(
    expiryMinutes: number,
    inFlightBufferMinutes = 15,
    tx?: any,
  ): Promise<Array<{ id: string }>> {
    const executor = tx || this.db;
    const result: any = await executor.execute(sql`
      SELECT o.id
      FROM orders o
      WHERE o.status = 'pending'
        AND o.created_at < NOW() - (INTERVAL '1 minute' * ${expiryMinutes})
        AND o.payment_status != 'paid'
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.order_id = o.id
            AND p.method = 'COD'
        )
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.order_id = o.id
            AND p.status = 'pending'
            AND p.updated_at >= NOW() - (INTERVAL '1 minute' * ${inFlightBufferMinutes})
        )
      ORDER BY o.created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED;
    `);
    return result.rows;
  }
}
