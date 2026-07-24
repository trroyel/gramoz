import {
  boolean,
  decimal,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { zones } from './shipping_zones';
import { relations } from 'drizzle-orm';

export const addresses = pgTable('addresses', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),

  title: varchar({ length: 50 }).notNull(), // e.g., 'Home', 'Office'
  addressLine1: varchar('address_line_1', { length: 255 }).notNull(),
  addressLine2: varchar('address_line_2', { length: 255 }),
  city: varchar({ length: 100 }).notNull(),
  zipCode: varchar('zip_code', { length: 20 }),

  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),

  // Shipping zone — nullable for backwards compatibility with old addresses
  zoneId: uuid('zone_id').references(() => zones.id),

  isDefault: boolean('is_default').notNull().default(false),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, {
    fields: [addresses.userId],
    references: [users.id],
  }),
  zone: one(zones, {
    fields: [addresses.zoneId],
    references: [zones.id],
  }),
}));

export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
