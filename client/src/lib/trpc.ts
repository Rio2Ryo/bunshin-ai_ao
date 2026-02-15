import { createTRPCReact } from "@trpc/react-query";

// Phase 1: Cloudflare Worker is the source of truth for the API router.
// (The Node server router types can diverge and break the client build.)
import type { AppRouter } from "../../../worker/src/index";

export const trpc = createTRPCReact<AppRouter>();
