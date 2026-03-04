import { mergeRouters } from "../trpc";
import { matchingCoreRouter } from "./matching-core";
import { matchingAnalysisRouter } from "./matching-analysis";
import { matchingSocialRouter } from "./matching-social";
import { matchingToolsRouter } from "./matching-tools";

export const matchingRouter = mergeRouters(
  matchingCoreRouter,
  matchingAnalysisRouter,
  matchingSocialRouter,
  matchingToolsRouter,
);
