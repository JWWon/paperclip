import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { slackAgentPersonas } from "@paperclipai/db";

export class PersonaManager {
  constructor(private db: Db) {}

  async findByAgentId(companyId: string, agentId: string) {
    const [persona] = await this.db
      .select()
      .from(slackAgentPersonas)
      .where(
        and(
          eq(slackAgentPersonas.companyId, companyId),
          eq(slackAgentPersonas.agentId, agentId),
        ),
      )
      .limit(1);
    return persona ?? null;
  }

  async findByDisplayName(companyId: string, displayName: string) {
    const [persona] = await this.db
      .select()
      .from(slackAgentPersonas)
      .where(
        and(
          eq(slackAgentPersonas.companyId, companyId),
          eq(slackAgentPersonas.displayName, displayName),
        ),
      )
      .limit(1);
    return persona ?? null;
  }

  async listByCompany(companyId: string) {
    return this.db
      .select()
      .from(slackAgentPersonas)
      .where(eq(slackAgentPersonas.companyId, companyId));
  }

  async upsert(input: {
    companyId: string;
    agentId: string;
    displayName: string;
    iconUrl?: string | null;
    slackChannelIds?: string[];
  }) {
    const existing = await this.findByAgentId(input.companyId, input.agentId);
    if (existing) {
      const [updated] = await this.db
        .update(slackAgentPersonas)
        .set({
          displayName: input.displayName,
          iconUrl: input.iconUrl ?? existing.iconUrl,
          slackChannelIds: input.slackChannelIds ?? existing.slackChannelIds,
        })
        .where(eq(slackAgentPersonas.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await this.db
      .insert(slackAgentPersonas)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        displayName: input.displayName,
        iconUrl: input.iconUrl,
        slackChannelIds: input.slackChannelIds ?? [],
      })
      .returning();
    return created!;
  }

  async delete(companyId: string, agentId: string) {
    await this.db
      .delete(slackAgentPersonas)
      .where(
        and(
          eq(slackAgentPersonas.companyId, companyId),
          eq(slackAgentPersonas.agentId, agentId),
        ),
      );
  }
}
