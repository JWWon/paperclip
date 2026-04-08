import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { slackCompanyConfig } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { getSlackBridge } from "../services/slack-bridge/index.js";
import { normalizeChannels } from "../services/slack-bridge/normalize-channels.js";
import { logger } from "../middleware/logger.js";
import { secretService } from "../services/secrets.js";
import { logActivity } from "../services/activity-log.js";

export function slackRoutes(db: Db) {
  const router = Router();
  const secretSvc = secretService(db);

  async function upsertTokenSecret(
    companyId: string,
    tokenName: string,
    tokenValue: string,
    actor: { userId?: string | null },
  ): Promise<string> {
    const existing = await secretSvc.getByName(companyId, tokenName);
    if (existing) {
      await secretSvc.rotate(existing.id, { value: tokenValue }, { userId: actor.userId ?? null, agentId: null });
      return existing.id;
    }
    const created = await secretSvc.create(
      companyId,
      { name: tokenName, value: tokenValue, provider: "local_encrypted" },
      { userId: actor.userId ?? null, agentId: null },
    );
    return created.id;
  }

  // GET /api/companies/:companyId/slack/config
  router.get("/companies/:companyId/slack/config", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const [config] = await db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    if (!config) {
      res.json({ companyId, enabled: false, channels: {}, appTokenConfigured: false, botTokenConfigured: false });
      return;
    }

    const { appTokenSecretId, botTokenSecretId, channels: rawChannels, ...safeConfig } = config;
    res.json({
      ...safeConfig,
      channels: normalizeChannels(rawChannels as Record<string, string>),
      appTokenConfigured: appTokenSecretId != null,
      botTokenConfigured: botTokenSecretId != null,
    });
  });

  // PUT /api/companies/:companyId/slack/config
  router.put("/companies/:companyId/slack/config", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const { enabled, channels: rawChannels, appToken, botToken } = req.body as {
      enabled?: boolean;
      channels?: Record<string, string>;
      appToken?: string;
      botToken?: string;
    };
    // Normalize channels to canonical {channelId: label} format on write
    const channels = rawChannels ? normalizeChannels(rawChannels) : undefined;

    const actor = { userId: req.actor.userId ?? "board" };

    const [existing] = await db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (enabled !== undefined) patch.enabled = enabled;
    if (channels !== undefined) patch.channels = channels;

    if (appToken) {
      patch.appTokenSecretId = await upsertTokenSecret(companyId, "slack:app_token", appToken, actor);
    }
    if (botToken) {
      patch.botTokenSecretId = await upsertTokenSecret(companyId, "slack:bot_token", botToken, actor);
    }

    let config;
    if (existing) {
      const [updated] = await db
        .update(slackCompanyConfig)
        .set({
          enabled: (patch.enabled as boolean | undefined) ?? existing.enabled,
          channels: (patch.channels as Record<string, string> | undefined) ?? normalizeChannels(existing.channels as Record<string, string>),
          appTokenSecretId: (patch.appTokenSecretId as string | undefined) ?? existing.appTokenSecretId,
          botTokenSecretId: (patch.botTokenSecretId as string | undefined) ?? existing.botTokenSecretId,
          updatedAt: new Date(),
        })
        .where(eq(slackCompanyConfig.id, existing.id))
        .returning();
      config = updated;
    } else {
      const [created] = await db
        .insert(slackCompanyConfig)
        .values({
          companyId,
          enabled: (patch.enabled as boolean | undefined) ?? false,
          channels: (patch.channels as Record<string, string> | undefined) ?? {},
          appTokenSecretId: (patch.appTokenSecretId as string | undefined) ?? null,
          botTokenSecretId: (patch.botTokenSecretId as string | undefined) ?? null,
        })
        .returning();
      config = created;
    }

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: actor.userId,
      action: "slack.config.updated",
      entityType: "slack_company_config",
      entityId: config.id,
      details: {
        enabled: config.enabled,
        appTokenUpdated: !!appToken,
        botTokenUpdated: !!botToken,
      },
    });

    // Refresh the bridge for this company
    const bridge = getSlackBridge();
    if (bridge) {
      await bridge.refreshCompany(companyId);
    }

    const { appTokenSecretId: _a, botTokenSecretId: _b, channels: putRawChannels, ...safeConfig } = config;
    res.json({
      ...safeConfig,
      channels: normalizeChannels(putRawChannels as Record<string, string>),
      appTokenConfigured: _a != null,
      botTokenConfigured: _b != null,
    });
  });

  // GET /api/companies/:companyId/slack/personas
  router.get("/companies/:companyId/slack/personas", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const bridge = getSlackBridge();
    if (!bridge) {
      res.json([]);
      return;
    }

    const personas = await bridge.getPersonaManager(companyId).listByCompany(companyId);
    res.json(personas);
  });

  // PUT /api/companies/:companyId/slack/personas/:agentId
  router.put("/companies/:companyId/slack/personas/:agentId", async (req, res) => {
    const { companyId, agentId } = req.params;
    assertCompanyAccess(req, companyId);

    const { displayName, iconUrl, slackChannelIds } = req.body as {
      displayName: string;
      iconUrl?: string | null;
      slackChannelIds?: string[];
    };

    const bridge = getSlackBridge();
    if (!bridge) {
      res.status(503).json({ error: "Slack bridge not initialized" });
      return;
    }

    const persona = await bridge.getPersonaManager(companyId).upsert({
      companyId,
      agentId,
      displayName,
      iconUrl,
      slackChannelIds,
    });

    res.json(persona);
  });

  // GET /api/companies/:companyId/slack/status
  router.get("/companies/:companyId/slack/status", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const bridge = getSlackBridge();
    const connected = bridge?.isConnected(companyId) ?? false;

    const [config] = await db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    res.json({
      connected,
      enabled: config?.enabled ?? false,
      channels: normalizeChannels(config?.channels as Record<string, string>),
    });
  });

  // POST /api/companies/:companyId/slack/test-message
  router.post("/companies/:companyId/slack/test-message", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const { channelId, message } = req.body as {
      channelId: string;
      message?: string;
    };

    const bridge = getSlackBridge();
    if (!bridge?.isConnected(companyId)) {
      res.status(503).json({ error: "Slack not connected" });
      return;
    }

    try {
      const ts = await bridge.getSocketManager(companyId)!.postMessage({
        channelId,
        text: message ?? "Test message from Paperclip Slack Bridge",
        username: "Paperclip",
      });
      res.json({ success: true, messageTs: ts });
    } catch (err) {
      logger.error({ err }, "Failed to send Slack test message");
      res.status(500).json({ error: "Failed to send test message" });
    }
  });

  return router;
}
