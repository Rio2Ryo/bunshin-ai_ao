import { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export type MatchingComment = {
  userId: number;
  userName: string;
  turnNumber: number | null;
  content: string;
  commentId: number;
};

export type MatchingReaction = {
  userId: number;
  turnNumber: number;
  reactionType: string;
  reactionId: number;
};

type Options = {
  sessionId: number;
  enabled: boolean;
  onTurn: (turn: { turnNumber: number; speakerTwinId: number; speakerName: string; content: string }) => void;
  onAnalysisStart: () => void;
  onAnalysisComplete: (analysis: any) => void;
  onComplete: () => void;
  onError: (message: string) => void;
  onComment?: (comment: MatchingComment) => void;
  onReaction?: (reaction: MatchingReaction) => void;
  onViewerCount?: (count: number) => void;
};

const HEARTBEAT_INTERVAL = 30_000;
const PONG_TIMEOUT = 10_000;
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;

export function useMatchingRoom(opts: Options): {
  connected: boolean;
  phase: "idle" | "dialogue" | "analysis" | "complete";
  sendComment: (turnNumber: number | null, content: string) => void;
  sendReaction: (turnNumber: number, type: string) => void;
  viewerCount: number;
  start: () => void;
} {
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<"idle" | "dialogue" | "analysis" | "complete">("idle");
  const [viewerCount, setViewerCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const callbackRef = useRef(opts);
  callbackRef.current = opts;
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const attemptRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (pongTimerRef.current) {
      clearTimeout(pongTimerRef.current);
      pongTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    clearHeartbeat();
    heartbeatRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
        pongTimerRef.current = setTimeout(() => {
          ws.close();
        }, PONG_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, [clearHeartbeat]);

  const connect = useCallback(() => {
    if (!opts.enabled || !opts.sessionId) return;

    const wsBase = API_BASE.replace(/^http/, "ws");
    const url = `${wsBase}/api/matching/ws/${opts.sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      attemptRef.current = 0;
      startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "pong") {
          if (pongTimerRef.current) {
            clearTimeout(pongTimerRef.current);
            pongTimerRef.current = null;
          }
          return;
        }

        switch (data.type) {
          case "turn":
            setPhase("dialogue");
            callbackRef.current.onTurn(data);
            break;
          case "analysis_start":
            setPhase("analysis");
            callbackRef.current.onAnalysisStart();
            break;
          case "analysis_complete":
            callbackRef.current.onAnalysisComplete(data);
            break;
          case "complete":
            setPhase("complete");
            callbackRef.current.onComplete();
            break;
          case "error":
            callbackRef.current.onError(data.message || "WebSocketエラー");
            break;
          case "comment":
            callbackRef.current.onComment?.(data);
            break;
          case "reaction":
            callbackRef.current.onReaction?.(data);
            break;
          case "viewers":
            setViewerCount(data.count);
            callbackRef.current.onViewerCount?.(data.count);
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      clearHeartbeat();
      setConnected(false);
      wsRef.current = null;
      if (callbackRef.current.enabled && phaseRef.current !== "complete") {
        const attempt = attemptRef.current;
        attemptRef.current = attempt + 1;
        const base = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
        const delay = base * (0.5 + Math.random() * 0.5);
        reconnectTimeout.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {};
  }, [opts.sessionId, opts.enabled, startHeartbeat, clearHeartbeat]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      clearHeartbeat();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [opts.sessionId, opts.enabled]);

  const sendComment = useCallback((turnNumber: number | null, content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "comment", turnNumber, content }));
    }
  }, []);

  const sendReaction = useCallback((turnNumber: number, type: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reaction", turnNumber, reactionType: type }));
    }
  }, []);

  const start = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "start" }));
      setPhase("dialogue");
    }
  }, []);

  return { connected, phase, sendComment, sendReaction, viewerCount, start };
}
