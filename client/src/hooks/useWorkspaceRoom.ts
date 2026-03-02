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

export function useWorkspaceRoom(options: WorkspaceRoomOptions) {
  const { workspaceId, enabled, onItemUpdate, onItemAdd, onItemDelete } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<WorkspaceUser[]>([]);
  const [cursors, setCursors] = useState<Map<number, CursorPosition>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !workspaceId) return;

    const wsUrl = API_BASE.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/workspace/ws/${workspaceId}`);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "presence" }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
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
            onItemUpdate?.(data);
            break;
          case "item_add":
            onItemAdd?.(data);
            break;
          case "item_delete":
            onItemDelete?.(data);
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (enabled) {
        reconnectTimerRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [enabled, workspaceId, onItemUpdate, onItemAdd, onItemDelete]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
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
