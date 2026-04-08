import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/**
 * `slack_thread_mappings` table — maps Slack threads to paperclip issues
 * for bidirectional message sync between Slack and the dashboard.
 *
 * Each Slack thread (identified by channel + thread_ts) maps to exactly
 * one paperclip issue. When a message is posted in the Slack thread,
 * it creates a comment on the issue. When a comment is added to the issue,
 * it's posted to the Slack thread.
 */
export const slackThreadMappings = pgTable(
  "slack_thread_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    slackChannelId: text("slack_channel_id").notNull(),
    slackThreadTs: text("slack_thread_ts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("slack_thread_mappings_company_idx").on(table.companyId),
    issueIdx: index("slack_thread_mappings_issue_idx").on(table.issueId),
    threadUq: uniqueIndex("slack_thread_mappings_thread_uq").on(
      table.slackChannelId,
      table.slackThreadTs,
    ),
  }),
);
