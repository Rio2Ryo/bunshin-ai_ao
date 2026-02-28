import { z } from "zod";
import { router, protectedProcedure, generateCode } from "../trpc";
import { ensureSchema, normalizeTwin } from "../db-helpers";
import { cachedQuery } from "../cache";

export const discoverRouter = router({
  search: protectedProcedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
    .query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      return cachedQuery(`discover:search:${ctx.userId}`, 60, async () => {
        const rows = await ctx.env.DB.prepare(
          `SELECT dt.*, u.id as ownerId, u.name as ownerName FROM digital_twins dt
           JOIN users u ON u.id = dt.userId
           WHERE dt.userId != ? AND (
             dt.visibility = 'public'
             OR (dt.visibility = 'friends' AND EXISTS (
               SELECT 1 FROM friendships f WHERE f.status='accepted'
               AND ((f.userId=? AND f.friendId=dt.userId) OR (f.friendId=? AND f.userId=dt.userId))
             ))
             OR (dt.visibility = 'custom' AND EXISTS (
               SELECT 1 FROM twin_visibility_rules tvr WHERE tvr.twinId=dt.id AND tvr.viewerUserId=?
             ))
             OR (dt.isPublic=1 AND (dt.visibility IS NULL OR dt.visibility = ''))
           )
           AND dt.userId NOT IN (SELECT blockedUserId FROM user_blocks WHERE userId=?)
           AND dt.userId NOT IN (SELECT userId FROM user_blocks WHERE blockedUserId=?)
           LIMIT 20`
        ).bind(ctx.userId, ctx.userId, ctx.userId, ctx.userId, ctx.userId, ctx.userId).all<any>();
        return (rows.results ?? []).map((r: any) => ({
          ...normalizeTwin(r),
          ownerId: r.ownerId,
          ownerName: r.ownerName,
        }));
      });
    }),
});

export const userRouter = router({
  getFriendCode: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    let user = await ctx.env.DB.prepare(`SELECT friendCode FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.friendCode) {
      const code = generateCode(8);
      await ctx.env.DB.prepare(`UPDATE users SET friendCode=? WHERE id=?`).bind(code, ctx.userId).run();
      user = { friendCode: code };
    }
    return { friendCode: user.friendCode };
  }),
  getStats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const friends = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`).bind(ctx.userId, ctx.userId).first<any>();
    const matchings = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId=?`).bind(ctx.userId).first<any>();
    const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    return {
      friendCount: friends?.c ?? 0,
      matchingCount: matchings?.c ?? 0,
      plan: user?.plan ?? "free",
      canAddFriend: true,
      canCreateMatching: true,
      limits: { maxFriends: 5, maxMatchingsPerMonth: 3 },
    };
  }),
});
