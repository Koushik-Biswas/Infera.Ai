DROP INDEX "messages_fts_idx";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agents_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "search_tokens" text[];--> statement-breakpoint
CREATE INDEX "messages_search_tokens_gin" ON "messages" USING gin ("search_tokens");