import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Plus, Trash2, Send, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { slackApi, type SlackPersona } from "../api/slack";
import { Field, ToggleField } from "../components/agent-config-primitives";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

const SLACK_QUERY_KEYS = {
  config: (companyId: string) => ["slack", "config", companyId] as const,
  personas: (companyId: string) => ["slack", "personas", companyId] as const,
  status: (companyId: string) => ["slack", "status", companyId] as const,
};

export function SlackSettings() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  // Config state
  const [enabled, setEnabled] = useState(false);
  const [channels, setChannels] = useState<{ key: string; value: string }[]>([]);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [appToken, setAppToken] = useState("");
  const [botToken, setBotToken] = useState("");

  // Persona edit state
  const [editingPersona, setEditingPersona] = useState<string | null>(null);
  const [personaEdits, setPersonaEdits] = useState<Record<string, { displayName: string; iconUrl: string; channels: string }>>({});

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: SLACK_QUERY_KEYS.config(selectedCompanyId!),
    queryFn: () => slackApi.getConfig(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: personas, isLoading: personasLoading } = useQuery({
    queryKey: SLACK_QUERY_KEYS.personas(selectedCompanyId!),
    queryFn: () => slackApi.getPersonas(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: status } = useQuery({
    queryKey: SLACK_QUERY_KEYS.status(selectedCompanyId!),
    queryFn: () => slackApi.getStatus(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    const channelEntries = Object.entries(config.channels ?? {}).map(([key, value]) => ({ key, value }));
    setChannels(channelEntries.length > 0 ? channelEntries : []);
  }, [config]);

  const updateConfigMutation = useMutation({
    mutationFn: (data: { enabled?: boolean; channels?: Record<string, string>; appToken?: string; botToken?: string }) =>
      slackApi.updateConfig(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SLACK_QUERY_KEYS.config(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: SLACK_QUERY_KEYS.status(selectedCompanyId!) });
      setAppToken("");
      setBotToken("");
      pushToast({ title: "Slack configuration saved", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "Failed to save Slack configuration",
        body: err instanceof Error ? err.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const updatePersonaMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: { displayName?: string; iconUrl?: string | null; slackChannelIds?: string[] } }) =>
      slackApi.updatePersona(selectedCompanyId!, agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SLACK_QUERY_KEYS.personas(selectedCompanyId!) });
      setEditingPersona(null);
      pushToast({ title: "Persona saved", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "Failed to save persona",
        body: err instanceof Error ? err.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const testMessageMutation = useMutation({
    mutationFn: (channelId: string) =>
      slackApi.sendTestMessage(selectedCompanyId!, { channelId, message: "Test message from Paperclip dashboard" }),
    onSuccess: () => pushToast({ title: "Test message sent", tone: "success" }),
    onError: (err) => pushToast({
      title: "Failed to send test message",
      body: err instanceof Error ? err.message : "Unknown error",
      tone: "error",
    }),
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Slack" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">No company selected.</div>;
  }

  function handleSaveConfig() {
    const channelMap: Record<string, string> = {};
    for (const { key, value } of channels) {
      if (key.trim()) channelMap[key.trim()] = value.trim();
    }
    updateConfigMutation.mutate({
      enabled,
      channels: channelMap,
      ...(appToken ? { appToken } : {}),
      ...(botToken ? { botToken } : {}),
    });
  }

  function handleSavePersona(persona: SlackPersona) {
    const edit = personaEdits[persona.agentId];
    if (!edit) return;
    const channelIds = edit.channels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    updatePersonaMutation.mutate({
      agentId: persona.agentId,
      data: {
        displayName: edit.displayName,
        iconUrl: edit.iconUrl || null,
        slackChannelIds: channelIds,
      },
    });
  }

  function startEditPersona(persona: SlackPersona) {
    setEditingPersona(persona.agentId);
    setPersonaEdits((prev) => ({
      ...prev,
      [persona.agentId]: {
        displayName: persona.displayName,
        iconUrl: persona.iconUrl ?? "",
        channels: (persona.slackChannelIds ?? []).join(", "),
      },
    }));
  }

  const isConnected = status?.connected ?? false;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Slack Integration</h1>
        {/* Connection status dot */}
        <span className="flex items-center gap-1.5 ml-2 text-xs text-muted-foreground">
          <span
            className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
          />
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {!isConnected && enabled && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Slack connection is not active. Check your tokens and server logs.
        </div>
      )}

      {/* Enable / Disable */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">General</div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Enable Slack integration"
            hint="Connect this company to a Slack workspace via Socket Mode."
            checked={enabled}
            onChange={setEnabled}
          />
        </div>
      </div>

      {/* Tokens */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tokens</div>
        <div className="rounded-md border border-border px-4 py-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">App Token</label>
              {config?.appTokenConfigured ? (
                <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Configured</span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Not configured</span>
              )}
            </div>
            <input
              type="password"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              placeholder="Enter new app token or leave blank to keep existing"
              value={appToken}
              onChange={(e) => setAppToken(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Bot Token</label>
              {config?.botTokenConfigured ? (
                <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Configured</span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Not configured</span>
              )}
            </div>
            <input
              type="password"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              placeholder="Enter new bot token or leave blank to keep existing"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Setup Guide */}
      <Collapsible open={setupGuideOpen} onOpenChange={setSetupGuideOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors">
            {setupGuideOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Setup Guide
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-5 rounded-md border border-border px-5 py-5 text-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">1</span>
                <span className="font-medium">Create a Slack App</span>
              </div>
              <div className="ml-7 space-y-1.5 text-xs text-muted-foreground">
                <p>Go to <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">api.slack.com/apps</code> and create a new app from scratch.</p>
                <p>Then enable <strong className="text-foreground">Socket Mode</strong>:</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  <li>Settings → Socket Mode → Toggle on</li>
                  <li>Generate an <strong className="text-foreground">App-Level Token</strong> with the <code className="rounded bg-muted px-1 py-0.5 font-mono">connections:write</code> scope</li>
                  <li>Copy the token (starts with <code className="rounded bg-muted px-1 py-0.5 font-mono">xapp-</code>) — this is your <strong className="text-foreground">App Token</strong></li>
                </ul>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">2</span>
                <span className="font-medium">Configure Bot Scopes</span>
              </div>
              <div className="ml-7 space-y-1.5 text-xs text-muted-foreground">
                <p>Go to <strong className="text-foreground">OAuth &amp; Permissions</strong> → Bot Token Scopes → Add:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {["app_mentions:read", "channels:history", "channels:read", "chat:write", "chat:write.customize", "users:read"].map((scope) => (
                    <code key={scope} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{scope}</code>
                  ))}
                </div>
                <p className="mt-1.5">Install the app to your workspace, then copy the <strong className="text-foreground">Bot User OAuth Token</strong> (starts with <code className="rounded bg-muted px-1 py-0.5 font-mono">xoxb-</code>).</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">3</span>
                <span className="font-medium">Subscribe to Events</span>
              </div>
              <div className="ml-7 space-y-1.5 text-xs text-muted-foreground">
                <p>Go to <strong className="text-foreground">Event Subscriptions</strong> → Enable Events → Subscribe to bot events:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {["app_mention", "message.channels"].map((evt) => (
                    <code key={evt} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{evt}</code>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">4</span>
                <span className="font-medium">Enter Tokens</span>
              </div>
              <div className="ml-7 text-xs text-muted-foreground">
                <p>Paste the <strong className="text-foreground">App Token</strong> and <strong className="text-foreground">Bot Token</strong> into the fields above and save. Tokens are encrypted at rest and never displayed after saving.</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">5</span>
                <span className="font-medium">Map Channels &amp; Personas</span>
              </div>
              <div className="ml-7 space-y-1.5 text-xs text-muted-foreground">
                <p>Enable the integration toggle above, then:</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  <li>Add <strong className="text-foreground">channel mappings</strong> — map a group name to a Slack channel ID</li>
                  <li>Configure <strong className="text-foreground">agent personas</strong> — set a display name, avatar, and assigned channels for each agent</li>
                </ul>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">6</span>
                <span className="font-medium">Invite the Bot</span>
              </div>
              <div className="ml-7 text-xs text-muted-foreground">
                <p>In each Slack channel you mapped, invite the bot:</p>
                <code className="mt-1 block rounded bg-muted px-3 py-1.5 font-mono text-[11px]">/invite @your-bot-name</code>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Channel Mappings */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Channel Mappings</div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <p className="text-xs text-muted-foreground">Map functional group names to Slack channel IDs.</p>
          {configLoading ? (
            <div className="text-xs text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-2">
              {channels.map((ch, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    placeholder="Group name (e.g. leadership)"
                    value={ch.key}
                    onChange={(e) => {
                      const next = [...channels];
                      next[i] = { ...next[i]!, key: e.target.value };
                      setChannels(next);
                    }}
                  />
                  <span className="text-muted-foreground text-xs">→</span>
                  <input
                    className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                    placeholder="Channel ID (e.g. C01ABC123)"
                    value={ch.value}
                    onChange={(e) => {
                      const next = [...channels];
                      next[i] = { ...next[i]!, value: e.target.value };
                      setChannels(next);
                    }}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setChannels((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  {ch.value && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testMessageMutation.isPending}
                      onClick={() => testMessageMutation.mutate(ch.value)}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Test
                    </Button>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChannels((prev) => [...prev, { key: "", value: "" }])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add channel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSaveConfig}
          disabled={updateConfigMutation.isPending}
        >
          {updateConfigMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            "Save configuration"
          )}
        </Button>
      </div>

      {/* Agent Personas */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Personas</div>
        <div className="rounded-md border border-border divide-y divide-border">
          {personasLoading ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">Loading...</div>
          ) : !personas || personas.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No agents found. Create agents to configure their Slack personas.
            </div>
          ) : (
            personas.map((persona) => {
              const isEditing = editingPersona === persona.agentId;
              const edit = personaEdits[persona.agentId];
              return (
                <div key={persona.agentId} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {persona.iconUrl && (
                        <img
                          src={persona.iconUrl}
                          alt={persona.displayName}
                          className="h-6 w-6 rounded-full shrink-0 object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{persona.agentName}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {persona.displayName || <span className="italic">No display name</span>}
                        </div>
                      </div>
                    </div>
                    {!isEditing && (
                      <Button size="sm" variant="outline" onClick={() => startEditPersona(persona)}>
                        Edit
                      </Button>
                    )}
                  </div>
                  {isEditing && edit && (
                    <div className="space-y-2 pt-1">
                      <Field label="Display name" hint="Name shown in Slack messages.">
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                          value={edit.displayName}
                          onChange={(e) =>
                            setPersonaEdits((prev) => ({
                              ...prev,
                              [persona.agentId]: { ...prev[persona.agentId]!, displayName: e.target.value },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Avatar URL" hint="Image URL for the Slack avatar.">
                        <div className="flex items-center gap-2">
                          <input
                            className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                            value={edit.iconUrl}
                            onChange={(e) =>
                              setPersonaEdits((prev) => ({
                                ...prev,
                                [persona.agentId]: { ...prev[persona.agentId]!, iconUrl: e.target.value },
                              }))
                            }
                            placeholder="https://..."
                          />
                          {edit.iconUrl && (
                            <img
                              src={edit.iconUrl}
                              alt="preview"
                              className="h-8 w-8 rounded-full object-cover shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          )}
                        </div>
                      </Field>
                      <Field label="Assigned channels" hint="Comma-separated Slack channel IDs (e.g. C01ABC123, C02DEF456).">
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                          value={edit.channels}
                          onChange={(e) =>
                            setPersonaEdits((prev) => ({
                              ...prev,
                              [persona.agentId]: { ...prev[persona.agentId]!, channels: e.target.value },
                            }))
                          }
                          placeholder="C01ABC123, C02DEF456"
                        />
                      </Field>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => handleSavePersona(persona)}
                          disabled={updatePersonaMutation.isPending}
                        >
                          {updatePersonaMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingPersona(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  {!isEditing && (persona.slackChannelIds ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(persona.slackChannelIds ?? []).map((ch) => (
                        <span
                          key={ch}
                          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
