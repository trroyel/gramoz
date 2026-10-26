CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" varchar(100) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'started' NOT NULL,
	"status_code" integer DEFAULT 201,
	"response_payload" jsonb,
	"order_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_user_key_idx" ON "idempotency_keys" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_id_idempotency_key_idx" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_cart_items_user_product_variant'
  ) THEN
    ALTER TABLE "cart_items" ADD CONSTRAINT "uq_cart_items_user_product_variant" UNIQUE NULLS NOT DISTINCT("user_id","product_id","variant_id");
  END IF;
END $$;