import type { Db } from "@paperclipai/db";
import { logger as rootLogger } from "../../middleware/logger.js";
import { PersonaManager } from "./persona-manager.js";
import { ThreadTracker } from "./thread-tracker.js";
import { issueService } from "../issues.js";
import { heartbeatService } from "../heartbeat.js";

const logger = rootLogger.child({ module: "slack-bridge:message-router" });

export class MessageRouter {
  private personaManager: PersonaManager;
  private threadTracker: ThreadTracker;

  constructor(
    private db: Db,
    private companyId: string,
  ) {
    this.personaManager = new PersonaManager(db);
    this.threadTracker = new ThreadTracker(db);
  }

  /**
   * Extract the @mentioned agent name from a Slack message.
   * Slack formats mentions as <@U12345> — we strip the bot mention
   * and look for agent display names in the remaining text.
   */
  private extractAgentMention(text: string): string | null {
    // Remove Slack user mentions (<@U...>) and extract the first word after
    const cleaned = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    // Check if text starts with @AgentName pattern
    const mentionMatch = cleaned.match(/^@(\S+)/);
    if (mentionMatch) return mentionMatch[1]!;
    // Fallback: the text after removing bot mention is the command
    return null;
  }

  async handleInboundMessage(event: {
    text: string;
    userId: string;
    channelId: string;
    threadTs: string | undefined;
    messageTs: string;
  }) {
    const { text, channelId, threadTs, messageTs } = event;

    // Check if this is a reply to an existing tracked thread
    if (threadTs) {
      const existingMapping = await this.threadTracker.findByThread(channelId, threadTs);
      if (existingMapping) {
        // Add as comment to existing issue
        const issues = issueService(this.db);
        await issues.addComment(
          existingMapping.issueId,
          text.replace(/<@[A-Z0-9]+>/g, "").trim(),
          { userId: event.userId },
        );
        logger.info({ issueId: existingMapping.issueId, threadTs }, "Added Slack reply as issue comment");
        return;
      }
    }

    // New message — find target agent by looking up personas for this channel
    const personas = await this.personaManager.listByCompany(this.companyId);
    const channelPersonas = personas.filter(
      (p) => (p.slackChannelIds as string[])?.includes(channelId),
    );

    // Try to match agent by name in the message text
    let targetPersona = null;
    const mentionedName = this.extractAgentMention(text);
    if (mentionedName) {
      targetPersona = channelPersonas.find(
        (p) => p.displayName.toLowerCase() === mentionedName.toLowerCase(),
      );
    }

    // Fallback: if only one agent in the channel, route to them
    if (!targetPersona && channelPersonas.length === 1) {
      targetPersona = channelPersonas[0]!;
    }

    // Fallback: route to CEO if available
    if (!targetPersona) {
      targetPersona = personas.find(
        (p) => p.displayName.toLowerCase() === "ceo",
      );
    }

    if (!targetPersona) {
      logger.warn({ channelId, text }, "No target agent found for Slack message");
      return;
    }

    // Create a new issue for this message
    const cleanedText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    const title = cleanedText.length > 80
      ? cleanedText.slice(0, 77) + "..."
      : cleanedText;

    const issues = issueService(this.db);
    const issue = await issues.create(this.companyId, {
      title,
      description: `**From Slack** (#${channelId}):\n\n${cleanedText}`,
      assigneeAgentId: targetPersona.agentId,
      priority: "medium",
    });

    // Track the thread mapping
    const threadTsForMapping = threadTs ?? messageTs;
    await this.threadTracker.create({
      companyId: this.companyId,
      issueId: issue.id,
      slackChannelId: channelId,
      slackThreadTs: threadTsForMapping,
    });

    // Wake the agent for immediate response
    try {
      const heartbeat = heartbeatService(this.db);
      await heartbeat.wakeup(targetPersona.agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        reason: `slack_message:${issue.id}`,
      });
      logger.info(
        { agentId: targetPersona.agentId, issueId: issue.id },
        "Created issue from Slack and woke agent",
      );
    } catch (err) {
      logger.warn({ err, agentId: targetPersona.agentId }, "Failed to wake agent after Slack message");
    }
  }
}
