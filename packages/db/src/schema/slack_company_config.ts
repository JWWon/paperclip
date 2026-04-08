import { pgTable, uuid, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * `slack_company_config` table — stores per-company Slack integration settings.
 *
 * Each company has at most one config row. The channels field maps
 * functional group names (e.g., "leadership", "engineering", "growth")
 * to Slack channel IDs.
 *
 * Follows the same pattern as `plugin_company_settings` — a separate table
 * rather than columns on the companies table, to minimize upstream merge friction.
 */
export const slackCompanyConfig = pgTable(
  "slack_company_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    channels: jsonb("channels").$type<Record<string, string>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUq: uniqueIndex("slack_company_config_company_uq").on(table.companyId),
  }),
);
