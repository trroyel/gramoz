import { pgTable, text, uuid, timestamp, decimal, boolean } from 'drizzle-orm/pg-core';

export const divisions = pgTable('divisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const districts = pgTable('districts', {
  id: uuid('id').defaultRandom().primaryKey(),
  divisionId: uuid('division_id')
    .notNull()
    .references(() => divisions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const zones = pgTable('zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  districtId: uuid('district_id')
    .notNull()
    .references(() => districts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // Upazila or City Corporation name
  homeDeliveryCharge: decimal('home_delivery_charge', { precision: 10, scale: 2 }).notNull(),
  branchPickupCharge: decimal('branch_pickup_charge', { precision: 10, scale: 2 }).notNull(),
  estimatedDays: text('estimated_days').notNull().default('2-3 days'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
