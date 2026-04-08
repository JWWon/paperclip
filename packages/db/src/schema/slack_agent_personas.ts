import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * `slack_agent_personas` table — maps paperclip agents to Slack display identities.
 *
 * Each agent has at most one persona per company. The persona determines how
 * the agent appears in Slack: display name, avatar, and which channels it posts to.
 */
export const slackAgentPersonas = pgTable(
  "slack_agent_personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    iconUrl: text("icon_url"),
    slackChannelIds: jsonb("slack_channel_ids").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("slack_agent_personas_company_idx").on(table.companyId),
    agentIdx: index("slack_agent_personas_agent_idx").on(table.agentId),
    companyAgentUq: uniqueIndex("slack_agent_personas_company_agent_uq").on(
      table.companyId,
      table.agentId,
    ),
  }),
);
