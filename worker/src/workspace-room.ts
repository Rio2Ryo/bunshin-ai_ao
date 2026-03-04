/**
 * WorkspaceRoom Durable Object — manages WebSocket connections for real-time workspace collaboration.
 * Uses the Hibernation API for multi-user real-time editing.
 *
 * Protocol (client -> server):
 *   { type: "cursor", x: number, y: number }
 *   { type: "item_update", itemId: number, changes: {...} }
 *   { type: "item_add", item: {...} }
 *   { type: "item_delete", itemId: number }
 *   { type: "presence" }
 *
 * Protocol (server -> client):
 *   { type: "cursor", userId, userName, x, y }
 *   { type: "item_update", itemId, changes, userId, userName }
 *   { type: "item_add", item, userId, userName }
 *   { type: "item_delete", itemId, userId, userName }
 *   { type: "presence", users: [...] }
 *   { type: "error", message }
 */

import type { Env } from "./trpc";

export class WorkspaceRoom implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const userId = parseInt(url.searchParams.get("userId") || "0");
    const workspaceId = parseInt(url.searchParams.get("workspaceId") || "0");
    const userName = url.searchParams.get("userName") || "User";

    if (!userId || !workspaceId) {
      return new Response("Missing userId or workspaceId", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, workspaceId, userName });

    // Broadcast updated presence
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let data: any;
    try {
      data = JSON.parse(message);
    } catch {
      this.sendJson(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    const meta = ws.deserializeAttachment() as { userId: number; workspaceId: number; userName: string } | null;
    if (!meta) {
      this.sendJson(ws, { type: "error", message: "No session metadata" });
      return;
    }

    if (data.type === "ping") {
      this.sendJson(ws, { type: "pong" });
      return;
    }

    switch (data.type) {
      case "cursor":
        this.broadcastExcept(ws, {
          type: "cursor",
          userId: meta.userId,
          userName: meta.userName,
          x: data.x,
          y: data.y,
        });
        break;

      case "item_update":
        // Broadcast to all others
        this.broadcastExcept(ws, {
          type: "item_update",
          itemId: data.itemId,
          changes: data.changes,
          userId: meta.userId,
          userName: meta.userName,
        });
        break;

      case "item_add":
        this.broadcastExcept(ws, {
          type: "item_add",
          item: data.item,
          userId: meta.userId,
          userName: meta.userName,
        });
        break;

      case "item_delete":
        this.broadcastExcept(ws, {
          type: "item_delete",
          itemId: data.itemId,
          userId: meta.userId,
          userName: meta.userName,
        });
        break;

      case "presence":
        this.broadcastPresence();
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastPresence();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence();
  }

  private broadcastPresence(): void {
    const sockets = this.ctx.getWebSockets();
    const users: { userId: number; userName: string }[] = [];
    const seen = new Set<number>();
    for (const s of sockets) {
      try {
        const meta = s.deserializeAttachment() as { userId: number; userName: string } | null;
        if (meta && !seen.has(meta.userId)) {
          seen.add(meta.userId);
          users.push({ userId: meta.userId, userName: meta.userName });
        }
      } catch {}
    }
    this.broadcast({ type: "presence", users, count: users.length });
  }

  private broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }

  private broadcastExcept(exclude: WebSocket, data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  private sendJson(ws: WebSocket, data: unknown): void {
    try { ws.send(JSON.stringify(data)); } catch {}
  }
}
