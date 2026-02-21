import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../worker/src/index";

export const trpc = createTRPCReact<AppRouter>();
