import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson, now } from "../db-helpers";

export const feedRouter = router({
  // Get feed items for user (own + friends' public/friends-only)
  list: protectedProcedure
    .input(z.object({ cursor: z.number().optional(), limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;
      const offset = input.cursor ?? 0;

      // Get user's friend IDs
      const friendRows = await db.prepare(
        `SELECT CASE WHEN userId=? THEN friendId ELSE userId END as fid
         FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
      ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();
      const friendIds = (friendRows.results ?? []).map((r: any) => r.fid);

      // Get feed items: own items + friends' public/friends-only items
      let items: any[] = [];
      if (friendIds.length > 0) {
        const placeholders = friendIds.map(() => "?").join(",");
        const rows = await db.prepare(
          `SELECT fi.*, u.name as userName, up.avatarUrl
           FROM feed_items fi
           LEFT JOIN users u ON u.id = fi.userId
           LEFT JOIN user_profiles up ON up.userId = fi.userId
           WHERE (fi.userId = ? OR (fi.userId IN (${placeholders}) AND fi.visibility IN ('public','friends')))
           ORDER BY fi.createdAt DESC LIMIT ? OFFSET ?`
        ).bind(ctx.userId, ...friendIds, input.limit, offset).all<any>();
        items = rows.results ?? [];
      } else {
        const rows = await db.prepare(
          `SELECT fi.*, u.name as userName, up.avatarUrl
           FROM feed_items fi
           LEFT JOIN users u ON u.id = fi.userId
           LEFT JOIN user_profiles up ON up.userId = fi.userId
           WHERE fi.userId = ?
           ORDER BY fi.createdAt DESC LIMIT ? OFFSET ?`
        ).bind(ctx.userId, input.limit, offset).all<any>();
        items = rows.results ?? [];
      }

      // Enrich with like/comment counts
      const enriched = [];
      for (const item of items) {
        const likeCount = await db.prepare(
          `SELECT COUNT(*) as c FROM feed_likes WHERE feedItemId=?`
        ).bind(item.id).first<any>();
        const commentCount = await db.prepare(
          `SELECT COUNT(*) as c FROM feed_comments WHERE feedItemId=?`
        ).bind(item.id).first<any>();
        const liked = await db.prepare(
          `SELECT id FROM feed_likes WHERE feedItemId=? AND userId=?`
        ).bind(item.id, ctx.userId).first<any>();
        enriched.push({
          ...item,
          data: parseJson<any>(item.data),
          likeCount: likeCount?.c ?? 0,
          commentCount: commentCount?.c ?? 0,
          liked: !!liked,
        });
      }
      return { items: enriched, nextCursor: offset + input.limit };
    }),

  // Create a feed item
  create: protectedProcedure
    .input(z.object({
      type: z.enum(["matching_result", "tournament_result", "scenario_review", "achievement", "status"]),
      data: z.record(z.string(), z.unknown()),
      visibility: z.enum(["public", "friends", "private"]).default("friends"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO feed_items (userId, type, data, visibility) VALUES (?,?,?,?)`
      ).bind(ctx.userId, input.type, toJson(input.data), input.visibility).run();
      return { id: Number(res.meta.last_row_id) };
    }),

  // Like a feed item
  like: protectedProcedure
    .input(z.object({ feedItemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const item = await ctx.env.DB.prepare(`SELECT id, userId FROM feed_items WHERE id=?`).bind(input.feedItemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        await ctx.env.DB.prepare(
          `INSERT INTO feed_likes (feedItemId, userId) VALUES (?,?)`
        ).bind(input.feedItemId, ctx.userId).run();
      } catch { /* already liked — UNIQUE constraint */ }
      return { success: true };
    }),

  // Unlike a feed item
  unlike: protectedProcedure
    .input(z.object({ feedItemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM feed_likes WHERE feedItemId=? AND userId=?`
      ).bind(input.feedItemId, ctx.userId).run();
      return { success: true };
    }),

  // Comment on a feed item
  comment: protectedProcedure
    .input(z.object({ feedItemId: z.number(), content: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const item = await ctx.env.DB.prepare(`SELECT id FROM feed_items WHERE id=?`).bind(input.feedItemId).first<any>();
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const res = await ctx.env.DB.prepare(
        `INSERT INTO feed_comments (feedItemId, userId, content) VALUES (?,?,?)`
      ).bind(input.feedItemId, ctx.userId, input.content).run();
      return { id: Number(res.meta.last_row_id) };
    }),

  // Get comments for a feed item
  getComments: protectedProcedure
    .input(z.object({ feedItemId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT fc.*, u.name as userName, up.avatarUrl
         FROM feed_comments fc
         LEFT JOIN users u ON u.id = fc.userId
         LEFT JOIN user_profiles up ON up.userId = fc.userId
         WHERE fc.feedItemId=? ORDER BY fc.createdAt ASC`
      ).bind(input.feedItemId).all<any>();
      return rows.results ?? [];
    }),

  // Delete own feed item
  delete: protectedProcedure
    .input(z.object({ feedItemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM feed_items WHERE id=? AND userId=?`
      ).bind(input.feedItemId, ctx.userId).run();
      return { success: true };
    }),

  // Update visibility
  updateVisibility: protectedProcedure
    .input(z.object({ feedItemId: z.number(), visibility: z.enum(["public", "friends", "private"]) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE feed_items SET visibility=? WHERE id=? AND userId=?`
      ).bind(input.visibility, input.feedItemId, ctx.userId).run();
      return { success: true };
    }),

  // Auto-publish matching result to feed
  publishMatchingResult: protectedProcedure
    .input(z.object({ sessionId: z.number(), visibility: z.enum(["public", "friends", "private"]).default("friends") }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;
      const session = await db.prepare(
        `SELECT ms.*, mr.compatibilityScore, mr.summary, mr.scoreBreakdown,
          dt1.name as twin1Name, dt2.name as twin2Name
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         LEFT JOIN digital_twins dt1 ON dt1.id = ms.twin1Id
         LEFT JOIN digital_twins dt2 ON dt2.id = ms.twin2Id
         WHERE ms.id=? AND ms.initiatorUserId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const data = {
        sessionId: session.id,
        theme: session.theme,
        score: session.compatibilityScore ? parseFloat(session.compatibilityScore) : 0,
        summary: session.summary || "",
        twin1Name: session.twin1Name,
        twin2Name: session.twin2Name,
      };
      const res = await db.prepare(
        `INSERT INTO feed_items (userId, type, data, visibility) VALUES (?,?,?,?)`
      ).bind(ctx.userId, "matching_result", toJson(data), input.visibility).run();
      return { id: Number(res.meta.last_row_id) };
    }),
});
