DROP INDEX IF EXISTS "outbox_events_status_created_at_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_pending_idx" ON "outbox_events" USING btree ("created_at" ASC) WHERE status = 'pending' AND attempts < 3;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_processing_idx" ON "outbox_events" USING btree ("updated_at" ASC) WHERE status = 'processing';
