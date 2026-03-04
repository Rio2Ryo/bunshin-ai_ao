import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema } from "../db-helpers";

export const blocksRouter = router({
  // ブロックする
  block: protectedProcedure
    .input(z.object({ userId: z.number(), reason: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (input.userId === ctx.userId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "自分自身をブロックできません" });
      // ブロック追加 (IGNORE で重複防止)
      await ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO user_blocks (userId, blockedUserId, reason) VALUES (?,?,?)`
      ).bind(ctx.userId, input.userId, input.reason || null).run();
      // 友達関係も自動削除
      await ctx.env.DB.prepare(
        `DELETE FROM friendships WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)`
      ).bind(ctx.userId, input.userId, input.userId, ctx.userId).run();
      return { success: true };
    }),

  // ブロック解除
  unblock: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM user_blocks WHERE userId=? AND blockedUserId=?`
      ).bind(ctx.userId, input.userId).run();
      return { success: true };
    }),

  // ブロック中か確認
  isBlocked: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT id FROM user_blocks WHERE userId=? AND blockedUserId=?`
      ).bind(ctx.userId, input.userId).first<any>();
      return { blocked: !!row };
    }),

  // ブロックリスト
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ub.blockedUserId, ub.reason, ub.createdAt, u.name
       FROM user_blocks ub JOIN users u ON u.id = ub.blockedUserId
       WHERE ub.userId=? ORDER BY ub.createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
});
