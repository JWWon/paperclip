import * as p from "@clack/prompts";

export interface SlackTokens {
  appToken: string;
  botToken: string;
}

export async function promptSlackTokens(): Promise<SlackTokens | null> {
  const appToken = await p.password({
    message: "Slack App Token (xapp-...)",
    validate: (value) => {
      if (!value || value.trim().length === 0) return "App Token is required";
      if (!value.trim().startsWith("xapp-")) return "App Token must start with xapp-";
    },
  });

  if (p.isCancel(appToken)) {
    p.cancel("Slack configuration cancelled.");
    return null;
  }

  const botToken = await p.password({
    message: "Slack Bot Token (xoxb-...)",
    validate: (value) => {
      if (!value || value.trim().length === 0) return "Bot Token is required";
      if (!value.trim().startsWith("xoxb-")) return "Bot Token must start with xoxb-";
    },
  });

  if (p.isCancel(botToken)) {
    p.cancel("Slack configuration cancelled.");
    return null;
  }

  return {
    appToken: appToken.trim(),
    botToken: botToken.trim(),
  };
}
