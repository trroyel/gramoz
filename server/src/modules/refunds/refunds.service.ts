import {
  Injectable,
  Inject,
} from '@nestjs/common';
import { EntityNotFoundError, InvalidOperationError, ForbiddenOperationError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

export type RefundReason =
  | 'damaged_item'
  | 'wrong_item'
  | 'not_received'
  | 'quality_issue'
  | 'changed_mind'
  | 'other';

export interface RequestRefundDto {
  orderId: string;
  paymentId?: string;
  amount: number;
  reason: RefundReason;
  notes?: string;
}

export interface ProcessRefundDto {
  status: 'approved' | 'processed' | 'rejected';
  adminNotes?: string;
  gatewayRefundId?: string;
}

@Injectable()
export class RefundsService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Customer requests a refund for a delivered/completed order.
   * Only allowed if: order exists, belongs to user, and order is delivered.
   * One refund per order — prevents duplicate requests.
   */
  async requestRefund(userId: string, dto: RequestRefundDto) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, dto.orderId));

    if (!order) throw new EntityNotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenOperationError('You can only request a refund for your own orders');

    // Only delivered/shipped orders can be refunded
    if (!['delivered', 'shipped'].includes(order.status)) {
      throw new InvalidOperationError('Refunds can only be requested for delivered orders');
    }

    // Prevent duplicate refund requests
    const [existing] = await this.db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, dto.orderId));

    if (existing) {
      throw new InvalidOperationError('A refund request already exists for this order');
    }

    // Validate refund amount does not exceed the order total
    if (dto.amount > parseFloat(order.totalAmount)) {
      throw new InvalidOperationError(
        `Refund amount (${dto.amount}) cannot exceed order total (${order.totalAmount})`,
      );
    }

    const [refund] = await this.db
      .insert(schema.refunds)
      .values({
        orderId: dto.orderId,
        paymentId: dto.paymentId,
        requestedBy: userId,
        amount: dto.amount.toFixed(2),
        reason: dto.reason,
        notes: dto.notes,
        status: 'requested',
      })
      .returning();

    return refund;
  }

  /**
   * Admin: list all refund requests with order and customer info.
   */
  async getAllRefunds(status?: schema.Refund['status'], page = 1, limit = 20) {
    const offset = (Math.max(1, page) - 1) * Math.min(100, limit);

    const query = this.db
      .select({
        id: schema.refunds.id,
        amount: schema.refunds.amount,
        reason: schema.refunds.reason,
        status: schema.refunds.status,
        notes: schema.refunds.notes,
        adminNotes: schema.refunds.adminNotes,
        createdAt: schema.refunds.createdAt,
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
      return query.where(eq(schema.refunds.status, status));
    }

    return query;
  }

  /**
   * Admin: get a single refund with full details.
   */
  async getRefundById(id: string) {
    const [refund] = await this.db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id));

    if (!refund) throw new EntityNotFoundError('Refund not found');
    return refund;
  }

  /**
   * Admin: approve, process, or reject a refund request.
   * When status = 'processed', also marks the linked payment as 'refunded'.
   */
  async processRefund(
    adminId: string,
    refundId: string,
    dto: ProcessRefundDto,
  ) {
    const [refund] = await this.db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refundId));

    if (!refund) throw new EntityNotFoundError('Refund not found');

    if (refund.status === 'processed' || refund.status === 'rejected') {
      throw new InvalidOperationError('Refund request has already been processed');
    }

    return await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.refunds)
        .set({
          status: dto.status,
          adminNotes: dto.adminNotes,
          gatewayRefundId: dto.gatewayRefundId,
          processedBy: adminId,
          updatedAt: new Date(),
        })
        .where(eq(schema.refunds.id, refundId))
        .returning();

      // When the refund is marked processed, update both payment and order status atomically
      if (dto.status === 'processed') {
        if (refund.paymentId) {
          await tx
            .update(schema.payments)
            .set({ status: 'refunded', updatedAt: new Date() })
            .where(eq(schema.payments.id, refund.paymentId));
        }

        // Always mark the order's payment status as refunded
        await tx
          .update(schema.orders)
          .set({ paymentStatus: 'refunded', updatedAt: new Date() })
          .where(eq(schema.orders.id, refund.orderId));
      }

      return updated;
    });
  }

  /**
   * Customer: get their own refund requests.
   */
  async getMyRefunds(userId: string) {
    return this.db
      .select({
        id: schema.refunds.id,
        orderId: schema.refunds.orderId,
        amount: schema.refunds.amount,
        reason: schema.refunds.reason,
        status: schema.refunds.status,
        notes: schema.refunds.notes,
        adminNotes: schema.refunds.adminNotes,
        createdAt: schema.refunds.createdAt,
      })
      .from(schema.refunds)
      .where(eq(schema.refunds.requestedBy, userId))
      .orderBy(desc(schema.refunds.createdAt));
  }
}
