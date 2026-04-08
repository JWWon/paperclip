import { App, type SlackEventMiddlewareArgs } from "@slack/bolt";
import { logger as rootLogger } from "../../middleware/logger.js";

const logger = rootLogger.child({ module: "slack-bridge:socket-manager" });

export interface SlackSocketConfig {
  appToken: string;
  botToken: string;
  signingSecret?: string;
}

export type SlackMessageHandler = (event: {
  text: string;
  userId: string;
  channelId: string;
  threadTs: string | undefined;
  messageTs: string;
}) => Promise<void>;

export class SocketManager {
  private app: App | null = null;
  private connected = false;

  constructor(private config: SlackSocketConfig) {}

  async start(onMessage: SlackMessageHandler) {
    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
      signingSecret: this.config.signingSecret ?? "not-used-in-socket-mode",
    });

    this.app.event("app_mention", async ({ event }: SlackEventMiddlewareArgs<"app_mention">) => {
      try {
        await onMessage({
          text: event.text ?? "",
          userId: event.user ?? "unknown",
          channelId: event.channel,
          threadTs: event.thread_ts,
          messageTs: event.ts,
        });
      } catch (err) {
        logger.error({ err, event }, "Error handling app_mention");
      }
    });

    this.app.event("message", async ({ event }: SlackEventMiddlewareArgs<"message">) => {
      // Only handle threaded messages (replies) — non-threaded handled by app_mention
      if ("thread_ts" in event && event.thread_ts && event.subtype === undefined) {
        try {
          await onMessage({
            text: "text" in event ? (event.text ?? "") : "",
            userId: "user" in event ? (event.user ?? "unknown") : "unknown",
            channelId: event.channel,
            threadTs: event.thread_ts,
            messageTs: event.ts,
          });
        } catch (err) {
          logger.error({ err, event }, "Error handling threaded message");
        }
      }
    });

    await this.app.start();
    this.connected = true;
    logger.info("Slack Socket Mode connected");
  }

  async stop() {
    if (this.app) {
      await this.app.stop();
      this.connected = false;
      logger.info("Slack Socket Mode disconnected");
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async postMessage(input: {
    channelId: string;
    text: string;
    threadTs?: string;
    username?: string;
    iconUrl?: string;
  }): Promise<string | undefined> {
    if (!this.app) throw new Error("Slack not connected");
    const result = await this.app.client.chat.postMessage({
      channel: input.channelId,
      text: input.text,
      thread_ts: input.threadTs,
      username: input.username,
      icon_url: input.iconUrl,
    });
    return result.ts;
  }
}
