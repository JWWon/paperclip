import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { slackThreadMappings } from "@paperclipai/db";

export class ThreadTracker {
  constructor(private db: Db) {}

  async findByIssueId(issueId: string) {
    const [mapping] = await this.db
      .select()
      .from(slackThreadMappings)
      .where(eq(slackThreadMappings.issueId, issueId))
      .limit(1);
    return mapping ?? null;
  }

  async findByThread(channelId: string, threadTs: string) {
    const [mapping] = await this.db
      .select()
      .from(slackThreadMappings)
      .where(
        and(
          eq(slackThreadMappings.slackChannelId, channelId),
          eq(slackThreadMappings.slackThreadTs, threadTs),
        ),
      )
      .limit(1);
    return mapping ?? null;
  }

  async create(input: {
    companyId: string;
    issueId: string;
    slackChannelId: string;
    slackThreadTs: string;
  }) {
    const [mapping] = await this.db
      .insert(slackThreadMappings)
      .values(input)
      .returning();
    return mapping!;
  }

  async listByCompany(companyId: string) {
    return this.db
      .select()
      .from(slackThreadMappings)
      .where(eq(slackThreadMappings.companyId, companyId));
  }
}
