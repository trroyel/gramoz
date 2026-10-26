import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc, and, sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class RefundsStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async runTransaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return await this.db.transaction(cb);
  }

  // --- Refunds ---

  async findRefundById(id: string, tx?: any): Promise<schema.Refund | null> {
    const executor = tx || this.db;
    const [refund] = await executor
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id));
    return refund || null;
  }

  async findRefundByIdForUpdate(
    id: string,
    tx: any,
  ): Promise<schema.Refund | null> {
    const [refund] = await tx
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id))
      .for('update');
    return refund || null;
  }

  async findRefundByOrderId(
    orderId: string,
    tx?: any,
  ): Promise<schema.Refund | null> {
    const executor = tx || this.db;
    const [refund] = await executor
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, orderId));
    return refund || null;
  }

  async findActiveRefundByOrderId(
    orderId: string,
    tx?: any,
  ): Promise<schema.Refund | null> {
    const executor = tx || this.db;
    const [refund] = await executor
      .select()
      .from(schema.refunds)
      .where(
        and(
          eq(schema.refunds.orderId, orderId),
          sql`${schema.refunds.status} != 'rejected'`,
        ),
      );
    return refund || null;
  }

  async findRefundByOrderIdForUpdate(
    orderId: string,
    tx: any,
  ): Promise<schema.Refund | null> {
    const [refund] = await tx
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, orderId))
      .for('update');
    return refund || null;
  }

  async createRefund(data: schema.NewRefund, tx?: any): Promise<schema.Refund> {
    const executor = tx || this.db;
    const [refund] = await executor
      .insert(schema.refunds)
      .values(data)
      .returning();
    return refund;
  }

  async updateRefund(
    id: string,
    data: Partial<schema.NewRefund>,
    tx?: any,
  ): Promise<schema.Refund> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.refunds)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.refunds.id, id))
      .returning();
    return updated;
  }

  async getAllRefunds(
    status?: schema.Refund['status'],
    limit = 20,
    offset = 0,
  ): Promise<any[]> {
    const query = this.db
      .select({
        id: schema.refunds.id,
        amount: schema.refunds.amount,
        reason: schema.refunds.reason,
        status: schema.refunds.status,
        notes: schema.refunds.notes,
        adminNotes: schema.refunds.adminNotes,
        gatewayRefundId: schema.refunds.gatewayRefundId,
        createdAt: schema.refunds.createdAt,
        updatedAt: schema.refunds.updatedAt,
        orderId: schema.refunds.orderId,
        orderTotal: schema.orders.totalAmount,
        customerName: schema.users.fullName,
        customerEmail: schema.users.email,
      })
      .from(schema.refunds)
      .leftJoin(schema.orders, eq(schema.refunds.orderId, schema.orders.id))
      .leftJoin(schema.users, eq(schema.refunds.requestedBy, schema.users.id))
      .orderBy(desc(schema.refunds.createdAt))
      .limit(limit)
      .offset(offset);

    if (status) {
      return await query.where(eq(schema.refunds.status, status));
    }

    return await query;
  }

  async getMyRefunds(userId: string): Promise<any[]> {
    return await this.db
      .select({
        id: schema.refunds.id,
        orderId: schema.refunds.orderId,
        amount: schema.refunds.amount,
        reason: schema.refunds.reason,
        status: schema.refunds.status,
        notes: schema.refunds.notes,
        adminNotes: schema.refunds.adminNotes,
        gatewayRefundId: schema.refunds.gatewayRefundId,
        createdAt: schema.refunds.createdAt,
      })
      .from(schema.refunds)
      .where(eq(schema.refunds.requestedBy, userId))
      .orderBy(desc(schema.refunds.createdAt));
  }

  // --- Orders ---

  async findOrderById(orderId: string, tx?: any): Promise<schema.Order | null> {
    const executor = tx || this.db;
    const [order] = await executor
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    return order || null;
  }

  async findOrderByIdForUpdate(
    orderId: string,
    tx: any,
  ): Promise<schema.Order | null> {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .for('update');
    return order || null;
  }

  async updateOrderStatus(
    orderId: string,
    data: Partial<typeof schema.orders.$inferInsert>,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .update(schema.orders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));
  }

  // --- Payments ---

  async findPaymentById(
    paymentId: string,
    tx?: any,
  ): Promise<schema.Payment | null> {
    const executor = tx || this.db;
    const [payment] = await executor
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId));
    return payment || null;
  }

  async findPaymentByIdForUpdate(
    paymentId: string,
    tx: any,
  ): Promise<schema.Payment | null> {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
      .for('update');
    return payment || null;
  }

  async findCompletedPaymentByOrderId(
    orderId: string,
    tx?: any,
  ): Promise<schema.Payment | null> {
    const executor = tx || this.db;
    const [payment] = await executor
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, orderId),
          eq(schema.payments.status, 'completed'),
        ),
      )
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    return payment || null;
  }

  async updatePaymentStatus(
    paymentId: string,
    data: Partial<typeof schema.payments.$inferInsert>,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .update(schema.payments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.payments.id, paymentId));
  }

  // --- Order Items & Inventory ---

  async getOrderItems(orderId: string, tx?: any): Promise<schema.OrderItem[]> {
    const executor = tx || this.db;
    return await executor
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
  }

  async findVariantById(
    variantId: string,
    tx?: any,
  ): Promise<schema.ProductVariant | null> {
    const executor = tx || this.db;
    const [variant] = await executor
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variantId));
    return variant || null;
  }

  async restockVariant(
    variantId: string,
    quantity: number,
    tx: any,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE ${schema.productVariants} SET stock = stock + ${quantity} WHERE id = ${variantId}`,
    );
  }

  async restockProduct(
    productId: string,
    quantity: number,
    tx: any,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE ${schema.products} SET stock = stock + ${quantity} WHERE id = ${productId}`,
    );
  }

  async createInventoryTransaction(
    data: typeof schema.inventoryTransactions.$inferInsert,
    tx: any,
  ): Promise<void> {
    await tx.insert(schema.inventoryTransactions).values(data);
  }

  async hasOrderBeenRestocked(orderId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [result] = await executor
      .select({ count: sql<string>`count(*)` })
      .from(schema.inventoryTransactions)
      .where(
        and(
          eq(schema.inventoryTransactions.referenceId, orderId),
          eq(schema.inventoryTransactions.type, 'in'),
        ),
      );
    return parseInt(result?.count || '0', 10) > 0;
  }

  async hasRefundBeenRestocked(refundId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [result] = await executor
      .select({ count: sql<string>`count(*)` })
      .from(schema.inventoryTransactions)
      .where(
        and(
          eq(schema.inventoryTransactions.referenceId, refundId),
          eq(schema.inventoryTransactions.type, 'in'),
        ),
      );
    return parseInt(result?.count || '0', 10) > 0;
  }

  // --- Loyalty ---

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
}
