import {
  decimal,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { products } from './products';
import { addresses } from './addresses';
import { orderStatusEnum, orderPaymentStatusEnum } from './enums';
import { promos } from './promos';
import { payments } from './payments';

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    status: orderStatusEnum().notNull().default('pending'),
    paymentStatus: orderPaymentStatusEnum('payment_status').notNull().default('unpaid'),
    totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),

    shippingAddressId: uuid('shipping_address_id')
      .notNull()
      .references(() => addresses.id),

    consignmentId: varchar('consignment_id', { length: 255 }),
    trackingUrl: varchar('tracking_url', { length: 1024 }),

    promoId: uuid('promo_id').references(() => promos.id),
    discountAmount: decimal('discount_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('orders_user_id_idx').on(table.userId),
    index('orders_status_idx').on(table.status),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),

    quantity: integer().notNull(),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(), // Price at the time of purchase

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('order_items_order_id_idx').on(table.orderId)],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  shippingAddress: one(addresses, {
    fields: [orders.shippingAddressId],
    references: [addresses.id],
  }),
  promo: one(promos, {
    fields: [orders.promoId],
    references: [promos.id],
  }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
