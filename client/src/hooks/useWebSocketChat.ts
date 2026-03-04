import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/trpc";

export type WSChatMessage =
  | { type: "user_saved"; messageId: number }
  | { type: "typing_start" }
  | { type: "token"; content: string }
  | { type: "message_complete"; messageId: number; fullContent: string }
  | { type: "typing_end" }
  | { type: "error"; message: string }
  | { type: "pong" };

type Options = {
  sessionId: number | null;
  enabled: boolean;
  onUserSaved?: (messageId: number) => void;
  onTypingStart?: () => void;
  onToken?: (token: string) => void;
  onMessageComplete?: (messageId: number, fullContent: string) => void;
  onTypingEnd?: () => void;
  onError?: (message: string) => void;
  onReconnected?: () => void;
};

/**
 * WebSocket hook for streaming chat with the ChatRoom Durable Object.
 * Connects to /api/chat/ws/:sessionId.
 * Falls back gracefully — if WS fails, the caller uses tRPC mutation.
 */
export function useWebSocketChat(opts: Options) {
  const [connected, setConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPongAt = useRef<number>(0);
  const attemptCount = useRef<number>(0);
  const hasConnectedBefore = useRef<boolean>(false);
  const callbacksRef = useRef(opts);
  callbacksRef.current = opts;

  const clearHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = null;
    }
  }, []);

  const clearStreamingSafetyTimer = useCallback(() => {
    if (streamingSafetyTimer.current) {
      clearTimeout(streamingSafetyTimer.current);
      streamingSafetyTimer.current = null;
    }
  }, []);

  const startStreamingSafetyTimer = useCallback(() => {
    clearStreamingSafetyTimer();
    streamingSafetyTimer.current = setTimeout(() => {
      setIsStreaming(false);
    }, 15_000);
  }, [clearStreamingSafetyTimer]);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    clearHeartbeat();
    lastPongAt.current = Date.now();

    heartbeatInterval.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearHeartbeat();
        return;
      }

      const timeSinceLastPong = Date.now() - lastPongAt.current;
      if (timeSinceLastPong > 40_000) {
        clearHeartbeat();
        ws.close();
        return;
      }

      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        clearHeartbeat();
        ws.close();
      }
    }, 30_000);
  }, [clearHeartbeat]);

  const getReconnectDelay = useCallback(() => {
    const base = Math.min(1000 * Math.pow(2, attemptCount.current), 30_000);
    return base * (0.5 + Math.random() * 0.5);
  }, []);

  const connect = useCallback(() => {
    if (!opts.sessionId || !opts.enabled) return;

    const wsBase = API_BASE.replace(/^http/, "ws");
    const url = `${wsBase}/api/chat/ws/${opts.sessionId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      const isReconnect = hasConnectedBefore.current;
      hasConnectedBefore.current = true;
      attemptCount.current = 0;
      setConnected(true);
      setReconnecting(false);
      startHeartbeat(ws);

      if (isReconnect) {
        callbacksRef.current.onReconnected?.();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WSChatMessage = JSON.parse(event.data);
        const cb = callbacksRef.current;

        switch (data.type) {
          case "pong":
            lastPongAt.current = Date.now();
            break;
          case "user_saved":
            cb.onUserSaved?.(data.messageId);
            break;
          case "typing_start":
            setIsStreaming(true);
            startStreamingSafetyTimer();
            cb.onTypingStart?.();
            break;
          case "token":
            startStreamingSafetyTimer();
            cb.onToken?.(data.content);
            break;
          case "message_complete":
            clearStreamingSafetyTimer();
            cb.onMessageComplete?.(data.messageId, data.fullContent);
            break;
          case "typing_end":
            clearStreamingSafetyTimer();
            setIsStreaming(false);
            cb.onTypingEnd?.();
            break;
          case "error":
            clearStreamingSafetyTimer();
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
      setIsStreaming(false);
      clearStreamingSafetyTimer();
    };

    ws.onclose = () => {
      setConnected(false);
      setIsStreaming(false);
      clearStreamingSafetyTimer();
      clearHeartbeat();
      wsRef.current = null;

      if (callbacksRef.current.enabled && callbacksRef.current.sessionId) {
        attemptCount.current += 1;
        setReconnecting(true);
        const delay = getReconnectDelay();
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };
  }, [opts.sessionId, opts.enabled, startHeartbeat, clearHeartbeat, getReconnectDelay, startStreamingSafetyTimer, clearStreamingSafetyTimer]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      clearHeartbeat();
      clearStreamingSafetyTimer();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setIsStreaming(false);
      setReconnecting(false);
      hasConnectedBefore.current = false;
      attemptCount.current = 0;
    };
  }, [connect, clearHeartbeat, clearStreamingSafetyTimer]);

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "send", content }));
      return true;
    }
    return false;
  }, []);

  return { connected, isStreaming, reconnecting, sendMessage };
}
