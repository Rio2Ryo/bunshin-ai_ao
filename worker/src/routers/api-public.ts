import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { ensureSchema, parseJson, toJson } from "../db-helpers";

export const apiPublicRouter = router({
  // API key management
  listKeys: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, name, keyPrefix, permissions, lastUsedAt, createdAt FROM api_keys WHERE userId=? AND revokedAt IS NULL ORDER BY createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, permissions: parseJson<string[]>(r.permissions) ?? [] }));
  }),

  createKey: protectedProcedure.input(z.object({
    name: z.string().min(1).max(100),
    permissions: z.array(z.string()).optional(),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const rawKey = crypto.randomUUID() + "-" + crypto.randomUUID();
    const prefix = rawKey.slice(0, 8);
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
    await ctx.env.DB.prepare(
      `INSERT INTO api_keys (userId, name, keyHash, keyPrefix, permissions) VALUES (?,?,?,?,?)`
    ).bind(ctx.userId, input.name, keyHash, prefix, toJson(input.permissions ?? ["read"])).run();
    return { key: `bai_${rawKey}`, prefix };
  }),

  revokeKey: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`UPDATE api_keys SET revokedAt=datetime('now') WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
    return { success: true };
  }),

  // Webhook management
  listWebhooks: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, url, events, secret, isActive, lastTriggeredAt, failCount, createdAt FROM webhooks WHERE userId=? ORDER BY createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, events: parseJson<string[]>(r.events) ?? [], secret: r.secret ? "***" : null }));
  }),

  createWebhook: protectedProcedure.input(z.object({
    url: z.string().url(),
    events: z.array(z.string()),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const secret = crypto.randomUUID();
    const res = await ctx.env.DB.prepare(
      `INSERT INTO webhooks (userId, url, events, secret) VALUES (?,?,?,?)`
    ).bind(ctx.userId, input.url, toJson(input.events), secret).run();
    return { id: Number(res.meta.last_row_id), secret };
  }),

  deleteWebhook: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`DELETE FROM webhooks WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
    return { success: true };
  }),

  toggleWebhook: protectedProcedure.input(z.object({ id: z.number(), isActive: z.boolean() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`UPDATE webhooks SET isActive=? WHERE id=? AND userId=?`).bind(input.isActive ? 1 : 0, input.id, ctx.userId).run();
    return { success: true };
  }),
});
