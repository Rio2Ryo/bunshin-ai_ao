export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Clawdbot Gateway settings (system-wide default, can be overridden per-user in DB)
  clawdbotGatewayUrl: process.env.CLAWDBOT_GATEWAY_URL ?? "",
  clawdbotAuthToken: process.env.CLAWDBOT_AUTH_TOKEN ?? "",
  clawdbotAgentId: process.env.CLAWDBOT_AGENT_ID ?? "",
};
