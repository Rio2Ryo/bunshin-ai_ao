import { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export type MatchingTurn = {
  turnNumber: number;
  speakerTwinId: number;
  speakerName: string;
  content: string;
};

export type MatchingAnalysis = {
  compatibilityScore: number;
  summary: string;
  strengths: string[];
  challenges: string[];
  recommendations: string[];
  scoreBreakdown: Record<string, { score: number; reason: string }>;
  collaborationPotential?: string;
};

type Options = {
  sessionId: number;
  enabled: boolean;
  onTurn: (turn: MatchingTurn) => void;
  onAnalysisStart: () => void;
  onAnalysisComplete: (analysis: MatchingAnalysis) => void;
  onComplete: () => void;
  onError: (message: string) => void;
};

export function useMatchingStream(opts: Options): { connected: boolean; phase: "idle" | "dialogue" | "analysis" | "complete" } {
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<"idle" | "dialogue" | "analysis" | "complete">("idle");
  const esRef = useRef<EventSource | null>(null);
  const callbackRef = useRef(opts);
  callbackRef.current = opts;

  useEffect(() => {
    if (!opts.enabled || !opts.sessionId) return;

    const url = `${API_BASE}/api/matching/stream/${opts.sessionId}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setPhase("dialogue");
    };

    es.addEventListener("turn", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as MatchingTurn;
        callbackRef.current.onTurn(data);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener("analysis_start", () => {
      setPhase("analysis");
      callbackRef.current.onAnalysisStart();
    });

    es.addEventListener("analysis_complete", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as MatchingAnalysis;
        callbackRef.current.onAnalysisComplete(data);
      } catch { /* ignore */ }
    });

    es.addEventListener("complete", () => {
      setPhase("complete");
      callbackRef.current.onComplete();
      es.close();
    });

    es.addEventListener("error", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        callbackRef.current.onError(data.message || "ストリームエラー");
      } catch {
        callbackRef.current.onError("接続エラー");
      }
    });

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects, but if the stream ended, close it
      if (es.readyState === EventSource.CLOSED) {
        setPhase("complete");
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [opts.sessionId, opts.enabled]);

  return { connected, phase };
}
