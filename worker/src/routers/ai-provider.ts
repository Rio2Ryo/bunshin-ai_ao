import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now } from "../db-helpers";

export const aiProviderRouter = router({
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM ai_provider_settings WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getAvailableProviders: protectedProcedure.query(async () => {
      return [
        { id: "openai", provider: "openai", name: "OpenAI", available: true, models: ["gpt-4o", "gpt-4o-mini"] },
        { id: "gemini", provider: "gemini", name: "Gemini", available: true, models: ["gemini-2.0-flash", "gemini-1.5-pro"] },
        { id: "anthropic", provider: "anthropic", name: "Anthropic", available: true, models: ["claude-sonnet-4-20250514"] },
        { id: "grok", provider: "grok", name: "Grok", available: true, models: ["grok-2"] },
      ];
    }),
    testProvider: protectedProcedure
      .input(z.object({ provider: z.string(), model: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const config = await ctx.env.DB.prepare(
          `SELECT apiKey FROM ai_api_configs WHERE userId=? AND provider=? AND isActive=1`
        ).bind(ctx.userId, input.provider).first<any>();
        if (!config) return { success: false, error: "APIキーが設定されていません", message: "APIキーが設定されていません", latency: 0 };

        const startTime = Date.now();
        try {
          switch (input.provider) {
            case "openai": {
              const res = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${config.apiKey}` },
              });
              if (!res.ok) return { success: false, error: `API error: ${res.status}`, message: `OpenAI API error: ${res.status}`, latency: Date.now() - startTime };
              break;
            }
            case "gemini": {
              const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`);
              if (!res.ok) return { success: false, error: `API error: ${res.status}`, message: `Gemini API error: ${res.status}`, latency: Date.now() - startTime };
              break;
            }
            case "anthropic": {
              const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": config.apiKey,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: input.model || "claude-sonnet-4-20250514",
                  messages: [{ role: "user", content: "Hi" }],
                  max_tokens: 1,
                }),
              });
              if (res.status === 401 || res.status === 403) return { success: false, error: `API error: ${res.status}`, message: `Anthropic API error: ${res.status}`, latency: Date.now() - startTime };
              break;
            }
            case "grok": {
              const res = await fetch("https://api.x.ai/v1/models", {
                headers: { Authorization: `Bearer ${config.apiKey}` },
              });
              if (!res.ok) return { success: false, error: `API error: ${res.status}`, message: `Grok API error: ${res.status}`, latency: Date.now() - startTime };
              break;
            }
            default:
              return { success: false, error: "未対応のプロバイダー", message: "未対応のプロバイダー", latency: 0 };
          }
          const latency = Date.now() - startTime;
          // Update last validated timestamp
          await ctx.env.DB.prepare(
            `UPDATE ai_api_configs SET lastValidated=datetime('now') WHERE userId=? AND provider=?`
          ).bind(ctx.userId, input.provider).run();
          return { success: true, error: null, message: `接続成功 (${latency}ms)`, latency };
        } catch (e: any) {
          return { success: false, error: e.message, message: e.message, latency: Date.now() - startTime };
        }
      }),
    updateSetting: protectedProcedure
      .input(z.object({ feature: z.string(), provider: z.string(), model: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB.prepare(`SELECT id FROM ai_provider_settings WHERE userId=? AND feature=?`).bind(ctx.userId, input.feature).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE ai_provider_settings SET provider=?, model=?, updatedAt=datetime('now') WHERE id=?`).bind(input.provider, input.model ?? null, existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO ai_provider_settings (userId, feature, provider, model) VALUES (?,?,?,?)`).bind(ctx.userId, input.feature, input.provider, input.model ?? null).run();
        }
        return { success: true };
      }),
});

export const adminAiProviderRouter = router({
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM ai_provider_settings WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    updateSetting: protectedProcedure
      .input(z.object({ feature: z.string(), provider: z.string(), model: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB.prepare(`SELECT id FROM ai_provider_settings WHERE userId=? AND feature=?`).bind(ctx.userId, input.feature).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE ai_provider_settings SET provider=?, model=?, updatedAt=datetime('now') WHERE id=?`).bind(input.provider, input.model ?? null, existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO ai_provider_settings (userId, feature, provider, model) VALUES (?,?,?,?)`).bind(ctx.userId, input.feature, input.provider, input.model ?? null).run();
        }
        return { success: true };
      }),
});
