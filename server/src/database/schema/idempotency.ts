import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { orders } from './orders';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    key: varchar('key', { length: 255 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: varchar('endpoint', { length: 100 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('started'), // 'started' | 'completed' | 'failed'
    statusCode: integer('status_code').default(201),
    responsePayload: jsonb('response_payload'),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_user_key_idx').on(table.userId, table.key),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
  ],
);

export const idempotencyKeysRelations = relations(
  idempotencyKeys,
  ({ one }) => ({
    user: one(users, {
      fields: [idempotencyKeys.userId],
      references: [users.id],
    }),
    order: one(orders, {
      fields: [idempotencyKeys.orderId],
      references: [orders.id],
    }),
  }),
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
