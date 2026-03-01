import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/trpc";

export type SSENotification = {
  id: number;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
};

type Options = {
  onNotification: (notif: SSENotification) => void;
  enabled: boolean;
};

/**
 * Connects to the SSE notification stream.
 * Auto-reconnects on disconnect (built-in EventSource behavior).
 * Uses withCredentials so the JWT cookie is sent cross-origin.
 */
export function useRealtimeNotifications({ onNotification, enabled }: Options): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Use ref so the latest callback is always called without re-creating EventSource
  const callbackRef = useRef(onNotification);
  callbackRef.current = onNotification;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const url = `${API_BASE}/api/notifications/stream`;
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => {
      setConnected(true);
    };

    es.addEventListener("notification", (event) => {
      try {
        const notif: SSENotification = JSON.parse(event.data);
        callbackRef.current(notif);
      } catch {
        // Ignore parse errors
      }
    });

    es.onerror = () => {
      setConnected(false);
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
