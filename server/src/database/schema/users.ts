import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { roleEnum } from './enums';
import { relations } from 'drizzle-orm';
import { addresses } from './addresses';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),

    email: varchar({ length: 255 }).notNull().unique(),
    passwordHash: text('password_hash'), // nullable for OAuth users

    fullName: varchar('full_name', { length: 150 }).notNull(),
    phone: varchar({ length: 20 }),

    // OAuth provider tracking ('local' | 'google' | 'facebook')
    provider: varchar({ length: 50 }).notNull().default('local'),
    providerId: varchar('provider_id', { length: 255 }),

    role: roleEnum().notNull().default('customer'),

    isEmailVerified: boolean('is_email_verified').notNull().default(false),
    isPhoneVerified: boolean('is_phone_verified').notNull().default(false),

    status: varchar({ length: 20 }).notNull().default('active'),
    // active | suspended | deleted

    lastLoginAt: timestamp('last_login_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [index('idx_users_email').on(table.email)],
);

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
