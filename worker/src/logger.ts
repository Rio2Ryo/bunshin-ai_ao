// Structured logging utility for Cloudflare Workers

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId: string;
  userId?: number;
  path?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
};

export type Logger = {
  info: (message: string, extra?: Partial<Omit<LogEntry, "level" | "message" | "timestamp" | "requestId">>) => void;
  warn: (message: string, extra?: Partial<Omit<LogEntry, "level" | "message" | "timestamp" | "requestId">>) => void;
  error: (message: string, extra?: Partial<Omit<LogEntry, "level" | "message" | "timestamp" | "requestId">>) => void;
};

export function createLogger(requestId: string): Logger {
  function emit(level: LogLevel, message: string, extra?: Partial<Omit<LogEntry, "level" | "message" | "timestamp" | "requestId">>) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      requestId,
      ...extra,
    };
    console[level](JSON.stringify(entry));
  }

  return {
    info: (message, extra) => emit("info", message, extra),
    warn: (message, extra) => emit("warn", message, extra),
    error: (message, extra) => emit("error", message, extra),
  };
}
