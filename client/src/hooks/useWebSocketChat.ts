import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/trpc";

export type WSChatMessage =
  | { type: "user_saved"; messageId: number }
  | { type: "typing_start" }
  | { type: "token"; content: string }
  | { type: "message_complete"; messageId: number; fullContent: string }
  | { type: "typing_end" }
  | { type: "error"; message: string };

type Options = {
  sessionId: number | null;
  enabled: boolean;
  onUserSaved?: (messageId: number) => void;
  onTypingStart?: () => void;
  onToken?: (token: string) => void;
  onMessageComplete?: (messageId: number, fullContent: string) => void;
  onTypingEnd?: () => void;
  onError?: (message: string) => void;
};

/**
 * WebSocket hook for streaming chat with the ChatRoom Durable Object.
 * Connects to /api/chat/ws/:sessionId.
 * Falls back gracefully — if WS fails, the caller uses tRPC mutation.
 */
export function useWebSocketChat(opts: Options) {
  const [connected, setConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef(opts);
  callbacksRef.current = opts;

  const connect = useCallback(() => {
    if (!opts.sessionId || !opts.enabled) return;

    // Build WebSocket URL from API_BASE
    const wsBase = API_BASE.replace(/^http/, "ws");
    const url = `${wsBase}/api/chat/ws/${opts.sessionId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: WSChatMessage = JSON.parse(event.data);
        const cb = callbacksRef.current;

        switch (data.type) {
          case "user_saved":
            cb.onUserSaved?.(data.messageId);
            break;
          case "typing_start":
            setIsStreaming(true);
            cb.onTypingStart?.();
            break;
          case "token":
            cb.onToken?.(data.content);
            break;
          case "message_complete":
            cb.onMessageComplete?.(data.messageId, data.fullContent);
            break;
          case "typing_end":
            setIsStreaming(false);
            cb.onTypingEnd?.();
            break;
          case "error":
            setIsStreaming(false);
            cb.onError?.(data.message);
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect after 3s if still enabled
      if (callbacksRef.current.enabled && callbacksRef.current.sessionId) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };
  }, [opts.sessionId, opts.enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setIsStreaming(false);
    };
  }, [connect]);

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "send", content }));
      return true;
    }
    return false;
  }, []);

  return { connected, isStreaming, sendMessage };
}
