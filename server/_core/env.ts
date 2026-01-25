export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Clawdbot Gateway settings (system-wide)
  // Note: Hardcoded for now to ensure production works. Update when ngrok URL changes.
  clawdbotGatewayUrl: process.env.CLAWDBOT_GATEWAY_URL || "https://e28a19488372.ngrok-free.app",
  clawdbotAuthToken: process.env.CLAWDBOT_AUTH_TOKEN || "e1f9299784aa90cc8d33e510557be3d0b86ba341ee51ab54",
  clawdbotAgentId: process.env.CLAWDBOT_AGENT_ID || "main",
};
