import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson } from "../db-helpers";
import { getMyTwin } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const clawdbotRouter = router({
  getConnection: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    return ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
  }),
  saveConnection: protectedProcedure
    .input(z.object({ gatewayUrl: z.string(), authToken: z.string().optional(), agentId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const existing = await ctx.env.DB.prepare(`SELECT id FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (existing) {
        await ctx.env.DB.prepare(`UPDATE clawdbot_connections SET gatewayUrl=?, authToken=?, agentId=?, updatedAt=datetime('now') WHERE id=?`).bind(input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main", existing.id).run();
      } else {
        await ctx.env.DB.prepare(`INSERT INTO clawdbot_connections (userId, twinId, gatewayUrl, authToken, agentId) VALUES (?,?,?,?,?)`).bind(ctx.userId, twin.id, input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main").run();
      }
      return { success: true };
    }),
  testConnection: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const conn = await ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!conn) return { success: false, message: "接続が設定されていません" };
    try {
      const res = await fetch(`${conn.gatewayUrl}/api/health`, {
        headers: conn.authToken ? { Authorization: `Bearer ${conn.authToken}` } : {},
      });
      if (res.ok) return { success: true, message: `接続成功 (${res.status})` };
      return { success: false, message: `接続エラー: HTTP ${res.status}` };
    } catch (e: any) {
      return { success: false, message: `接続失敗: ${e.message}` };
    }
  }),
  sendMessage: protectedProcedure
    .input(z.object({ content: z.string().optional(), message: z.string().optional(), sessionKey: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!conn) return { response: "Clawdbotゲートウェイが未設定です", success: false, sessionKey: undefined as string | undefined, error: "no connection" as string | undefined };

      const messageText = input.content || input.message || "";
      try {
        const res = await fetch(`${conn.gatewayUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(conn.authToken ? { Authorization: `Bearer ${conn.authToken}` } : {}),
          },
          body: JSON.stringify({
            message: messageText,
            agentId: conn.agentId || "main",
            sessionKey: input.sessionKey,
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          return { response: data.response || data.message || "応答なし", success: true, sessionKey: data.sessionKey, error: undefined as string | undefined };
        }
        return { response: `Clawdbot APIエラー: ${res.status}`, success: false, sessionKey: undefined as string | undefined, error: `HTTP ${res.status}` as string | undefined };
      } catch (e: any) {
        return { response: `接続エラー: ${e.message}`, success: false, sessionKey: undefined as string | undefined, error: e.message as string | undefined };
      }
    }),
  getLearningStatus: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(`SELECT * FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!row) return null;
    return { ...row, learnedTraits: parseJson<any>(row.learnedTraits) };
  }),
  getMessageHistory: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async () => {
      return [] as any[];
    }),
  getModels: protectedProcedure.query(async () => {
    return { success: true, models: [] as string[] };
  }),
  getLearnedTraits: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(`SELECT * FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!row) return null;
    return { ...row, learnedTraits: parseJson<any>(row.learnedTraits) };
  }),
  syncConversations: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const conn = await ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!conn) return { success: false, synced: 0, message: "Clawdbot接続が設定されていません" };
    try {
      const res = await fetch(`${conn.gatewayUrl}/api/conversations`, {
        headers: conn.authToken ? { Authorization: `Bearer ${conn.authToken}` } : {},
      });
      if (!res.ok) return { success: false, synced: 0, message: `API error: ${res.status}` };
      const data = await res.json() as any;
      const conversations = data.conversations || data.messages || [];
      // Store conversations as knowledge base entries
      let synced = 0;
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      for (const conv of conversations.slice(0, 50)) {
        const content = conv.content || conv.message || JSON.stringify(conv);
        await ctx.env.DB.prepare(
          `INSERT INTO knowledge_base (twinId, sourceType, sourceId, title, content, summary) VALUES (?,?,?,?,?,?)`
        ).bind(twin?.id ?? 0, "api", `clawdbot_${conv.id || Date.now()}`, "Clawdbot会話", content, content.substring(0, 200)).run();
        synced++;
      }
      return { success: true, synced, message: `${synced}件の会話を同期しました` };
    } catch (e: any) {
      return { success: false, synced: 0, message: `接続エラー: ${e.message}` };
    }
  }),
  analyzePersonality: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return { success: false, analyzed: false, message: "分身AIを作成してください" };
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
    if (!llmConfig) return { success: false, analyzed: false, message: "AI APIキーが未設定です" };

    // Get clawdbot conversations from knowledge base
    const entries = await ctx.env.DB.prepare(
      `SELECT content FROM knowledge_base WHERE twinId=? AND sourceType='api' ORDER BY createdAt DESC LIMIT 20`
    ).bind(twin.id).all<any>();
    if ((entries.results?.length ?? 0) === 0) return { success: true, analyzed: false, message: "分析する会話データがありません。先に会話を同期してください。" };

    const conversationText = (entries.results ?? []).map(e => e.content).join("\n---\n");
    try {
      const result = await invokeLLM(llmConfig, [{
        role: "system",
        content: "あなたは心理学の専門家です。会話データからユーザーの性格特性を分析してください。",
      }, {
        role: "user",
        content: `以下の会話データからユーザーの性格特性を分析してください。

${conversationText.substring(0, 3000)}

JSON形式で出力:
{"communicationStyle": "コミュニケーションスタイル", "decisionMaking": "意思決定パターン", "emotionalTendency": "感情的傾向", "interests": ["関心事1", "関心事2"], "summary": "総合分析"}`,
      }], { maxTokens: 1024 });
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const traits = JSON.parse(jsonMatch[0]);
        // Save learned traits
        const existing = await ctx.env.DB.prepare(`SELECT id FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE conversation_learning SET learnedTraits=?, conversationCount=?, updatedAt=datetime('now') WHERE id=?`)
            .bind(toJson(traits), entries.results?.length ?? 0, existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO conversation_learning (userId, twinId, learnedTraits, conversationCount) VALUES (?,?,?,?)`)
            .bind(ctx.userId, twin.id, toJson(traits), entries.results?.length ?? 0).run();
        }
        return { success: true, analyzed: true, message: "性格分析が完了しました" };
      }
    } catch (e: any) {
      return { success: false, analyzed: false, message: `分析エラー: ${e.message}` };
    }
    return { success: true, analyzed: false, message: "分析結果を取得できませんでした" };
  }),
  updateLearningSettings: protectedProcedure
    .input(z.object({ autoLearnEnabled: z.boolean().optional(), learningThreshold: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await ctx.env.DB.prepare(`SELECT id FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
      if (existing) {
        // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
        const sets: string[] = [];
        const binds: any[] = [];
        if (input.autoLearnEnabled !== undefined) { sets.push("autoLearnEnabled=?"); binds.push(input.autoLearnEnabled ? 1 : 0); }
        if (input.learningThreshold !== undefined) { sets.push("learningThreshold=?"); binds.push(input.learningThreshold); }
        if (sets.length > 0) {
          sets.push("updatedAt=datetime('now')");
          binds.push(existing.id);
          await ctx.env.DB.prepare(`UPDATE conversation_learning SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
        }
      }
      return { success: true };
    }),
  updateLearnedTraits: protectedProcedure
    .input(z.object({ learnedTraits: z.any() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const existing = await ctx.env.DB.prepare(`SELECT id FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
      if (existing) {
        await ctx.env.DB.prepare(`UPDATE conversation_learning SET learnedTraits=?, updatedAt=datetime('now') WHERE id=?`).bind(toJson(input.learnedTraits), existing.id).run();
      } else {
        await ctx.env.DB.prepare(`INSERT INTO conversation_learning (userId, twinId, learnedTraits) VALUES (?,?,?)`).bind(ctx.userId, twin.id, toJson(input.learnedTraits)).run();
      }
      return { success: true };
    }),
  createConnection: protectedProcedure
    .input(z.object({ gatewayUrl: z.string(), authToken: z.string().optional(), agentId: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      await ctx.env.DB.prepare(`INSERT INTO clawdbot_connections (userId, twinId, gatewayUrl, authToken, agentId) VALUES (?,?,?,?,?)`).bind(ctx.userId, twin.id, input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main").run();
      return { success: true };
    }),
  updateConnection: protectedProcedure
    .input(z.object({ gatewayUrl: z.string().optional(), authToken: z.string().optional(), agentId: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
      const sets: string[] = [];
      const binds: any[] = [];
      if (input.gatewayUrl !== undefined) { sets.push("gatewayUrl=?"); binds.push(input.gatewayUrl); }
      if (input.authToken !== undefined) { sets.push("authToken=?"); binds.push(input.authToken); }
      if (input.agentId !== undefined) { sets.push("agentId=?"); binds.push(input.agentId); }
      if (sets.length > 0) {
        sets.push("updatedAt=datetime('now')");
        binds.push(ctx.userId);
        await ctx.env.DB.prepare(`UPDATE clawdbot_connections SET ${sets.join(",")} WHERE userId=?`).bind(...binds).run();
      }
      return { success: true };
    }),
  deleteConnection: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`DELETE FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).run();
    return { success: true };
  }),
});

export const lineRouter = router({
  getConnection: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(`SELECT * FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!row) return null;
    return { ...row, settings: parseJson<any>(row.settings) };
  }),
  linkByCode: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Find connection with matching link code
      const conn = await ctx.env.DB
        .prepare(`SELECT * FROM line_connections WHERE json_extract(settings, '$.linkCode')=?`)
        .bind(input.code.toUpperCase())
        .first<any>();
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "コードが見つかりません" });
      // Link to current user
      await ctx.env.DB
        .prepare(`UPDATE line_connections SET userId=?, status='active', connectedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?`)
        .bind(ctx.userId, conn.id)
        .run();
      return { success: true };
    }),
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`UPDATE line_connections SET status='disconnected', disconnectedAt=datetime('now'), updatedAt=datetime('now') WHERE userId=?`).bind(ctx.userId).run();
    return { success: true };
  }),
  updateSettings: protectedProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Merge with existing settings
      const conn = await ctx.env.DB.prepare(`SELECT settings FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      const existing = conn ? (parseJson<any>(conn.settings) ?? {}) : {};
      const merged = { ...existing, ...input };
      await ctx.env.DB.prepare(`UPDATE line_connections SET settings=?, updatedAt=datetime('now') WHERE userId=?`).bind(toJson(merged), ctx.userId).run();
      return { success: true };
    }),
  toggleStatus: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB.prepare(`SELECT status FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
      const newStatus = conn.status === "active" ? "paused" : "active";
      await ctx.env.DB.prepare(`UPDATE line_connections SET status=?, updatedAt=datetime('now') WHERE userId=?`).bind(newStatus, ctx.userId).run();
      return { success: true, status: newStatus };
    }),
  getMessageHistory: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async () => {
      return [] as any[];
    }),
});
