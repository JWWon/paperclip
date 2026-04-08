import type { LiveEvent } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { logger as rootLogger } from "../../middleware/logger.js";
import { subscribeCompanyLiveEvents } from "../live-events.js";
import { PersonaManager } from "./persona-manager.js";
import { ThreadTracker } from "./thread-tracker.js";
import type { SocketManager } from "./socket-manager.js";

const logger = rootLogger.child({ module: "slack-bridge:event-sync" });

/**
 * EventSync subscribes to paperclip live events (activity.logged) and
 * posts outbound messages to linked Slack threads when agents comment
 * on issues or create new issues.
 */
export class EventSync {
  private personaManager: PersonaManager;
  private threadTracker: ThreadTracker;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private db: Db,
    private companyId: string,
    private socketManager: SocketManager,
    private channelConfig: Record<string, string>,
  ) {
    this.personaManager = new PersonaManager(db);
    this.threadTracker = new ThreadTracker(db);
  }

  start() {
    this.unsubscribe = subscribeCompanyLiveEvents(this.companyId, (event) => {
      this.handleEvent(event).catch((err) => {
        logger.error({ err, event }, "Error handling live event for Slack sync");
      });
    });
    logger.info({ companyId: this.companyId }, "Event sync started");
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      logger.info("Event sync stopped");
    }
  }

  private async handleEvent(event: LiveEvent) {
    // Only handle activity.logged events
    if (event.type !== "activity.logged") return;

    const payload = event.payload as {
      entityType?: string;
      entityId?: string;
      action?: string;
      actorType?: string;
      actorId?: string;
      detail?: Record<string, unknown>;
    };

    // Only sync agent-originated issue actions to Slack
    if (payload.actorType !== "agent") return;

    const agentId = payload.actorId;
    if (!agentId) return;

    // Get agent's Slack persona
    const persona = await this.personaManager.findByAgentId(this.companyId, agentId);
    if (!persona) return;

    if (payload.entityType === "issue_comment" && payload.action === "created") {
      await this.syncCommentToSlack(payload, persona);
    } else if (payload.entityType === "issue" && payload.action === "created") {
      await this.syncNewIssueToSlack(payload, persona);
    } else if (payload.entityType === "issue" && payload.action === "updated") {
      await this.syncIssueUpdateToSlack(payload, persona);
    }
  }

  private async syncCommentToSlack(
    payload: Record<string, unknown>,
    persona: { displayName: string; iconUrl: string | null; slackChannelIds: unknown; agentId: string },
  ) {
    const issueId = payload.entityId as string | undefined;
    // For comments, the parent issue ID is in the detail
    const parentIssueId = (payload.detail as Record<string, unknown>)?.issueId as string | undefined;
    const targetIssueId = parentIssueId || issueId;
    if (!targetIssueId) return;

    const mapping = await this.threadTracker.findByIssueId(targetIssueId);
    if (!mapping) return;

    const content = (payload.detail as Record<string, unknown>)?.content as string | undefined;
    if (!content) return;

    try {
      await this.socketManager.postMessage({
        channelId: mapping.slackChannelId,
        text: content,
        threadTs: mapping.slackThreadTs,
        username: persona.displayName,
        iconUrl: persona.iconUrl ?? undefined,
      });
      logger.debug({ issueId: targetIssueId }, "Synced comment to Slack thread");
    } catch (err) {
      logger.warn({ err, issueId: targetIssueId }, "Failed to sync comment to Slack");
    }
  }

  private async syncNewIssueToSlack(
    payload: Record<string, unknown>,
    persona: { displayName: string; iconUrl: string | null; slackChannelIds: unknown; agentId: string },
  ) {
    const issueId = payload.entityId as string | undefined;
    if (!issueId) return;

    // Check if there's already a mapping (issue was created from Slack)
    const existing = await this.threadTracker.findByIssueId(issueId);
    if (existing) return; // Already tracked — don't double-post

    // Find the best channel to post in based on agent's persona channels
    const agentChannels = (persona.slackChannelIds as string[]) ?? [];
    const targetChannelId = agentChannels[0] || this.getDefaultChannel();
    if (!targetChannelId) return;

    const title = (payload.detail as Record<string, unknown>)?.title as string | undefined;
    const description = (payload.detail as Record<string, unknown>)?.description as string | undefined;
    const text = `*New issue created:* ${title ?? "Untitled"}\n${description ? description.slice(0, 300) : ""}`;

    try {
      const messageTs = await this.socketManager.postMessage({
        channelId: targetChannelId,
        text,
        username: persona.displayName,
        iconUrl: persona.iconUrl ?? undefined,
      });

      if (messageTs) {
        await this.threadTracker.create({
          companyId: this.companyId,
          issueId,
          slackChannelId: targetChannelId,
          slackThreadTs: messageTs,
        });
        logger.info({ issueId, channelId: targetChannelId }, "Created Slack thread for new issue");
      }
    } catch (err) {
      logger.warn({ err, issueId }, "Failed to create Slack thread for new issue");
    }
  }

  private async syncIssueUpdateToSlack(
    payload: Record<string, unknown>,
    persona: { displayName: string; iconUrl: string | null; slackChannelIds: unknown; agentId: string },
  ) {
    const issueId = payload.entityId as string | undefined;
    if (!issueId) return;

    const mapping = await this.threadTracker.findByIssueId(issueId);
    if (!mapping) return;

    const changes = (payload.detail as Record<string, unknown>)?.changes as Record<string, unknown> | undefined;
    if (!changes) return;

    // Only sync meaningful status changes
    const statusChange = changes.status as { from?: string; to?: string } | undefined;
    if (!statusChange) return;

    const text = `Issue status changed: *${statusChange.from}* → *${statusChange.to}*`;

    try {
      await this.socketManager.postMessage({
        channelId: mapping.slackChannelId,
        text,
        threadTs: mapping.slackThreadTs,
        username: persona.displayName,
        iconUrl: persona.iconUrl ?? undefined,
      });
    } catch (err) {
      logger.warn({ err, issueId }, "Failed to sync issue update to Slack");
    }
  }

  private getDefaultChannel(): string | undefined {
    // Return the first configured channel as default
    const channels = Object.values(this.channelConfig);
    return channels[0];
  }
}
