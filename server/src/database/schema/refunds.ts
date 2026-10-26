import {
  decimal,
  index,
  uniqueIndex,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { orders } from './orders';
import { payments } from './payments';
import { users } from './users';

export const refundStatusEnum = pgEnum('refund_status', [
  'requested', // Customer has submitted a refund request
  'approved', // Admin has approved — awaiting processing
  'processing', // In-flight with gateway / awaiting settlement verification
  'processed', // Settled / money sent back to customer
  'rejected', // Admin or provider rejected the request
]);

export const refundReasonEnum = pgEnum('refund_reason', [
  'damaged_item',
  'wrong_item',
  'not_received',
  'quality_issue',
  'changed_mind',
  'other',
]);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid().primaryKey().defaultRandom(),

    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    paymentId: uuid('payment_id').references(() => payments.id),

    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),

    processedBy: uuid('processed_by').references(() => users.id),

    amount: decimal({ precision: 10, scale: 2 }).notNull(),
    reason: refundReasonEnum().notNull(),
    notes: text(), // Customer's description of the issue
    adminNotes: text('admin_notes'), // Internal admin notes
    status: refundStatusEnum().notNull().default('requested'),

    // Reference to gateway refund transaction (SSLCommerz, bKash, etc.)
    gatewayRefundId: varchar('gateway_refund_id', { length: 255 }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_refunds_order_id')
      .on(table.orderId)
      .where(sql`${table.status} != 'rejected'`),
    index('idx_refunds_status').on(table.status),
    index('idx_refunds_requested_by').on(table.requestedBy),
    index('idx_refunds_payment_id').on(table.paymentId),
  ],
);

export const refundsRelations = relations(refunds, ({ one }) => ({
  order: one(orders, {
    fields: [refunds.orderId],
    references: [orders.id],
  }),
  payment: one(payments, {
    fields: [refunds.paymentId],
    references: [payments.id],
  }),
  requester: one(users, {
    fields: [refunds.requestedBy],
    references: [users.id],
    relationName: 'refund_requester',
  }),
  processor: one(users, {
    fields: [refunds.processedBy],
    references: [users.id],
    relationName: 'refund_processor',
  }),
}));

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
