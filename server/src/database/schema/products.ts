import { pgTable, text, timestamp, uuid, varchar, integer, decimal } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: uuid().primaryKey().defaultRandom(),
  
  name: varchar({ length: 255 }).notNull(),
  slug: varchar({ length: 255 }).notNull().unique(),
  description: text(),
  
  price: decimal({ precision: 10, scale: 2 }).notNull(),
  stock: integer().notNull().default(0),
  
  imageUrl: text('image_url'),
  category: varchar({ length: 100 }).notNull().default('Uncategorized'),
  
  status: varchar({ length: 20 }).notNull().default('active'),
  // active | draft | archived
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
