CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "instantly_lead_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider" text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_account" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "in_reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "instantly_campaign_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_id_uq" ON "messages" USING btree ("external_id");