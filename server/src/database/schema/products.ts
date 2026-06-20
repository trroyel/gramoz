import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  decimal,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { categories } from './categories';

export const products = pgTable('products', {
  id: uuid().primaryKey().defaultRandom(),

  name: varchar({ length: 255 }).notNull(),
  slug: varchar({ length: 255 }).notNull().unique(),
  description: text(),

  price: decimal({ precision: 10, scale: 2 }).notNull(),
  stock: integer().notNull().default(0),
  unit: varchar({ length: 20 }).notNull().default('piece'),
  // piece | kg | g | liter | ml | dozen | meter | pack

  images: jsonb().default('[]'),
  categoryId: uuid('category_id').references(() => categories.id),

  status: varchar({ length: 20 }).notNull().default('active'),
  // active | draft | archived

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
}));

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
