import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/trpc";

export type WorkspaceUser = { userId: number; userName: string };
export type CursorPosition = { userId: number; userName: string; x: number; y: number };

type WorkspaceRoomOptions = {
  workspaceId: number;
  enabled: boolean;
  onItemUpdate?: (data: { itemId: number; changes: any; userId: number; userName: string }) => void;
  onItemAdd?: (data: { item: any; userId: number; userName: string }) => void;
  onItemDelete?: (data: { itemId: number; userId: number; userName: string }) => void;
};

const HEARTBEAT_INTERVAL = 30_000;
const PONG_TIMEOUT = 10_000;
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;

export function useWorkspaceRoom(options: WorkspaceRoomOptions) {
  const { workspaceId, enabled } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<WorkspaceUser[]>([]);
  const [cursors, setCursors] = useState<Map<number, CursorPosition>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;
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
    if (!enabled || !workspaceId) return;

    const wsUrl = API_BASE.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/workspace/ws/${workspaceId}`);

    ws.onopen = () => {
      setConnected(true);
      attemptRef.current = 0;
      startHeartbeat(ws);
      ws.send(JSON.stringify({ type: "presence" }));
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
          case "presence":
            setOnlineUsers(data.users || []);
            break;
          case "cursor":
            setCursors(prev => {
              const next = new Map(prev);
              next.set(data.userId, { userId: data.userId, userName: data.userName, x: data.x, y: data.y });
              return next;
            });
            break;
          case "item_update":
            callbacksRef.current.onItemUpdate?.(data);
            break;
          case "item_add":
            callbacksRef.current.onItemAdd?.(data);
            break;
          case "item_delete":
            callbacksRef.current.onItemDelete?.(data);
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      clearHeartbeat();
      setConnected(false);
      wsRef.current = null;
      if (callbacksRef.current.enabled) {
        const attempt = attemptRef.current;
        attemptRef.current = attempt + 1;
        const base = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
        const delay = base * (0.5 + Math.random() * 0.5);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [enabled, workspaceId, startHeartbeat, clearHeartbeat]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clearHeartbeat();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendCursor = useCallback((x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cursor", x, y }));
    }
  }, []);

  const broadcastItemUpdate = useCallback((itemId: number, changes: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "item_update", itemId, changes }));
    }
  }, []);

  const broadcastItemAdd = useCallback((item: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "item_add", item }));
    }
  }, []);

  const broadcastItemDelete = useCallback((itemId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "item_delete", itemId }));
    }
  }, []);

  return {
    connected,
    onlineUsers,
    cursors,
    sendCursor,
    broadcastItemUpdate,
    broadcastItemAdd,
    broadcastItemDelete,
  };
}
