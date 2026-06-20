import {
  pgTable,
  uuid,
  varchar,
  decimal,
  integer,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { orders } from './orders';

export const promos = pgTable('promos', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  discountType: varchar('discount_type', {
    length: 20,
    enum: ['percentage', 'fixed'],
  }).notNull(),
  discountValue: decimal('discount_value', {
    precision: 10,
    scale: 2,
  }).notNull(),
  minOrderValue: decimal('min_order_value', { precision: 10, scale: 2 }),
  maxUses: integer('max_uses'),
  currentUses: integer('current_uses').notNull().default(0),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const promosRelations = relations(promos, ({ many }) => ({
  orders: many(orders),
}));
