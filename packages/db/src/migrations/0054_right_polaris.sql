ALTER TABLE "slack_company_config" ADD COLUMN "app_token_secret_id" uuid;--> statement-breakpoint
ALTER TABLE "slack_company_config" ADD COLUMN "bot_token_secret_id" uuid;--> statement-breakpoint
ALTER TABLE "slack_company_config" ADD CONSTRAINT "slack_company_config_app_token_secret_id_company_secrets_id_fk" FOREIGN KEY ("app_token_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_company_config" ADD CONSTRAINT "slack_company_config_bot_token_secret_id_company_secrets_id_fk" FOREIGN KEY ("bot_token_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;
