import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  ensureSchema,
  toJson,
  getMyTwin,
  normalizeTwin,
  getCumulativeWaveform,
  getOtherPerspectiveWaveform,
  recordFriendActivity,
} from "../db-helpers";

export const twinsCoreRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return null;
    // Attach cumulative waveform and scenario progress
    const cw = await getCumulativeWaveform(ctx.env.DB, ctx.userId, twin.id);
    const opw = await getOtherPerspectiveWaveform(ctx.env.DB, ctx.userId);
    const progress = await ctx.env.DB
      .prepare(`SELECT COUNT(*) as completed FROM value_scenario_responses WHERE userId = ? AND twinId = ?`)
      .bind(ctx.userId, twin.id)
      .first<any>();
    return {
      ...twin,
      cumulativeWaveform: cw,
      otherPerspectiveWaveform: opw,
      scenarioProgress: { completed: progress?.completed ?? 0, total: 18 },
    };
  }),

  upsert: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      rawInput: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!existing) {
        const res = await ctx.env.DB
          .prepare(`INSERT INTO digital_twins (userId, name, rawInput, status, updatedAt) VALUES (?, ?, ?, 'active', datetime('now'))`)
          .bind(ctx.userId, input.name, input.rawInput ?? null)
          .run();
        return { id: Number(res.meta.last_row_id) };
      }
      await ctx.env.DB
        .prepare(`UPDATE digital_twins SET name=?, rawInput=?, updatedAt=datetime('now') WHERE id=?`)
        .bind(input.name, input.rawInput ?? null, existing.id)
        .run();
      return { id: existing.id };
    }),

  update: protectedProcedure
    .input(z.object({
      name: z.string().optional(),
      rawInput: z.string().optional().nullable(),
      status: z.enum(["active", "inactive", "training"]).optional(),
      visibility: z.enum(["public", "friends", "private", "custom"]).optional(),
      allowedViewerIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
      const sets: string[] = [];
      const binds: any[] = [];
      if (input.name !== undefined) { sets.push("name=?"); binds.push(input.name); }
      if (input.rawInput !== undefined) { sets.push("rawInput=?"); binds.push(input.rawInput); }
      if (input.status !== undefined) { sets.push("status=?"); binds.push(input.status); }
      if (input.visibility !== undefined) { sets.push("visibility=?"); binds.push(input.visibility); }
      if (input.allowedViewerIds !== undefined) { sets.push("allowedViewerIds=?"); binds.push(JSON.stringify(input.allowedViewerIds)); }
      if (sets.length > 0) {
        sets.push("updatedAt=datetime('now')");
        binds.push(twin.id);
        await ctx.env.DB.prepare(`UPDATE digital_twins SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
      }
      // Sync twin_visibility_rules when visibility is 'custom'
      if (input.visibility === "custom" && input.allowedViewerIds) {
        await ctx.env.DB.prepare(`DELETE FROM twin_visibility_rules WHERE twinId=?`).bind(twin.id).run();
        for (const viewerId of input.allowedViewerIds) {
          await ctx.env.DB.prepare(`INSERT OR IGNORE INTO twin_visibility_rules (twinId, viewerUserId) VALUES (?,?)`).bind(twin.id, viewerId).run();
        }
      }

      // Record friend activity for twin update
      if (sets.length > 0) {
        const twinName = input.name || twin.name || "分身AI";
        await recordFriendActivity(ctx.env.DB, ctx.userId, "twin_update", `${twinName}を更新しました`);
      }

      return { success: true };
    }),

  updatePublicSettings: protectedProcedure
    .input(z.object({
      isPublic: z.boolean(),
      publicBio: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return null;
      await ctx.env.DB
        .prepare(`UPDATE digital_twins SET isPublic=?, publicBio=?, tags=?, updatedAt=datetime('now') WHERE id=?`)
        .bind(input.isPublic ? 1 : 0, input.publicBio ?? null, toJson(input.tags ?? twin.tags) ?? null, twin.id)
        .run();
      return getMyTwin(ctx.env.DB, ctx.userId);
    }),

  getVisibilitySettings: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return { visibility: "public" as const, allowedViewers: [] };
    const rules = await ctx.env.DB.prepare(
      `SELECT tvr.viewerUserId, u.name FROM twin_visibility_rules tvr JOIN users u ON u.id = tvr.viewerUserId WHERE tvr.twinId=?`
    ).bind(twin.id).all<any>();
    return {
      visibility: ((twin as any).visibility as string) || "public",
      allowedViewers: (rules.results ?? []).map((r: any) => ({ id: r.viewerUserId as number, name: (r.name as string) || "" })),
    };
  }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`DELETE FROM digital_twins WHERE userId = ?`).bind(ctx.userId).run();
    return { ok: true };
  }),

  searchPublic: protectedProcedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
    .query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB
        .prepare(`SELECT id, userId, name, description, personality, isPublic, tags, bigFiveTraits, mbtiType, avatarUrl, publicBio, createdAt, updatedAt FROM digital_twins WHERE isPublic=1 AND userId != ? LIMIT 20`)
        .bind(ctx.userId)
        .all<any>();
      const results = [];
      for (const row of rows.results ?? []) {
        const user = await ctx.env.DB.prepare(`SELECT id, name, friendCode FROM users WHERE id=?`).bind(row.userId).first<any>();
        results.push({ twin: normalizeTwin(row), user });
      }
      return results;
    }),
  getPublicTwin: protectedProcedure
    .input(z.object({ twinId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB
        .prepare(`SELECT id, userId, name, description, personality, isPublic, tags, bigFiveTraits, mbtiType, avatarUrl, publicBio, createdAt, updatedAt FROM digital_twins WHERE id=? AND isPublic=1 LIMIT 1`)
        .bind(input.twinId)
        .first<any>();
      if (!row) return null;
      const user = await ctx.env.DB.prepare(`SELECT id, name, friendCode FROM users WHERE id=?`).bind(row.userId).first<any>();
      return { twin: normalizeTwin(row), user };
    }),
});
