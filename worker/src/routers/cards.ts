import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson } from "../db-helpers";

export const cardsRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional(), type: z.string().optional(), cardType: z.string().optional(), archived: z.boolean().optional(), isArchived: z.boolean().optional(), isFavorite: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let sql = `SELECT * FROM cards WHERE userId=?`;
      const binds: any[] = [ctx.userId];
      if (input?.archived || input?.isArchived) {
        sql += ` AND isArchived=1`;
      } else {
        sql += ` AND isArchived=0`;
      }
      if (input?.type) { sql += ` AND cardType=?`; binds.push(input.type); }
      if (input?.search) { sql += ` AND (name LIKE ? OR company LIKE ? OR email LIKE ?)`; binds.push(`%${input.search}%`, `%${input.search}%`, `%${input.search}%`); }
      sql += ` ORDER BY createdAt DESC`;
      const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<any>();
      return (rows.results ?? []).map(r => {
        const parsed = { ...r, tags: parseJson<string[]>(r.tags) ?? [], ocrData: parseJson<any>(r.ocrData) };
        return { ...parsed, title: parsed.name, frontImageUrl: parsed.imageUrl, extractedData: parsed.ocrData };
      });
    }),
  create: protectedProcedure
    .input(z.object({ cardType: z.string().optional(), name: z.string().optional(), title: z.string().optional(), company: z.string().optional(), position: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), address: z.string().optional(), website: z.string().optional(), imageUrl: z.string().optional(), frontImageUrl: z.string().optional(), frontImageKey: z.string().optional(), ocrData: z.any().optional(), extractedData: z.any().optional(), notes: z.string().optional(), tags: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const cardName = input.name ?? input.title ?? null;
      const cardImageUrl = input.imageUrl ?? input.frontImageUrl ?? null;
      const cardOcrData = input.ocrData ?? input.extractedData ?? null;
      const res = await ctx.env.DB.prepare(`INSERT INTO cards (userId, cardType, name, company, position, email, phone, address, website, imageUrl, ocrData, notes, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ctx.userId, input.cardType ?? "business_card", cardName, input.company ?? null, input.position ?? null, input.email ?? null, input.phone ?? null, input.address ?? null, input.website ?? null, cardImageUrl, toJson(cardOcrData), input.notes ?? null, toJson(input.tags)).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  update: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().optional(), title: z.string().optional(), company: z.string().optional(), position: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), notes: z.string().optional(), isFavorite: z.boolean().optional(), isArchived: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
      const sets: string[] = [];
      const binds: any[] = [];
      const nameVal = input.name ?? input.title;
      if (nameVal !== undefined) { sets.push("name=?"); binds.push(nameVal); }
      if (input.company !== undefined) { sets.push("company=?"); binds.push(input.company); }
      if (input.position !== undefined) { sets.push("position=?"); binds.push(input.position); }
      if (input.email !== undefined) { sets.push("email=?"); binds.push(input.email); }
      if (input.phone !== undefined) { sets.push("phone=?"); binds.push(input.phone); }
      if (input.notes !== undefined) { sets.push("notes=?"); binds.push(input.notes); }
      if (input.isFavorite !== undefined) { sets.push("isFavorite=?"); binds.push(input.isFavorite ? 1 : 0); }
      if (input.isArchived !== undefined) { sets.push("isArchived=?"); binds.push(input.isArchived ? 1 : 0); }
      if (sets.length > 0) {
        sets.push("updatedAt=datetime('now')");
        binds.push(input.id, ctx.userId);
        await ctx.env.DB.prepare(`UPDATE cards SET ${sets.join(",")} WHERE id=? AND userId=?`).bind(...binds).run();
      }
      return { success: true };
    }),
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
      if (!row) return null;
      const parsed = { ...row, tags: parseJson<string[]>(row.tags) ?? [], ocrData: parseJson<any>(row.ocrData) };
      return { ...parsed, title: parsed.name, frontImageUrl: parsed.imageUrl, extractedData: parsed.ocrData };
    }),
  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB.prepare(`DELETE FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
    return { success: true };
  }),
  toggleFavorite: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const card = await ctx.env.DB.prepare(`SELECT isFavorite FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
      if (!card) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.env.DB.prepare(`UPDATE cards SET isFavorite=?, updatedAt=datetime('now') WHERE id=?`).bind(card.isFavorite ? 0 : 1, input.id).run();
      return { success: true };
    }),
  toggleArchive: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const card = await ctx.env.DB.prepare(`SELECT isArchived FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
      if (!card) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.env.DB.prepare(`UPDATE cards SET isArchived=?, updatedAt=datetime('now') WHERE id=?`).bind(card.isArchived ? 0 : 1, input.id).run();
      return { success: true };
    }),
  search: protectedProcedure
    .input(z.object({ query: z.string(), cardType: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM cards WHERE userId=? AND (name LIKE ? OR company LIKE ? OR email LIKE ?) ORDER BY createdAt DESC`).bind(ctx.userId, `%${input.query}%`, `%${input.query}%`, `%${input.query}%`).all<any>();
      return (rows.results ?? []).map((r: any) => {
        const parsed = { ...r, tags: parseJson<string[]>(r.tags) ?? [], ocrData: parseJson<any>(r.ocrData) };
        return { ...parsed, title: parsed.name, frontImageUrl: parsed.imageUrl, extractedData: parsed.ocrData };
      });
    }),
  uploadImage: protectedProcedure
    .input(z.object({ id: z.number().optional(), imageData: z.string(), fileName: z.string().optional(), contentType: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const r2 = ctx.env.ASSETS;
      if (!r2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "R2 storage is not configured" });

      // Decode base64 data (strip data URL prefix if present)
      const base64Data = input.imageData.replace(/^data:[^;]+;base64,/, "");
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      const ext = (input.fileName || "image.jpg").split(".").pop() || "jpg";
      const key = `cards/${ctx.userId}/${Date.now()}.${ext}`;
      const contentType = input.contentType || `image/${ext === "jpg" ? "jpeg" : ext}`;

      await r2.put(key, binaryData, { httpMetadata: { contentType } });

      const url = `/assets/${key}`;

      // Update card record if id provided
      if (input.id) {
        await ctx.env.DB.prepare(`UPDATE cards SET imageUrl=?, updatedAt=datetime('now') WHERE id=? AND userId=?`)
          .bind(url, input.id, ctx.userId).run();
      }

      return { url, key, imageUrl: url, success: true };
    }),
  analyzeImage: protectedProcedure
    .input(z.object({ imageUrl: z.string(), cardType: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const nullResult = { name: null as string | null, company: null as string | null, position: null as string | null, email: null as string | null, phone: null as string | null, address: null as string | null, website: null as string | null, storeName: null as string | null, organizationName: null as string | null, hospitalName: null as string | null };

      // Get image data - from R2 if local path, or fetch from URL
      let imageBase64: string | null = null;
      let imageMimeType = "image/jpeg";

      if (input.imageUrl.startsWith("/assets/")) {
        const r2 = ctx.env.ASSETS;
        if (r2) {
          const key = input.imageUrl.replace(/^\/assets\//, "");
          const obj = await r2.get(key);
          if (obj) {
            const buf = await obj.arrayBuffer();
            imageBase64 = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf))));
            imageMimeType = obj.httpMetadata?.contentType || "image/jpeg";
          }
        }
      } else if (input.imageUrl.startsWith("data:")) {
        const match = input.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          imageMimeType = match[1];
          imageBase64 = match[2];
        }
      }

      if (!imageBase64) {
        return { extractedData: nullResult, ocrData: null };
      }

      // Get user's LLM config - prefer vision-capable models
      const configs = await ctx.env.DB.prepare(`SELECT provider, apiKey FROM ai_api_configs WHERE userId=? AND isActive=1`).bind(ctx.userId).all<any>();
      const keys = new Map<string, string>();
      for (const c of configs.results ?? []) keys.set(c.provider, c.apiKey);

      const ocrPrompt = `この名刺画像からテキストを読み取り、以下のJSON形式で情報を抽出してください。
読み取れない項目はnullにしてください。JSONのみ出力してください。
{
  "name": "氏名",
  "company": "会社名",
  "position": "役職",
  "email": "メールアドレス",
  "phone": "電話番号",
  "address": "住所",
  "website": "ウェブサイト"
}`;

      let ocrResult: any = null;

      // Try OpenAI (gpt-4o has vision)
      if (keys.has("openai")) {
        try {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys.get("openai")}` },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: [
                { type: "text", text: ocrPrompt },
                { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
              ] }],
              max_tokens: 1024,
            }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            const text = data.choices?.[0]?.message?.content ?? "";
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) ocrResult = JSON.parse(jsonMatch[0]);
          }
        } catch { /* fall through */ }
      }

      // Try Gemini (vision capable)
      if (!ocrResult && keys.has("gemini")) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys.get("gemini")}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [
                  { text: ocrPrompt },
                  { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
                ] }],
              }),
            }
          );
          if (res.ok) {
            const data = await res.json() as any;
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) ocrResult = JSON.parse(jsonMatch[0]);
          }
        } catch { /* fall through */ }
      }

      if (!ocrResult) {
        return { extractedData: nullResult, ocrData: null };
      }

      const extractedData = {
        name: ocrResult.name ?? null,
        company: ocrResult.company ?? null,
        position: ocrResult.position ?? null,
        email: ocrResult.email ?? null,
        phone: ocrResult.phone ?? null,
        address: ocrResult.address ?? null,
        website: ocrResult.website ?? null,
        storeName: null as string | null,
        organizationName: ocrResult.company ?? null,
        hospitalName: null as string | null,
      };

      return { extractedData, ocrData: ocrResult };
    }),
  getStats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const total = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM cards WHERE userId=? AND isArchived=0`).bind(ctx.userId).first<any>();
    const favorites = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM cards WHERE userId=? AND isFavorite=1`).bind(ctx.userId).first<any>();
    const business = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM cards WHERE userId=? AND cardType='business_card' AND isArchived=0`).bind(ctx.userId).first<any>();
    return [
      { label: "合計", value: total?.c ?? 0, count: total?.c ?? 0, icon: "card", cardType: "all" },
      { label: "名刺", value: business?.c ?? 0, count: business?.c ?? 0, icon: "briefcase", cardType: "business_card" },
      { label: "お気に入り", value: favorites?.c ?? 0, count: favorites?.c ?? 0, icon: "star", cardType: "favorite" },
    ];
  }),
});
