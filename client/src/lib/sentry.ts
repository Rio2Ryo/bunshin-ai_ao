import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";

export function initSentry() {
  if (!SENTRY_DSN || import.meta.env.DEV) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE || "production",
    release: `bunshin-ai@${import.meta.env.VITE_APP_VERSION || "0.0.0"}`,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],

    // Performance: sample 20% in production
    tracesSampleRate: 0.2,
    // Session Replay: 10% normal, 100% on error
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Ignore common non-actionable errors
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection",
      /^Loading chunk .* failed/,
      /^Network request failed/,
    ],

    beforeSend(event) {
      // Strip PII from error messages
      if (event.user) {
        delete event.user.ip_address;
      }
      return event;
    },
  });
}

export { Sentry };
