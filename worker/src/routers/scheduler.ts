import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema } from "../db-helpers";

export const schedulerRouter = router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT s.*, u.name as friendName FROM auto_matching_schedules s LEFT JOIN users u ON u.id=s.friendId WHERE s.userId=? ORDER BY s.createdAt DESC`
      ).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    create: protectedProcedure
      .input(z.object({
        friendId: z.number(),
        frequency: z.enum(["daily", "weekly", "biweekly"]).default("weekly"),
        theme: z.string().min(1).default("協業の可能性"),
        turns: z.number().min(1).max(10).default(5),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Check if schedule already exists for this pair
        const existing = await ctx.env.DB.prepare(
          `SELECT id FROM auto_matching_schedules WHERE userId=? AND friendId=? AND isActive=1`
        ).bind(ctx.userId, input.friendId).first<any>();
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "この友達とのスケジュールは既に存在します" });

        const nextRun = input.frequency === "daily"
          ? "datetime('now', '+1 day')"
          : input.frequency === "biweekly"
            ? "datetime('now', '+14 days')"
            : "datetime('now', '+7 days')";

        await ctx.env.DB.prepare(
          `INSERT INTO auto_matching_schedules (userId, friendId, frequency, theme, turns, nextRunAt) VALUES (?,?,?,?,?,${nextRun})`
        ).bind(ctx.userId, input.friendId, input.frequency, input.theme, input.turns).run();
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        frequency: z.enum(["daily", "weekly", "biweekly"]).optional(),
        theme: z.string().min(1).optional(),
        turns: z.number().min(1).max(10).optional(),
        isActive: z.number().min(0).max(1).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const schedule = await ctx.env.DB.prepare(
          `SELECT * FROM auto_matching_schedules WHERE id=? AND userId=?`
        ).bind(input.id, ctx.userId).first<any>();
        if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
        const sets: string[] = ["updatedAt=datetime('now')"];
        const vals: any[] = [];
        if (input.frequency !== undefined) { sets.push("frequency=?"); vals.push(input.frequency); }
        if (input.theme !== undefined) { sets.push("theme=?"); vals.push(input.theme); }
        if (input.turns !== undefined) { sets.push("turns=?"); vals.push(input.turns); }
        if (input.isActive !== undefined) { sets.push("isActive=?"); vals.push(input.isActive); }
        vals.push(input.id);
        await ctx.env.DB.prepare(`UPDATE auto_matching_schedules SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`DELETE FROM auto_matching_schedules WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
        return { success: true };
      }),
});

export const notificationsRouter = router({
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM notification_settings WHERE userId=?`).bind(ctx.userId).first<any>();
      return row || { slackWebhookUrl: null, lineNotify: 1, emailNotify: 0, matchingComplete: 1, scheduledMatching: 1 };
    }),
    updateSettings: protectedProcedure
      .input(z.object({
        slackWebhookUrl: z.string().nullable().optional(),
        lineNotify: z.number().min(0).max(1).optional(),
        emailNotify: z.number().min(0).max(1).optional(),
        matchingComplete: z.number().min(0).max(1).optional(),
        scheduledMatching: z.number().min(0).max(1).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB.prepare(`SELECT id FROM notification_settings WHERE userId=?`).bind(ctx.userId).first<any>();
        if (existing) {
          const sets: string[] = ["updatedAt=datetime('now')"];
          const vals: any[] = [];
          if (input.slackWebhookUrl !== undefined) { sets.push("slackWebhookUrl=?"); vals.push(input.slackWebhookUrl); }
          if (input.lineNotify !== undefined) { sets.push("lineNotify=?"); vals.push(input.lineNotify); }
          if (input.emailNotify !== undefined) { sets.push("emailNotify=?"); vals.push(input.emailNotify); }
          if (input.matchingComplete !== undefined) { sets.push("matchingComplete=?"); vals.push(input.matchingComplete); }
          if (input.scheduledMatching !== undefined) { sets.push("scheduledMatching=?"); vals.push(input.scheduledMatching); }
          vals.push(existing.id);
          await ctx.env.DB.prepare(`UPDATE notification_settings SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO notification_settings (userId, slackWebhookUrl, lineNotify, emailNotify, matchingComplete, scheduledMatching) VALUES (?,?,?,?,?,?)`
          ).bind(ctx.userId, input.slackWebhookUrl ?? null, input.lineNotify ?? 1, input.emailNotify ?? 0, input.matchingComplete ?? 1, input.scheduledMatching ?? 1).run();
        }
        return { success: true };
      }),
});
