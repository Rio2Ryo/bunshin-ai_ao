export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Phase 1 (Cloudflare MVP): auth is disabled.
// Keep this function for compatibility with existing UI, but make it safe when
// env vars are not provided.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  // If auth env vars are missing, return a harmless in-app URL.
  if (!oauthPortalUrl || !appId) return "/twins";

  // Generate login URL at runtime so redirect URI reflects the current origin.
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl.replace(/\/$/, "")}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
