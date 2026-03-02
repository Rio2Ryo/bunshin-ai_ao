import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { ensureSchema, parseJson, toJson } from "../db-helpers";

export const scenarioRouter = router({
  list: protectedProcedure.input(z.object({
    category: z.string().optional(),
    onlyMine: z.boolean().optional(),
  })).query(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    let sql: string;
    const params: any[] = [];
    if (input.onlyMine) {
      sql = `SELECT ms.*, u.name as creatorName FROM matching_scenarios ms LEFT JOIN users u ON u.id=ms.creatorUserId WHERE ms.creatorUserId=? ORDER BY ms.updatedAt DESC`;
      params.push(ctx.userId);
    } else {
      sql = `SELECT ms.*, u.name as creatorName FROM matching_scenarios ms LEFT JOIN users u ON u.id=ms.creatorUserId WHERE ms.isPublished=1 AND ms.isApproved=1`;
      if (input.category) { sql += ` AND ms.category=?`; params.push(input.category); }
      sql += ` ORDER BY ms.usageCount DESC, ms.rating DESC`;
    }
    const rows = await ctx.env.DB.prepare(sql).bind(...params).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, tags: parseJson<string[]>(r.tags) ?? [] }));
  }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const s = await ctx.env.DB.prepare(`SELECT ms.*, u.name as creatorName FROM matching_scenarios ms LEFT JOIN users u ON u.id=ms.creatorUserId WHERE ms.id=?`).bind(input.id).first<any>();
    if (!s) throw new TRPCError({ code: "NOT_FOUND" });
    if (!s.isPublished && s.creatorUserId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN" });
    const purchased = await ctx.env.DB.prepare(`SELECT id FROM scenario_purchases WHERE userId=? AND scenarioId=?`).bind(ctx.userId, input.id).first<any>();
    const reviews = await ctx.env.DB.prepare(`SELECT sr.*, u.name FROM scenario_reviews sr LEFT JOIN users u ON u.id=sr.userId WHERE sr.scenarioId=? ORDER BY sr.createdAt DESC LIMIT 10`).bind(input.id).all<any>();
    return { ...s, tags: parseJson<string[]>(s.tags) ?? [], purchased: !!purchased || s.creatorUserId === ctx.userId || s.price === 0, reviews: reviews.results ?? [] };
  }),

  create: protectedProcedure.input(z.object({
    title: z.string().min(1).max(100),
    description: z.string().optional(),
    category: z.string(),
    systemPromptTemplate: z.string().min(10),
    analysisPromptTemplate: z.string().optional(),
    turnCount: z.number().min(1).max(20).optional(),
    tags: z.array(z.string()).optional(),
    price: z.number().min(0).optional(),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const res = await ctx.env.DB.prepare(
      `INSERT INTO matching_scenarios (creatorUserId, title, description, category, systemPromptTemplate, analysisPromptTemplate, turnCount, tags, price) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(ctx.userId, input.title, input.description || null, input.category, input.systemPromptTemplate, input.analysisPromptTemplate || null, input.turnCount ?? 5, toJson(input.tags ?? []), input.price ?? 0).run();
    return { id: Number(res.meta.last_row_id) };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    title: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    systemPromptTemplate: z.string().optional(),
    analysisPromptTemplate: z.string().optional(),
    turnCount: z.number().optional(),
    tags: z.array(z.string()).optional(),
    price: z.number().optional(),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const s = await ctx.env.DB.prepare(`SELECT * FROM matching_scenarios WHERE id=? AND creatorUserId=?`).bind(input.id, ctx.userId).first<any>();
    if (!s) throw new TRPCError({ code: "NOT_FOUND" });
    const sets: string[] = []; const vals: any[] = [];
    if (input.title) { sets.push("title=?"); vals.push(input.title); }
    if (input.description !== undefined) { sets.push("description=?"); vals.push(input.description); }
    if (input.category) { sets.push("category=?"); vals.push(input.category); }
    if (input.systemPromptTemplate) { sets.push("systemPromptTemplate=?"); vals.push(input.systemPromptTemplate); }
    if (input.analysisPromptTemplate !== undefined) { sets.push("analysisPromptTemplate=?"); vals.push(input.analysisPromptTemplate); }
    if (input.turnCount) { sets.push("turnCount=?"); vals.push(input.turnCount); }
    if (input.tags) { sets.push("tags=?"); vals.push(toJson(input.tags)); }
    if (input.price !== undefined) { sets.push("price=?"); vals.push(input.price); }
    if (sets.length === 0) return { success: true };
    sets.push("updatedAt=datetime('now')"); vals.push(input.id);
    await ctx.env.DB.prepare(`UPDATE matching_scenarios SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
    return { success: true };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`DELETE FROM matching_scenarios WHERE id=? AND creatorUserId=?`).bind(input.id, ctx.userId).run();
    return { success: true };
  }),

  publish: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const s = await ctx.env.DB.prepare(`SELECT * FROM matching_scenarios WHERE id=? AND creatorUserId=?`).bind(input.id, ctx.userId).first<any>();
    if (!s) throw new TRPCError({ code: "NOT_FOUND" });
    await ctx.env.DB.prepare(`UPDATE matching_scenarios SET isPublished=1, isApproved=1, updatedAt=datetime('now') WHERE id=?`).bind(input.id).run();
    return { success: true };
  }),

  purchase: protectedProcedure.input(z.object({ scenarioId: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const s = await ctx.env.DB.prepare(`SELECT * FROM matching_scenarios WHERE id=?`).bind(input.scenarioId).first<any>();
    if (!s) throw new TRPCError({ code: "NOT_FOUND" });
    if (s.price === 0 || s.creatorUserId === ctx.userId) {
      await ctx.env.DB.prepare(`INSERT OR IGNORE INTO scenario_purchases (userId, scenarioId, pointsSpent) VALUES (?,?,0)`).bind(ctx.userId, input.scenarioId).run();
      return { success: true, pointsSpent: 0 };
    }
    const points = await ctx.env.DB.prepare(`SELECT balance FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!points || points.balance < s.price) throw new TRPCError({ code: "BAD_REQUEST", message: "ポイントが不足しています" });
    await ctx.env.DB.prepare(`UPDATE user_points SET balance=balance-?, totalSpent=totalSpent+? WHERE userId=?`).bind(s.price, s.price, ctx.userId).run();
    await ctx.env.DB.prepare(`INSERT OR IGNORE INTO scenario_purchases (userId, scenarioId, pointsSpent) VALUES (?,?,?)`).bind(ctx.userId, input.scenarioId, s.price).run();
    await ctx.env.DB.prepare(`UPDATE matching_scenarios SET usageCount=usageCount+1 WHERE id=?`).bind(input.scenarioId).run();
    // Credit creator
    await ctx.env.DB.prepare(`UPDATE user_points SET balance=balance+?, totalEarned=totalEarned+? WHERE userId=?`).bind(Math.floor(s.price * 0.7), Math.floor(s.price * 0.7), s.creatorUserId).run();
    return { success: true, pointsSpent: s.price };
  }),

  review: protectedProcedure.input(z.object({
    scenarioId: z.number(), rating: z.number().min(1).max(5), comment: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`INSERT OR REPLACE INTO scenario_reviews (scenarioId, userId, rating, comment) VALUES (?,?,?,?)`).bind(input.scenarioId, ctx.userId, input.rating, input.comment || null).run();
    // Update average rating
    const avg = await ctx.env.DB.prepare(`SELECT AVG(rating) as avg, COUNT(*) as cnt FROM scenario_reviews WHERE scenarioId=?`).bind(input.scenarioId).first<any>();
    await ctx.env.DB.prepare(`UPDATE matching_scenarios SET rating=?, ratingCount=? WHERE id=?`).bind(avg?.avg ?? 0, avg?.cnt ?? 0, input.scenarioId).run();
    return { success: true };
  }),

  categories: protectedProcedure.query(async () => {
    return [
      { id: "negotiation", name: "交渉シミュレーション", icon: "handshake" },
      { id: "interview", name: "採用面接練習", icon: "user-check" },
      { id: "sales", name: "営業ロールプレイ", icon: "trending-up" },
      { id: "brainstorm", name: "ブレインストーミング", icon: "lightbulb" },
      { id: "conflict", name: "コンフリクト解決", icon: "shield" },
      { id: "presentation", name: "プレゼン練習", icon: "presentation" },
      { id: "general", name: "汎用", icon: "zap" },
    ];
  }),
});
