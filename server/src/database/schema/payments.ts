import {
  decimal,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orders } from './orders';
import { paymentStatusEnum } from './enums';

export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    amount: decimal({ precision: 10, scale: 2 }).notNull(),
    status: paymentStatusEnum().notNull().default('pending'),
    method: varchar({ length: 50 }), // e.g., 'SSLCommerz', 'COD', 'Steadfast'

    // SSLCommerz specific fields
    transactionId: varchar('transaction_id', { length: 255 }),
    gatewayResponse: jsonb('gateway_response'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Prevent duplicate payment records for the same gateway transaction
    uniqueIndex('uq_payments_transaction_id').on(table.transactionId),
    index('idx_payments_order_id').on(table.orderId),
  ],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}));

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
