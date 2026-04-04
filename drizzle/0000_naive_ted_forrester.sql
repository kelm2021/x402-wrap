CREATE TABLE IF NOT EXISTS "endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_url" text NOT NULL,
	"price" text NOT NULL,
	"wallet_address" text NOT NULL,
	"path_pattern" text DEFAULT '*' NOT NULL,
	"encrypted_headers" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"verification_token" text,
	"verification_path" text,
	"verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"last_verification_error" text,
	"payment_tx_hash" text,
	"activation_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "verification_token" text;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "verification_path" text;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "activated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "last_verification_error" text;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "payment_tx_hash" text;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "activation_tx_hash" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"request_path" text NOT NULL,
	"method" text NOT NULL,
	"paid_amount" text,
	"status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "usage_events"
    ADD CONSTRAINT "usage_events_endpoint_id_endpoints_id_fk"
    FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_endpoint_time_idx" ON "usage_events" USING btree ("endpoint_id","created_at");
