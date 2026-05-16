import { boolean, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),

  email: varchar({ length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),

  fullName: varchar('full_name', { length: 150 }).notNull(),
  phone: varchar({ length: 20 }),

  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  isPhoneVerified: boolean('is_phone_verified').notNull().default(false),

  status: varchar({ length: 20 }).notNull().default('active'),
  // active | suspended | deleted

  lastLoginAt: timestamp('last_login_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [index('idx_users_email').on(table.email)]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
