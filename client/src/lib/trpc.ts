import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../worker/src/index";

export const trpc = createTRPCReact<AppRouter>();

/** Shared API base URL — derived from the same env var used by the tRPC client in main.tsx */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
