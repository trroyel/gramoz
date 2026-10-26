import {
  pgTable,
  uuid,
  varchar,
  integer,
  decimal,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { products } from './products';

export const productVariants = pgTable('product_variants', {
  id: uuid().primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .references(() => products.id, { onDelete: 'cascade' })
    .notNull(),

  sku: varchar({ length: 100 }),
  price: decimal({ precision: 10, scale: 2 }).notNull(),
  stock: integer().notNull().default(0),

  attributes: jsonb().notNull().default('{}'),
  imageUrl: varchar('image_url', { length: 1024 }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const productVariantsRelations = relations(
  productVariants,
  ({ one }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
  }),
);

export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
