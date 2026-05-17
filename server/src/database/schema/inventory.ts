import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { products } from './products';
import { transactionTypeEnum } from './enums';

export const inventoryTransactions = pgTable('inventory_transactions', {
  id: uuid().primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),

  type: transactionTypeEnum().notNull(), // 'in' or 'out'
  quantity: integer().notNull(),

  referenceId: uuid('reference_id'), // could be an order_id or purchase_order_id
  notes: text(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const inventoryTransactionsRelations = relations(
  inventoryTransactions,
  ({ one }) => ({
    product: one(products, {
      fields: [inventoryTransactions.productId],
      references: [products.id],
    }),
  }),
);

export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type NewInventoryTransaction = typeof inventoryTransactions.$inferInsert;
