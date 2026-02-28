import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../worker/src/index";
import { Sentry } from "./sentry";

export const trpc = createTRPCReact<AppRouter>();

/** Shared API base URL — derived from the same env var used by the tRPC client in main.tsx */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

/** Report tRPC errors to Sentry in production */
export function reportTrpcError(error: unknown, context?: string) {
  if (typeof window !== "undefined" && import.meta.env.PROD) {
    Sentry.withScope((scope) => {
      if (context) scope.setTag("trpc.context", context);
      Sentry.captureException(error);
    });
  }
}
