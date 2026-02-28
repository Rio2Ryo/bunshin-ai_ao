import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin } from "../db-helpers";

export const knowledgeRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];
    const rows = await ctx.env.DB.prepare(`SELECT * FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC`).bind(twin.id).all<any>();
    return (rows.results ?? []).map(r => ({ ...r, metadata: parseJson<any>(r.metadata) }));
  }),
  add: protectedProcedure
    .input(z.object({ sourceType: z.enum(["upload", "api", "manual"]), sourceId: z.string().max(255).optional(), title: z.string().max(200).optional(), content: z.string().max(50000).optional(), summary: z.string().max(1000).optional(), metadata: z.record(z.string(), z.unknown()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const res = await ctx.env.DB.prepare(`INSERT INTO knowledge_base (twinId, sourceType, sourceId, title, content, summary, metadata) VALUES (?,?,?,?,?,?,?)`).bind(twin.id, input.sourceType, input.sourceId ?? null, input.title ?? null, input.content ?? null, input.summary ?? null, toJson(input.metadata)).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Ownership check: only allow deleting knowledge entries belonging to user's twin
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIが見つかりません" });
      const entry = await ctx.env.DB.prepare(`SELECT id FROM knowledge_base WHERE id=? AND twinId=?`).bind(input.id, twin.id).first<any>();
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "ナレッジエントリが見つかりません" });
      await ctx.env.DB.prepare(`DELETE FROM knowledge_base WHERE id=? AND twinId=?`).bind(input.id, twin.id).run();
      return { success: true };
    }),
});

export const filesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`SELECT * FROM uploaded_files WHERE userId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  upload: protectedProcedure
    .input(z.object({ filename: z.string(), content: z.string(), mimeType: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      const fileKey = `twins/${ctx.userId}/${Date.now()}-${input.filename}`;
      const url = `/assets/${fileKey}`;

      // Write to R2 if available
      const r2 = ctx.env.ASSETS;
      let status = "pending";
      if (r2) {
        const base64Data = input.content.replace(/^data:[^;]+;base64,/, "");
        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        await r2.put(fileKey, binaryData, { httpMetadata: { contentType: input.mimeType } });
        status = "uploaded";
      }

      const res = await ctx.env.DB.prepare(`INSERT INTO uploaded_files (userId, twinId, filename, fileKey, url, mimeType, size, status) VALUES (?,?,?,?,?,?,?,?)`).bind(ctx.userId, twin?.id ?? null, input.filename, fileKey, url, input.mimeType, input.content.length, status).run();
      return { id: Number(res.meta.last_row_id), url };
    }),
  process: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE uploaded_files SET status='completed', processedAt=datetime('now') WHERE id=?`).bind(input.fileId).run();
      return { success: true };
    }),
});
