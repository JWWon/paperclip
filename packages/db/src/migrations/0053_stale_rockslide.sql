CREATE TABLE "slack_agent_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"icon_url" text,
	"slack_channel_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_company_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channels" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_thread_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_agent_personas" ADD CONSTRAINT "slack_agent_personas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_agent_personas" ADD CONSTRAINT "slack_agent_personas_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_company_config" ADD CONSTRAINT "slack_company_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_thread_mappings" ADD CONSTRAINT "slack_thread_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_thread_mappings" ADD CONSTRAINT "slack_thread_mappings_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_agent_personas_company_idx" ON "slack_agent_personas" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "slack_agent_personas_agent_idx" ON "slack_agent_personas" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_agent_personas_company_agent_uq" ON "slack_agent_personas" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_company_config_company_uq" ON "slack_company_config" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "slack_thread_mappings_company_idx" ON "slack_thread_mappings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "slack_thread_mappings_issue_idx" ON "slack_thread_mappings" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_thread_mappings_thread_uq" ON "slack_thread_mappings" USING btree ("slack_channel_id","slack_thread_ts");