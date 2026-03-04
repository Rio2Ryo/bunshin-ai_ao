import { mergeRouters } from "../trpc";
import { twinsCoreRouter } from "./twins-core";
import { twinsLearningRouter } from "./twins-learning";
import { twinsToolsRouter } from "./twins-tools";

export const twinsRouter = mergeRouters(
  twinsCoreRouter,
  twinsLearningRouter,
  twinsToolsRouter,
);
