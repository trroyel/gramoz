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
import { sql } from 'drizzle-orm';

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
 * API (e.g. courier consignment creation, notification dispatch). Rows are inserted
 * atomically inside the same DB transaction as the business operation, guaranteeing
 * that the job is never lost even if the process crashes right after the commit.
 *
 * The background OutboxProcessor polls this table every 30 seconds and
 * processes pending rows, marking them as completed or failed.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid().primaryKey().defaultRandom(),

    // e.g. 'CREATE_CONSIGNMENT', 'SEND_ORDER_CONFIRMATION', 'SEND_SMS', 'SEND_LOW_STOCK_ALERT'
    type: varchar('type', { length: 100 }).notNull(),

    // Arbitrary JSON payload — the worker knows how to read it per type
    payload: jsonb('payload').notNull(),

    status: outboxStatusEnum().notNull().default('pending'),

    // Number of processing attempts made so far
    attempts: integer('attempts').notNull().default(0),

    // Last error message if status is 'failed' or retrying
    lastError: text('last_error'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Partial index for sub-0.1ms pending event claiming with FOR UPDATE SKIP LOCKED (TASK-12)
    // Indexes ONLY active pending rows with attempts < 3. Completed rows (99.9% of table) are excluded.
    index('outbox_events_pending_idx')
      .on(table.createdAt.asc())
      .where(sql`${table.status} = 'pending' AND ${table.attempts} < 3`),

    // Partial index for worker crash / lease timeout recovery (> 5m stuck in 'processing') (TASK-12)
    index('outbox_events_processing_idx')
      .on(table.updatedAt.asc())
      .where(sql`${table.status} = 'processing'`),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
