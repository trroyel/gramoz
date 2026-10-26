CREATE TABLE IF NOT EXISTS "courier_reconciliation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"admin_email" varchar(255) NOT NULL,
	"action" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"evidence_ref" varchar(255),
	"previous_state" jsonb NOT NULL,
	"new_state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "courier_reconciliation_audit" ADD CONSTRAINT "courier_reconciliation_audit_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_courier_audit_event_id" ON "courier_reconciliation_audit" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_courier_audit_order_id" ON "courier_reconciliation_audit" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_courier_audit_created_at" ON "courier_reconciliation_audit" USING btree ("created_at" DESC);
