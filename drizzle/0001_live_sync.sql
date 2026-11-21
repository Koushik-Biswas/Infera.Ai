CREATE TABLE "connector_kv" (
	"channel_id" text NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_kv_channel_id_key_pk" PRIMARY KEY("channel_id","key")
);
--> statement-breakpoint
CREATE TABLE "connector_sessions" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"state" text DEFAULT 'disconnected' NOT NULL,
	"qr" text,
	"qr_expires_at" timestamp with time zone,
	"pairing_code" text,
	"account" jsonb,
	"auth_enc" text,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb,
	"command" text,
	"command_arg" text,
	"command_at" timestamp with time zone,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_kv" ADD CONSTRAINT "connector_kv_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sessions" ADD CONSTRAINT "connector_sessions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sessions" ADD CONSTRAINT "connector_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_sessions_ws_idx" ON "connector_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "contacts_ws_updated_idx" ON "contacts" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "contacts_handles_gin" ON "contacts" USING gin ("handles" jsonb_path_ops);