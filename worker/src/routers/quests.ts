import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, now, getMyTwin } from "../db-helpers";

export const questsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const transactions = await ctx.env.DB.prepare(
      `SELECT * FROM point_transactions WHERE userId=? ORDER BY createdAt DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();
    return transactions.results ?? [];
  }),
  checkDailyLogin: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const today = now().slice(0, 10);
    const existing = await ctx.env.DB.prepare(
      `SELECT id FROM point_transactions WHERE userId=? AND actionType='daily_login' AND createdAt LIKE ?`
    ).bind(ctx.userId, `${today}%`).first<any>();
    return { points: existing ? 0 : 10, isFirstLogin: !existing };
  }),
});

export const growthRouter = router({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return null;
    let status = await ctx.env.DB.prepare(`SELECT * FROM twin_growth_status WHERE twinId=?`).bind(twin.id).first<any>();
    if (!status) {
      await ctx.env.DB.prepare(`INSERT INTO twin_growth_status (twinId, userId) VALUES (?,?)`).bind(twin.id, ctx.userId).run();
      status = await ctx.env.DB.prepare(`SELECT * FROM twin_growth_status WHERE twinId=?`).bind(twin.id).first<any>();
    }
    return status;
  }),
  getSkillLevels: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];
    const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).all<any>();
    return rows.results ?? [];
  }),
  setSkillLevel: protectedProcedure
    .input(z.object({ skillType: z.string(), level: z.number().min(1).max(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      const existing = await ctx.env.DB.prepare(`SELECT id FROM twin_skill_levels WHERE twinId=? AND skillType=?`).bind(twin.id, input.skillType).first<any>();
      if (existing) {
        await ctx.env.DB.prepare(`UPDATE twin_skill_levels SET level=?, updatedAt=datetime('now') WHERE id=?`).bind(input.level, existing.id).run();
      } else {
        await ctx.env.DB.prepare(`INSERT INTO twin_skill_levels (twinId, userId, skillType, level) VALUES (?,?,?,?)`).bind(twin.id, ctx.userId, input.skillType, input.level).run();
      }
      return { success: true };
    }),
  setSkillLevels: protectedProcedure
    .input(z.object({ skills: z.record(z.string(), z.number()).optional(), skillLevels: z.record(z.string(), z.number()).optional(), isCampaign: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      const skillMap = input.skillLevels ?? input.skills ?? {};
      for (const [skillType, level] of Object.entries(skillMap)) {
        const existing = await ctx.env.DB.prepare(`SELECT id FROM twin_skill_levels WHERE twinId=? AND skillType=?`).bind(twin.id, skillType).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE twin_skill_levels SET level=?, updatedAt=datetime('now') WHERE id=?`).bind(level, existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO twin_skill_levels (twinId, userId, skillType, level) VALUES (?,?,?,?)`).bind(twin.id, ctx.userId, skillType, level).run();
        }
      }
      return { success: true };
    }),
  getSkills: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];
    const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).all<any>();
    return rows.results ?? [];
  }),
  areSkillsConfigured: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return false;
    const row = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).first<any>();
    return (row?.c ?? 0) > 0;
  }),
  getAvailableSkillPoints: protectedProcedure
    .input(z.object({ isCampaign: z.boolean().optional() }).optional())
    .query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return 0;
    const status = await ctx.env.DB.prepare(`SELECT level FROM twin_growth_status WHERE twinId=?`).bind(twin.id).first<any>();
    return (status?.level ?? 1) * 3;
  }),
  getMilestones: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];
    const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_milestones WHERE twinId=?`).bind(twin.id).all<any>();
    return rows.results ?? [];
  }),
});
