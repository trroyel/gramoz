import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { outboxEvents } from './outbox';

/**
 * Append-only immutable audit trail for administrative courier reconciliations (TASK-27F).
 *
 * Guarantees that every manual intervention on ambiguous or failed courier dispatches
 * is permanently recorded with administrator identity, reason, verified provider evidence,
 * and exact state transitions, preventing overwriting or loss of audit history.
 */
export const courierReconciliationAudit = pgTable(
  'courier_reconciliation_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    adminId: uuid('admin_id').notNull(),
    adminEmail: varchar('admin_email', { length: 255 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(), // 'ADOPT_CONSIGNMENT' | 'CLEAR_AND_RETRY' | 'CANCEL_DISPATCH'
    reason: text('reason').notNull(),
    evidenceRef: varchar('evidence_ref', { length: 255 }), // e.g. Steadfast support ticket, portal audit ref
    previousState: jsonb('previous_state').notNull(),
    newState: jsonb('new_state').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_courier_audit_event_id').on(table.eventId),
    index('idx_courier_audit_order_id').on(table.orderId),
    index('idx_courier_audit_created_at').on(table.createdAt.desc()),
  ],
);

export type CourierReconciliationAudit =
  typeof courierReconciliationAudit.$inferSelect;
export type NewCourierReconciliationAudit =
  typeof courierReconciliationAudit.$inferInsert;
