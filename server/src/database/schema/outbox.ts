import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  text,
  timestamp,
  integer,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';

export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

/**
 * Transactional Outbox table.
 *
 * Every row represents one pending side-effect that needs to call an external
 * API (e.g. courier consignment creation). Rows are inserted atomically inside
 * the same DB transaction as the business operation, guaranteeing that the job
 * is never lost even if the process crashes right after the commit.
 *
 * The background OutboxProcessor polls this table every 30 seconds and
 * processes pending rows, marking them as completed or failed.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid().primaryKey().defaultRandom(),

    // e.g. 'CREATE_CONSIGNMENT'
    type: varchar('type', { length: 100 }).notNull(),

    // Arbitrary JSON payload — the worker knows how to read it per type
    payload: jsonb('payload').notNull(),

    status: outboxStatusEnum().notNull().default('pending'),

    // Number of processing attempts made so far
    attempts: integer('attempts').notNull().default(0),

    // Last error message if status is 'failed'
    lastError: text('last_error'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // The OutboxProcessor queries WHERE status='pending' ORDER BY created_at ASC
    // every 30 seconds. Without this index that's a full table scan every tick.
    index('outbox_events_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
