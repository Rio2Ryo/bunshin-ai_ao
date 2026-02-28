// Hono request logging middleware

import type { MiddlewareHandler } from "hono";
import { createLogger, type Logger } from "./logger";
import type { Env } from "./trpc";

// Augment Hono's context variables so c.get("logger") is typed
declare module "hono" {
  interface ContextVariableMap {
    logger: Logger;
    requestId: string;
  }
}

export function requestLogger(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const requestId = crypto.randomUUID();
    const logger = createLogger(requestId);

    c.set("requestId", requestId);
    c.set("logger", logger);

    const start = Date.now();
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    logger.info("request_start", { path, method });

    try {
      await next();
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorObj = err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { name: "UnknownError", message: String(err) };

      logger.error("unhandled_error", {
        path,
        method,
        durationMs,
        error: errorObj,
      });
      throw err;
    }

    const durationMs = Date.now() - start;
    const statusCode = c.res.status;

    if (statusCode >= 400) {
      logger.warn("request_complete", { path, method, statusCode, durationMs });
    } else {
      logger.info("request_complete", { path, method, statusCode, durationMs });
    }
  };
}
