import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc, and } from 'drizzle-orm';
import * as schema from '@database/schema';
import { DATABASE } from '@database/database.module';

@Injectable()
export class PaymentsStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async runTransaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return await this.db.transaction(cb);
  }

  // --- Orders --- (Ideally in OrdersStore, but keeping here to prevent over-engineering for now)

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

  // --- Users --- (Ideally in UsersStore)

  async findUserById(userId: string, tx?: any): Promise<schema.User | null> {
    const executor = tx || this.db;
    const [user] = await executor
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user || null;
  }

  // --- Payments ---

  async findLatestPaymentByOrderId(
    orderId: string,
    tx?: any,
  ): Promise<schema.Payment | null> {
    const executor = tx || this.db;
    const [payment] = await executor
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    return payment || null;
  }

  async findLatestPendingPaymentByOrderId(
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
          eq(schema.payments.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    return payment || null;
  }

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

  async findPaymentByTransactionId(
    tranId: string,
    tx?: any,
  ): Promise<schema.Payment | null> {
    const executor = tx || this.db;
    const [payment] = await executor
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, tranId));
    return payment || null;
  }

  async findPaymentByTransactionIdForUpdate(
    tranId: string,
    tx: any,
  ): Promise<schema.Payment | null> {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.transactionId, tranId))
      .for('update');
    return payment || null;
  }

  async createOutboxEvent(
    data: typeof schema.outboxEvents.$inferInsert,
    tx?: any,
  ): Promise<void> {
    const executor = tx || this.db;
    await executor.insert(schema.outboxEvents).values(data);
  }

  async createPayment(
    data: typeof schema.payments.$inferInsert,
    tx?: any,
  ): Promise<schema.Payment> {
    const executor = tx || this.db;
    const [payment] = await executor
      .insert(schema.payments)
      .values(data)
      .returning();
    return payment;
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
}
