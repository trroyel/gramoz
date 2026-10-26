import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { products } from './products';

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id'), // optional, refers to product_variants

    quantity: integer().notNull().default(1),
    abandonedEmailSent: boolean('abandoned_email_sent')
      .notNull()
      .default(false),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_cart_items_user_product_variant')
      .on(table.userId, table.productId, table.variantId)
      .nullsNotDistinct(),
    index('idx_cart_items_abandoned')
      .on(table.updatedAt.asc())
      .where(sql`${table.abandonedEmailSent} = false`),
  ],
);

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, {
    fields: [cartItems.userId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
}));

export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;
