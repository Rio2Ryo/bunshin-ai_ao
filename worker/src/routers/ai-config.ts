import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now } from "../db-helpers";

export const aiConfigRouter = router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM ai_api_configs WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    upsert: protectedProcedure
      .input(z.object({ provider: z.enum(["openai", "gemini", "anthropic", "grok"]), apiKey: z.string().min(1), isActive: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB.prepare(`SELECT id FROM ai_api_configs WHERE userId=? AND provider=?`).bind(ctx.userId, input.provider).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE ai_api_configs SET apiKey=?, isActive=?, updatedAt=datetime('now') WHERE id=?`).bind(input.apiKey, input.isActive ?? 1, existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO ai_api_configs (userId, provider, apiKey, isActive) VALUES (?,?,?,?)`).bind(ctx.userId, input.provider, input.apiKey, input.isActive ?? 1).run();
        }
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ provider: z.enum(["openai", "gemini", "anthropic", "grok"]) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`DELETE FROM ai_api_configs WHERE userId=? AND provider=?`).bind(ctx.userId, input.provider).run();
        return { success: true };
      }),
    validate: protectedProcedure
      .input(z.object({ provider: z.enum(["openai", "gemini", "anthropic", "grok"]), apiKey: z.string() }))
      .mutation(async ({ input }) => {
        const { provider, apiKey } = input;
        try {
          switch (provider) {
            case "openai": {
              const res = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (!res.ok) return { valid: false, error: `OpenAI API error: ${res.status}` };
              return { valid: true };
            }
            case "gemini": {
              const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
              );
              if (!res.ok) return { valid: false, error: `Gemini API error: ${res.status}` };
              return { valid: true };
            }
            case "anthropic": {
              const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: "claude-sonnet-4-20250514",
                  messages: [{ role: "user", content: "Hi" }],
                  max_tokens: 1,
                }),
              });
              // 200 or 400 (bad request but key is valid) both mean the key works
              if (res.status === 401 || res.status === 403) return { valid: false, error: `Anthropic API error: ${res.status}` };
              return { valid: true };
            }
            case "grok": {
              const res = await fetch("https://api.x.ai/v1/models", {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (!res.ok) return { valid: false, error: `Grok API error: ${res.status}` };
              return { valid: true };
            }
          }
        } catch (e: any) {
          return { valid: false, error: e.message };
        }
      }),
});

export const orchestrationRouter = router({
    roles: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM orchestration_roles WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    createRole: protectedProcedure
      .input(z.object({ roleName: z.string().min(1), roleDescription: z.string().optional(), assignedProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]), assignedModel: z.string().optional(), priority: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const res = await ctx.env.DB.prepare(`INSERT INTO orchestration_roles (userId, roleName, roleDescription, assignedProvider, assignedModel, priority) VALUES (?,?,?,?,?,?)`).bind(ctx.userId, input.roleName, input.roleDescription ?? null, input.assignedProvider, input.assignedModel ?? null, input.priority ?? 1).run();
        return { id: Number(res.meta.last_row_id) };
      }),
    updateRole: protectedProcedure
      .input(z.object({ id: z.number(), roleName: z.string().optional(), roleDescription: z.string().optional(), assignedProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]).optional(), assignedModel: z.string().optional(), priority: z.number().optional(), isActive: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
        const sets: string[] = [];
        const binds: any[] = [];
        if (input.roleName !== undefined) { sets.push("roleName=?"); binds.push(input.roleName); }
        if (input.roleDescription !== undefined) { sets.push("roleDescription=?"); binds.push(input.roleDescription); }
        if (input.assignedProvider !== undefined) { sets.push("assignedProvider=?"); binds.push(input.assignedProvider); }
        if (input.assignedModel !== undefined) { sets.push("assignedModel=?"); binds.push(input.assignedModel); }
        if (input.priority !== undefined) { sets.push("priority=?"); binds.push(input.priority); }
        if (input.isActive !== undefined) { sets.push("isActive=?"); binds.push(input.isActive); }
        if (sets.length > 0) {
          sets.push("updatedAt=datetime('now')");
          binds.push(input.id);
          await ctx.env.DB.prepare(`UPDATE orchestration_roles SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
        }
        return { success: true };
      }),
    deleteRole: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM orchestration_roles WHERE id=?`).bind(input.id).run();
      return { success: true };
    }),
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const roles = await ctx.env.DB.prepare(`SELECT * FROM orchestration_roles WHERE userId=?`).bind(ctx.userId).all<any>();
      const configs = await ctx.env.DB.prepare(`SELECT * FROM ai_api_configs WHERE userId=?`).bind(ctx.userId).all<any>();
      return { roles: roles.results ?? [], configs: configs.results ?? [] };
    }),
    updateSettings: protectedProcedure
      .input(z.object({ defaultProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]).optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        if (input.defaultProvider) {
          // Upsert ai_provider_settings for 'orchestration' feature
          const existing = await ctx.env.DB.prepare(
            `SELECT id FROM ai_provider_settings WHERE userId=? AND feature='orchestration'`
          ).bind(ctx.userId).first<any>();
          if (existing) {
            await ctx.env.DB.prepare(
              `UPDATE ai_provider_settings SET provider=?, updatedAt=datetime('now') WHERE id=?`
            ).bind(input.defaultProvider, existing.id).run();
          } else {
            await ctx.env.DB.prepare(
              `INSERT INTO ai_provider_settings (userId, feature, provider) VALUES (?,?,?)`
            ).bind(ctx.userId, "orchestration", input.defaultProvider).run();
          }
        }
        return { success: true };
      }),
});
