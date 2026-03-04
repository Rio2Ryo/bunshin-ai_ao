import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/trpc";

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

  const connect = useCallback(() => {
    if (!opts.enabled || !opts.sessionId) return;

    const wsBase = API_BASE.replace(/^http/, "ws");
    const url = `${wsBase}/api/matching/ws/${opts.sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

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
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect if not completed
      if (callbackRef.current.enabled && phase !== "complete") {
        reconnectTimeout.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      // Will trigger onclose
    };
  }, [opts.sessionId, opts.enabled, phase]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
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
