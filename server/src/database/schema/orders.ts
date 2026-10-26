import {
  decimal,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { products } from './products';
import { productVariants } from './product_variants';
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
    paymentStatus: orderPaymentStatusEnum('payment_status')
      .notNull()
      .default('unpaid'),
    totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
    deliveryCharge: decimal('delivery_charge', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    deliveryMethod: varchar('delivery_method', { length: 20 })
      .notNull()
      .default('home'),

    shippingAddressId: uuid('shipping_address_id')
      .notNull()
      .references(() => addresses.id),

    consignmentId: varchar('consignment_id', { length: 255 }),
    trackingUrl: varchar('tracking_url', { length: 1024 }),

    promoId: uuid('promo_id').references(() => promos.id),
    discountAmount: decimal('discount_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),

    idempotencyKey: varchar('idempotency_key', { length: 255 }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('orders_user_id_idx').on(table.userId),
    index('orders_status_idx').on(table.status),
    uniqueIndex('orders_user_id_idempotency_key_idx').on(
      table.userId,
      table.idempotencyKey,
    ),
    index('orders_consignment_id_idx')
      .on(table.consignmentId)
      .where(sql`${table.consignmentId} IS NOT NULL`),
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

    variantId: uuid('variant_id').references(() => productVariants.id),
    variantAttributes: jsonb('variant_attributes'),

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
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
