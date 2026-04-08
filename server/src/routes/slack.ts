import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { slackCompanyConfig } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { getSlackBridge } from "../services/slack-bridge/index.js";

export function slackRoutes(db: Db) {
  const router = Router();

  // GET /api/companies/:companyId/slack/config
  router.get("/companies/:companyId/slack/config", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const [config] = await db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    res.json(config ?? { companyId, enabled: false, channels: {} });
  });

  // PUT /api/companies/:companyId/slack/config
  router.put("/companies/:companyId/slack/config", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const { enabled, channels } = req.body as {
      enabled?: boolean;
      channels?: Record<string, string>;
    };

    const [existing] = await db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    let config;
    if (existing) {
      const [updated] = await db
        .update(slackCompanyConfig)
        .set({
          enabled: enabled ?? existing.enabled,
          channels: channels ?? existing.channels,
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
          enabled: enabled ?? false,
          channels: channels ?? {},
        })
        .returning();
      config = created;
    }

    // Refresh the bridge for this company
    const bridge = getSlackBridge();
    if (bridge) {
      await bridge.refreshCompany(companyId);
    }

    res.json(config);
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
    const connected = bridge?.isConnected() ?? false;

    const [config] = await db
      .select()
      .from(slackCompanyConfig)
      .where(eq(slackCompanyConfig.companyId, companyId))
      .limit(1);

    res.json({
      connected,
      enabled: config?.enabled ?? false,
      channels: config?.channels ?? {},
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
    if (!bridge?.isConnected()) {
      res.status(503).json({ error: "Slack not connected" });
      return;
    }

    try {
      const ts = await bridge.getSocketManager()!.postMessage({
        channelId,
        text: message ?? "Test message from Paperclip Slack Bridge",
        username: "Paperclip",
      });
      res.json({ success: true, messageTs: ts });
    } catch (err) {
      res.status(500).json({ error: "Failed to send test message", detail: String(err) });
    }
  });

  return router;
}
