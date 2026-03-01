/**
 * ChatRoom Durable Object — manages WebSocket connections for a chat session.
 * Uses the Hibernation API for efficient WebSocket handling.
 *
 * Protocol (client → server):
 *   { type: "send", content: "user message" }
 *
 * Protocol (server → client):
 *   { type: "user_saved", messageId: number }
 *   { type: "typing_start" }
 *   { type: "token", content: "..." }
 *   { type: "message_complete", messageId: number, fullContent: "..." }
 *   { type: "typing_end" }
 *   { type: "error", message: "..." }
 */

import type { Env } from "./trpc";
import { ensureSchema, getMyTwin, addTrustAction } from "./db-helpers";
import { invokeLLMStream, getUserLLMConfig } from "./llm";
import type { Message } from "./llm";

export class ChatRoom implements DurableObject {
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
    const sessionId = parseInt(url.searchParams.get("sessionId") || "0");

    if (!userId || !sessionId) {
      return new Response("Missing userId or sessionId", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, sessionId });

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

    if (data.type === "send" && typeof data.content === "string") {
      await this.handleSendMessage(ws, data.content);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    ws.close();
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close();
  }

  // ---- Internal Methods ----

  private sendJson(ws: WebSocket, obj: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // Client disconnected
    }
  }

  private broadcast(obj: Record<string, unknown>): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendJson(ws, obj);
    }
  }

  private async handleSendMessage(ws: WebSocket, content: string): Promise<void> {
    const meta = ws.deserializeAttachment() as { userId: number; sessionId: number } | null;
    if (!meta) {
      this.sendJson(ws, { type: "error", message: "No session metadata" });
      return;
    }

    const { userId, sessionId } = meta;
    const db = this.env.DB;

    try {
      await ensureSchema(db);

      // Plan limit check
      const userRow = await db.prepare(`SELECT plan FROM users WHERE id=?`).bind(userId).first<any>();
      const userPlan = userRow?.plan || "free";
      const chatLimitMap: Record<string, number> = { free: 50, premium: 500, enterprise: -1 };
      const maxMessages = chatLimitMap[userPlan] ?? 50;
      if (maxMessages !== -1) {
        const todayCount = (await db.prepare(
          `SELECT COUNT(*) as c FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId WHERE cs.userId=? AND cm.role='user' AND cm.createdAt >= date('now')`
        ).bind(userId).first<any>())?.c ?? 0;
        if (todayCount >= maxMessages) {
          this.sendJson(ws, { type: "error", message: `本日のチャット上限（${maxMessages}回）に達しました。` });
          return;
        }
      }

      // Verify session ownership
      const session = await db.prepare(`SELECT * FROM chat_sessions WHERE id=? AND userId=?`).bind(sessionId, userId).first<any>();
      if (!session) {
        this.sendJson(ws, { type: "error", message: "セッションが見つかりません" });
        return;
      }

      // Save user message
      const userMsgRes = await db.prepare(
        `INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`
      ).bind(sessionId, "user", content).run();
      const userMsgId = Number(userMsgRes.meta.last_row_id);

      this.broadcast({ type: "user_saved", messageId: userMsgId });

      // Build system prompt
      const twin = await getMyTwin(db, userId);
      const llmConfig = await getUserLLMConfig(db, userId, "chat", this.env);

      if (!llmConfig) {
        // No LLM — save fallback response
        const fallback = "AI APIキーが設定されていません。「AI API設定」ページでAPIキーを登録してください。";
        const aRes = await db.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(sessionId, "assistant", fallback).run();
        await db.prepare(`UPDATE chat_sessions SET updatedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
        this.broadcast({ type: "message_complete", messageId: Number(aRes.meta.last_row_id), fullContent: fallback });
        return;
      }

      const systemPrompt = await this.buildSystemPrompt(db, userId, twin, session);

      // Get conversation history
      const history = await db.prepare(
        `SELECT role, content FROM chat_messages WHERE sessionId=? ORDER BY createdAt DESC LIMIT 20`
      ).bind(sessionId).all<any>();

      const messages: Message[] = [
        { role: "system", content: systemPrompt },
        ...(history.results ?? []).reverse().map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        })),
      ];

      // Stream LLM response
      this.broadcast({ type: "typing_start" });

      let fullContent = "";
      try {
        const isOnboarding = session.mode === "onboarding";
        const llmMaxTokens = isOnboarding ? 512 : 2048;

        fullContent = await invokeLLMStream(llmConfig, messages, { maxTokens: llmMaxTokens }, (token) => {
          this.broadcast({ type: "token", content: token });
        });
      } catch {
        fullContent = "";
      }

      if (!fullContent || fullContent.trim().length === 0) {
        fullContent = "AIの応答生成中にエラーが発生しました。APIキーが正しいか確認してください。";
      }

      // Save assistant message
      const assistRes = await db.prepare(
        `INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`
      ).bind(sessionId, "assistant", fullContent).run();
      await db.prepare(`UPDATE chat_sessions SET updatedAt=datetime('now') WHERE id=?`).bind(sessionId).run();

      this.broadcast({
        type: "message_complete",
        messageId: Number(assistRes.meta.last_row_id),
        fullContent,
      });
      this.broadcast({ type: "typing_end" });

      // Auto-title
      if (session.title === "New Chat" || session.title?.endsWith("とのチャット")) {
        const autoTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
        await db.prepare(`UPDATE chat_sessions SET title=? WHERE id=?`).bind(autoTitle, sessionId).run();
      }

      // Trust score (every 5 messages)
      const totalUserMsgs = (await db.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=? AND role='user'`
      ).bind(sessionId).first<any>())?.c ?? 0;
      if (totalUserMsgs % 5 === 0) {
        await addTrustAction(db, userId, "chat_conversation", 2, "会話を継続しました");
      }
    } catch (err: any) {
      this.broadcast({ type: "typing_end" });
      this.sendJson(ws, { type: "error", message: err?.message || "内部エラー" });
    }
  }

  private async buildSystemPrompt(db: D1Database, userId: number, twin: any, session: any): Promise<string> {
    const twinName = twin?.name || "分身AI";

    if (session.mode === "onboarding" && twin?.systemPrompt) {
      return twin.systemPrompt;
    }

    const twinDesc = twin?.description || "";
    const twinPersonality = twin?.personality || "";
    const profile = await db.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(userId).first<any>();

    let systemPrompt = `あなたは「${twinName}」というデジタル分身AIです。ユーザーの代わりに会話します。`;
    if (twinDesc) systemPrompt += `\n\n分身AIの説明: ${twinDesc}`;
    if (twinPersonality) systemPrompt += `\n\n性格特性: ${twinPersonality}`;
    if (profile?.bio) systemPrompt += `\n\nユーザーの自己紹介: ${profile.bio}`;
    if (profile?.skills) {
      try {
        const skills = JSON.parse(profile.skills);
        if (Array.isArray(skills) && skills.length) systemPrompt += `\n\nスキル: ${skills.join(", ")}`;
      } catch {}
    }
    if (profile?.industry) systemPrompt += `\n\n業界: ${profile.industry}`;

    // Knowledge base
    if (twin) {
      const knowledgeRows = await db.prepare(
        `SELECT title, content, summary FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 8`
      ).bind(twin.id).all<any>();
      const kEntries = knowledgeRows.results ?? [];
      if (kEntries.length > 0) {
        systemPrompt += `\n\n## ユーザーの知識ベース（参考情報）:`;
        for (const k of kEntries) {
          const label = k.title || "エントリ";
          const body = k.summary || (k.content ? k.content.slice(0, 500) : "");
          if (body) systemPrompt += `\n- ${label}: ${body}`;
        }
      }
    }

    systemPrompt += `\n\n丁寧かつ親しみやすい日本語で回答してください。ユーザーの専門知識と知識ベースの情報を反映した回答を心がけてください。`;
    return systemPrompt;
  }
}
