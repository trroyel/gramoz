CREATE TYPE "public"."refund_reason" AS ENUM('damaged_item', 'wrong_item', 'not_received', 'quality_issue', 'changed_mind', 'other');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'approved', 'processed', 'rejected');--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"requested_by" uuid NOT NULL,
	"processed_by" uuid,
	"amount" numeric(10, 2) NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"notes" text,
	"admin_notes" text,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"gateway_refund_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"discount_type" varchar(20) NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"min_order_value" numeric(10, 2),
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promos_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promo_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refunds_order_id" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_status" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_refunds_requested_by" ON "refunds" USING btree ("requested_by");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cart_items_user_product" ON "cart_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_transaction_id" ON "payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_payments_order_id" ON "payments" USING btree ("order_id");