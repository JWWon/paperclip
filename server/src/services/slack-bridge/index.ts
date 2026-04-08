import type { Db } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { logger } from "../../middleware/logger.js";
import { slackCompanyConfig } from "@paperclipai/db";
import { SocketManager, type SlackSocketConfig } from "./socket-manager.js";
import { MessageRouter } from "./message-router.js";
import { EventSync } from "./event-sync.js";
import { PersonaManager } from "./persona-manager.js";
import { ThreadTracker } from "./thread-tracker.js";

export { PersonaManager } from "./persona-manager.js";
export { ThreadTracker } from "./thread-tracker.js";

const log = logger.child({ name: "slack-bridge" });

export class SlackBridgeService {
  private socketManager: SocketManager | null = null;
  private messageRouters = new Map<string, MessageRouter>();
  private eventSyncs = new Map<string, EventSync>();
  private started = false;

  constructor(
    private db: Db,
    private config: SlackSocketConfig,
  ) {}

  async start() {
    if (this.started) return;

    this.socketManager = new SocketManager(this.config);

    // Start Socket Mode connection
    await this.socketManager.start(async (event) => {
      // Route to the appropriate company's message router
      // For now, route all messages to companies that have Slack enabled
      const configs = await this.getEnabledCompanyConfigs();
      for (const companyConfig of configs) {
        const channelIds = Object.values(
          (companyConfig.channels as Record<string, string>) ?? {},
        );
        if (channelIds.includes(event.channelId)) {
          const router = this.getOrCreateRouter(companyConfig.companyId);
          await router.handleInboundMessage(event);
          return;
        }
      }
      log.debug({ channelId: event.channelId }, "No company config found for Slack channel");
    });

    // Start event sync for all enabled companies
    const configs = await this.getEnabledCompanyConfigs();
    for (const companyConfig of configs) {
      this.startEventSync(
        companyConfig.companyId,
        (companyConfig.channels as Record<string, string>) ?? {},
      );
    }

    this.started = true;
    log.info("Slack bridge service started");
  }

  async stop() {
    if (!this.started) return;

    // Stop all event syncs
    for (const sync of this.eventSyncs.values()) {
      sync.stop();
    }
    this.eventSyncs.clear();
    this.messageRouters.clear();

    // Stop Socket Mode
    if (this.socketManager) {
      await this.socketManager.stop();
      this.socketManager = null;
    }

    this.started = false;
    log.info("Slack bridge service stopped");
  }

  isConnected(): boolean {
    return this.socketManager?.isConnected() ?? false;
  }

  getSocketManager(): SocketManager | null {
    return this.socketManager;
  }

  getPersonaManager(companyId: string): PersonaManager {
    return new PersonaManager(this.db);
  }

  getThreadTracker(companyId: string): ThreadTracker {
    return new ThreadTracker(this.db);
  }

  /**
   * Refresh event syncs when a company's Slack config changes.
   */
  async refreshCompany(companyId: string) {
    // Stop existing sync
    const existingSync = this.eventSyncs.get(companyId);
    if (existingSync) {
      existingSync.stop();
      this.eventSyncs.delete(companyId);
    }
    this.messageRouters.delete(companyId);

    // Restart if still enabled
    const [config] = await this.db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    if (config?.enabled && this.socketManager) {
      this.startEventSync(
        companyId,
        (config.channels as Record<string, string>) ?? {},
      );
      log.info({ companyId }, "Refreshed Slack config for company");
    }
  }

  private getOrCreateRouter(companyId: string): MessageRouter {
    let router = this.messageRouters.get(companyId);
    if (!router) {
      router = new MessageRouter(this.db, companyId);
      this.messageRouters.set(companyId, router);
    }
    return router;
  }

  private startEventSync(companyId: string, channels: Record<string, string>) {
    if (!this.socketManager) return;
    const sync = new EventSync(this.db, companyId, this.socketManager, channels);
    sync.start();
    this.eventSyncs.set(companyId, sync);
  }

  private async getEnabledCompanyConfigs() {
    return this.db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.enabled, true));
  }
}

// Singleton — initialized in server startup
let _slackBridgeService: SlackBridgeService | null = null;

export function initSlackBridge(db: Db, config: SlackSocketConfig): SlackBridgeService {
  _slackBridgeService = new SlackBridgeService(db, config);
  return _slackBridgeService;
}

export function getSlackBridge(): SlackBridgeService | null {
  return _slackBridgeService;
}
