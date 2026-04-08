import type { Db } from "@paperclipai/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { logger } from "../../middleware/logger.js";
import { slackCompanyConfig } from "@paperclipai/db";
import { SocketManager, type SlackSocketConfig } from "./socket-manager.js";
import { MessageRouter } from "./message-router.js";
import { EventSync } from "./event-sync.js";
import { PersonaManager } from "./persona-manager.js";
import { ThreadTracker } from "./thread-tracker.js";
import { secretService } from "../secrets.js";

export { PersonaManager } from "./persona-manager.js";
export { ThreadTracker } from "./thread-tracker.js";

const log = logger.child({ name: "slack-bridge" });

const MAX_COMPANY_SOCKETS = 20;

export class SlackBridgeService {
  private socketManagers = new Map<string, SocketManager>();
  private envFallbackSocketManager: SocketManager | null = null;
  private messageRouters = new Map<string, MessageRouter>();
  private eventSyncs = new Map<string, EventSync>();
  private started = false;
  private secrets: ReturnType<typeof secretService>;

  constructor(
    private db: Db,
    private envConfig?: SlackSocketConfig,
  ) {
    this.secrets = secretService(db);
  }

  async start() {
    if (this.started) return;

    // 1. Env-var fallback socket (backward compat)
    if (this.envConfig?.appToken && this.envConfig?.botToken) {
      this.envFallbackSocketManager = new SocketManager(this.envConfig);
      await this.envFallbackSocketManager.start(async (event) => {
        // Route by channel — same logic as before
        const configs = await this.getEnabledCompanyConfigs();
        for (const companyConfig of configs) {
          const channelIds = Object.keys(
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
      log.info("Env-var fallback Slack socket started");
    }

    // 2. Per-company sockets from DB
    const dbConfigs = await this.db
      .select()
      .from(slackCompanyConfig)
      .where(
        and(
          eq(slackCompanyConfig.enabled, true),
          isNotNull(slackCompanyConfig.appTokenSecretId),
          isNotNull(slackCompanyConfig.botTokenSecretId),
        ),
      );

    for (const cfg of dbConfigs) {
      if (this.socketManagers.size >= MAX_COMPANY_SOCKETS) {
        log.warn(
          { limit: MAX_COMPANY_SOCKETS },
          "Reached max per-company socket limit, skipping remaining",
        );
        break;
      }
      try {
        await this.startCompanySocket(cfg.companyId, cfg.appTokenSecretId!, cfg.botTokenSecretId!);
      } catch (err) {
        log.error({ err, companyId: cfg.companyId }, "Failed to start per-company Slack socket");
      }
    }

    // 3. Start event sync for all enabled companies
    const allConfigs = await this.getEnabledCompanyConfigs();
    for (const companyConfig of allConfigs) {
      this.startEventSync(
        companyConfig.companyId,
        (companyConfig.channels as Record<string, string>) ?? {},
      );
    }

    this.started = true;
    log.info(
      { envFallback: !!this.envFallbackSocketManager, perCompany: this.socketManagers.size },
      "Slack bridge service started",
    );
  }

  async stop() {
    if (!this.started) return;

    // Stop all event syncs
    for (const sync of this.eventSyncs.values()) {
      sync.stop();
    }
    this.eventSyncs.clear();
    this.messageRouters.clear();

    // Stop all per-company sockets
    for (const [companyId, sm] of this.socketManagers) {
      try {
        await sm.stop();
      } catch (err) {
        log.error({ err, companyId }, "Error stopping per-company socket");
      }
    }
    this.socketManagers.clear();

    // Stop env fallback socket
    if (this.envFallbackSocketManager) {
      await this.envFallbackSocketManager.stop();
      this.envFallbackSocketManager = null;
    }

    this.started = false;
    log.info("Slack bridge service stopped");
  }

  isConnected(companyId?: string): boolean {
    if (companyId) {
      const sm = this.socketManagers.get(companyId);
      if (sm) return sm.isConnected();
    }
    return this.envFallbackSocketManager?.isConnected() ?? false;
  }

  getSocketManager(companyId?: string): SocketManager | null {
    if (companyId) {
      const sm = this.socketManagers.get(companyId);
      if (sm) return sm;
    }
    return this.envFallbackSocketManager;
  }

  getPersonaManager(companyId: string): PersonaManager {
    return new PersonaManager(this.db);
  }

  getThreadTracker(companyId: string): ThreadTracker {
    return new ThreadTracker(this.db);
  }

  /**
   * Refresh event syncs and per-company socket when a company's Slack config changes.
   */
  async refreshCompany(companyId: string) {
    // Stop existing event sync
    const existingSync = this.eventSyncs.get(companyId);
    if (existingSync) {
      existingSync.stop();
      this.eventSyncs.delete(companyId);
    }
    this.messageRouters.delete(companyId);

    // Stop existing per-company socket
    const existingSocket = this.socketManagers.get(companyId);
    if (existingSocket) {
      try {
        await existingSocket.stop();
      } catch (err) {
        log.error({ err, companyId }, "Error stopping existing per-company socket");
      }
      this.socketManagers.delete(companyId);
    }

    // Re-read config from DB
    const [config] = await this.db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    if (!config?.enabled) return;

    // Try to start per-company socket if tokens are configured
    if (config.appTokenSecretId && config.botTokenSecretId) {
      if (this.socketManagers.size >= MAX_COMPANY_SOCKETS) {
        log.warn({ companyId, limit: MAX_COMPANY_SOCKETS }, "Cannot add per-company socket: limit reached");
      } else {
        try {
          await this.startCompanySocket(companyId, config.appTokenSecretId, config.botTokenSecretId);
        } catch (err) {
          log.error({ err, companyId }, "Failed to start per-company Slack socket on refresh");
        }
      }
    }

    // Restart event sync with the appropriate socket manager
    const socketManager = this.getSocketManager(companyId);
    if (socketManager) {
      this.startEventSync(
        companyId,
        (config.channels as Record<string, string>) ?? {},
      );
      log.info({ companyId }, "Refreshed Slack config for company");
    }
  }

  private async startCompanySocket(
    companyId: string,
    appTokenSecretId: string,
    botTokenSecretId: string,
  ) {
    const appToken = await this.secrets.resolveSecretValue(companyId, appTokenSecretId, "latest");
    const botToken = await this.secrets.resolveSecretValue(companyId, botTokenSecretId, "latest");

    const sm = new SocketManager({ appToken, botToken });
    await sm.start(async (event) => {
      const router = this.getOrCreateRouter(companyId);
      await router.handleInboundMessage(event);
    });

    this.socketManagers.set(companyId, sm);
    log.info({ companyId }, "Per-company Slack socket started");
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
    const socketManager = this.getSocketManager(companyId);
    if (!socketManager) return;
    const sync = new EventSync(this.db, companyId, socketManager, channels);
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

export function initSlackBridge(db: Db, envConfig?: SlackSocketConfig): SlackBridgeService {
  _slackBridgeService = new SlackBridgeService(db, envConfig);
  return _slackBridgeService;
}

export function getSlackBridge(): SlackBridgeService | null {
  return _slackBridgeService;
}
