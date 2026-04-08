import { api } from "./client";

export interface SlackConfig {
  enabled: boolean;
  channels: Record<string, string>;
  appTokenConfigured: boolean;
  botTokenConfigured: boolean;
}

export interface SlackPersona {
  agentId: string;
  agentName: string;
  displayName: string;
  iconUrl: string | null;
  slackChannelIds: string[];
}

export interface SlackStatus {
  connected: boolean;
  enabled: boolean;
  channels: Record<string, string>;
}

export interface SlackTestMessageRequest {
  channelId: string;
  message?: string;
}

export interface SlackThreadMapping {
  slackChannelId: string;
  slackThreadTs: string;
}

export const slackApi = {
  getIssueThread: (companyId: string, issueId: string) =>
    api.get<SlackThreadMapping | null>(`/companies/${companyId}/slack/issues/${encodeURIComponent(issueId)}/thread`),

  getConfig: (companyId: string) =>
    api.get<SlackConfig>(`/companies/${companyId}/slack/config`),

  updateConfig: (companyId: string, data: { enabled?: boolean; channels?: Record<string, string>; appToken?: string; botToken?: string }) =>
    api.put<SlackConfig>(`/companies/${companyId}/slack/config`, data),

  getPersonas: (companyId: string) =>
    api.get<SlackPersona[]>(`/companies/${companyId}/slack/personas`),

  updatePersona: (
    companyId: string,
    agentId: string,
    data: { displayName?: string; iconUrl?: string | null; slackChannelIds?: string[] },
  ) =>
    api.put<SlackPersona>(
      `/companies/${companyId}/slack/personas/${encodeURIComponent(agentId)}`,
      data,
    ),

  getStatus: (companyId: string) =>
    api.get<SlackStatus>(`/companies/${companyId}/slack/status`),

  sendTestMessage: (companyId: string, data: SlackTestMessageRequest) =>
    api.post<{ ok: true }>(`/companies/${companyId}/slack/test-message`, data),
};
