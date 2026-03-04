/**
 * Global error handling utilities for tRPC + D1.
 * Writes errors to error_logs table and sends Slack alerts for critical errors.
 */
import type { Env } from "./trpc";

/** Write an error to the error_logs D1 table. Fire-and-forget (never throws). */
export async function writeErrorLog(
  db: D1Database,
  opts: {
    level: "error" | "warn" | "info";
    path: string;
    message: string;
    context?: string;
    userId?: number;
  }
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO error_logs (level, path, message, context, userId) VALUES (?, ?, ?, ?, ?)`
    ).bind(
      opts.level,
      opts.path,
      opts.message.slice(0, 2000),  // Truncate long messages
      opts.context?.slice(0, 5000) ?? null,
      opts.userId ?? null,
    ).run();
  } catch {
    // Never let error logging break the request
  }
}

/** Send a Slack notification for critical errors. Fire-and-forget. */
export async function notifySlackError(
  webhookUrl: string,
  opts: { path: string; message: string; userId?: number }
): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 *分身AI エラー*\nPath: \`${opts.path}\`\nMessage: ${opts.message.slice(0, 500)}${opts.userId ? `\nUser: ${opts.userId}` : ""}`,
      }),
    });
  } catch {
    // Never let Slack notification break the request
  }
}
