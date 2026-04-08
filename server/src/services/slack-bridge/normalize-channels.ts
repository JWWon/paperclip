import { logger as rootLogger } from "../../middleware/logger.js";

const logger = rootLogger.child({ module: "slack-bridge:normalize-channels" });

/**
 * Slack channel IDs always match this pattern:
 * - Start with C (public), D (DM), G (private/group), or W (enterprise)
 * - Followed by 8+ uppercase alphanumeric characters
 */
const SLACK_CHANNEL_ID_RE = /^[CDGW][A-Z0-9]{8,}$/;

function isChannelId(s: string): boolean {
  return SLACK_CHANNEL_ID_RE.test(s);
}

/**
 * Normalize channels from either legacy or new format into canonical format.
 *
 * Legacy format: { "engineering": "C01ABC1234" }  (label → channelId)
 * New format:    { "C01ABC1234": "engineering" }  (channelId → label)
 *
 * Returns: { channelId: label } (new canonical format)
 */
export function normalizeChannels(raw: Record<string, string> | null | undefined): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};

  const entries = Object.entries(raw);
  if (entries.length === 0) return {};

  const keysAreChannelIds = entries.every(([k]) => isChannelId(k));
  const valuesAreChannelIds = entries.every(([, v]) => typeof v === "string" && isChannelId(v));

  if (keysAreChannelIds) {
    // Already in new format: { channelId: label } — validate values are strings
    const valid: Record<string, string> = {};
    for (const [k, v] of entries) {
      valid[k] = typeof v === "string" ? v : "";
    }
    return valid;
  }

  if (valuesAreChannelIds) {
    // Legacy format: { label: channelId } — swap to { channelId: label }
    const normalized: Record<string, string> = {};
    for (const [label, channelId] of entries) {
      normalized[channelId] = label;
    }
    return normalized;
  }

  // Mixed or invalid — can't determine format
  logger.warn({ keys: Object.keys(raw) }, "Cannot normalize Slack channels: mixed or invalid format, returning empty");
  return {};
}
