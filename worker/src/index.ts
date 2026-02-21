import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import superjson from "superjson";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  ensureSchema,
  parseJson,
  toJson,
  now,
  getMyTwin,
  normalizeTwin,
  getCumulativeWaveform,
  getOtherPerspectiveWaveform,
} from "./db-helpers";

// ============ Types ============

type Env = {
  DB: D1Database;
  ASSETS?: R2Bucket;
};

type Context = {
  env: Env;
  userId: number;
};

// ============ tRPC Setup ============

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const router = t.router;
const publicProcedure = t.procedure;

// ============ Helper: generate random code ============
function generateCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============ tRPC Router ============

const appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ ok: true })),
  }),

  // ============ Auth ============
  auth: router({
    me: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      // Phase 1: return anon user
      let user = await ctx.env.DB
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .bind(ctx.userId)
        .first<any>();
      if (!user) {
        await ctx.env.DB
          .prepare(`INSERT INTO users (openId, name, role, plan) VALUES (?, ?, 'user', 'free')`)
          .bind(`anon_${ctx.userId}`, "ゲストユーザー")
          .run();
        user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(ctx.userId).first<any>();
      }
      return user;
    }),
    logout: publicProcedure.mutation(() => ({ success: true })),
  }),

  // ============ Profile ============
  profile: router({
    get: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB
        .prepare(`SELECT * FROM user_profiles WHERE userId = ?`)
        .bind(ctx.userId)
        .first<any>();
      if (!row) return null;
      return {
        ...row,
        skills: parseJson<string[]>(row.skills) ?? [],
        expertise: parseJson<string[]>(row.expertise) ?? [],
      };
    }),
    update: publicProcedure
      .input(z.object({
        displayName: z.string().optional(),
        bio: z.string().optional(),
        skills: z.array(z.string()).optional(),
        experience: z.string().optional(),
        businessInfo: z.string().optional(),
        expertise: z.array(z.string()).optional(),
        industry: z.string().optional(),
        company: z.string().optional(),
        position: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB
          .prepare(`SELECT id FROM user_profiles WHERE userId = ?`)
          .bind(ctx.userId)
          .first<any>();
        if (existing) {
          await ctx.env.DB
            .prepare(`UPDATE user_profiles SET displayName=?, bio=?, skills=?, experience=?, businessInfo=?, expertise=?, industry=?, company=?, position=?, updatedAt=datetime('now') WHERE userId=?`)
            .bind(
              input.displayName ?? null, input.bio ?? null,
              toJson(input.skills), input.experience ?? null,
              input.businessInfo ?? null, toJson(input.expertise),
              input.industry ?? null, input.company ?? null,
              input.position ?? null, ctx.userId
            ).run();
        } else {
          await ctx.env.DB
            .prepare(`INSERT INTO user_profiles (userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position) VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .bind(
              ctx.userId, input.displayName ?? null, input.bio ?? null,
              toJson(input.skills), input.experience ?? null,
              input.businessInfo ?? null, toJson(input.expertise),
              input.industry ?? null, input.company ?? null,
              input.position ?? null
            ).run();
        }
        return { success: true };
      }),
  }),

  // ============ My Twin ============
  myTwin: router({
    get: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return null;
      // Attach cumulative waveform and scenario progress
      const cw = await getCumulativeWaveform(ctx.env.DB, ctx.userId, twin.id);
      const opw = await getOtherPerspectiveWaveform(ctx.env.DB, ctx.userId);
      const progress = await ctx.env.DB
        .prepare(`SELECT COUNT(*) as completed FROM value_scenario_responses WHERE userId = ? AND twinId = ?`)
        .bind(ctx.userId, twin.id)
        .first<any>();
      return {
        ...twin,
        cumulativeWaveform: cw,
        otherPerspectiveWaveform: opw,
        scenarioProgress: { completed: progress?.completed ?? 0, total: 18 },
      };
    }),

    upsert: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        rawInput: z.string().optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!existing) {
          const res = await ctx.env.DB
            .prepare(`INSERT INTO digital_twins (userId, name, rawInput, status, updatedAt) VALUES (?, ?, ?, 'active', datetime('now'))`)
            .bind(ctx.userId, input.name, input.rawInput ?? null)
            .run();
          return { id: Number(res.meta.last_row_id) };
        }
        await ctx.env.DB
          .prepare(`UPDATE digital_twins SET name=?, rawInput=?, updatedAt=datetime('now') WHERE id=?`)
          .bind(input.name, input.rawInput ?? null, existing.id)
          .run();
        return { id: existing.id };
      }),

    update: publicProcedure
      .input(z.object({
        name: z.string().optional(),
        rawInput: z.string().optional().nullable(),
        status: z.enum(["active", "inactive", "training"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
        const sets: string[] = [];
        const binds: any[] = [];
        if (input.name !== undefined) { sets.push("name=?"); binds.push(input.name); }
        if (input.rawInput !== undefined) { sets.push("rawInput=?"); binds.push(input.rawInput); }
        if (input.status !== undefined) { sets.push("status=?"); binds.push(input.status); }
        if (sets.length > 0) {
          sets.push("updatedAt=datetime('now')");
          binds.push(twin.id);
          await ctx.env.DB.prepare(`UPDATE digital_twins SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
        }
        return { success: true };
      }),

    updatePublicSettings: publicProcedure
      .input(z.object({
        isPublic: z.boolean(),
        publicBio: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) return null;
        await ctx.env.DB
          .prepare(`UPDATE digital_twins SET isPublic=?, publicBio=?, tags=?, updatedAt=datetime('now') WHERE id=?`)
          .bind(input.isPublic ? 1 : 0, input.publicBio ?? null, toJson(input.tags ?? twin.tags) ?? null, twin.id)
          .run();
        return getMyTwin(ctx.env.DB, ctx.userId);
      }),

    reset: publicProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM digital_twins WHERE userId = ?`).bind(ctx.userId).run();
      return { ok: true };
    }),

    // Personality & Waveform stubs (Phase 1 - return ok)
    analyzeBigFive: publicProcedure.mutation(async () => ({ bigFiveTraits: null })),
    analyzeJudgmentThresholds: publicProcedure.mutation(async () => ({ judgmentThresholds: null })),
    generateSelfWaveform: publicProcedure.mutation(async () => ({ ok: true })),
    evaluateWaveform: publicProcedure.mutation(async () => ({ ok: true })),
    reevaluateAndUpdateWaveform: publicProcedure.mutation(async () => ({ success: true, evaluatedCount: 0, totalResponses: 0 })),
    refreshCumulativeWaveform: publicProcedure.mutation(async () => ({ success: true })),
    evaluateByAllTwins: publicProcedure.mutation(async () => ({ success: true, evaluatedCount: 0, totalResponses: 0, totalEvaluators: 0, totalEvaluations: 0 })),
    calculateAccuracy: publicProcedure.mutation(async () => ({ personalitySimilarity: 0, accuracyScore: 0 })),
    runFullAnalysis: publicProcedure.mutation(async () => ({ ok: true })),
    runIntegratedAnalysis: publicProcedure.mutation(async () => ({ ok: true })),
    personalityInterview: publicProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async () => ({ message: "Phase 1ではこの機能は使えません", question: "Phase 1ではこの機能は使えません", isComplete: false, traits: null as { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number } | null })),
    mbtiInterview: publicProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async () => ({ message: "Phase 1ではこの機能は使えません", question: "Phase 1ではこの機能は使えません", isComplete: false, mbtiType: null as any })),
    valueScenarioInterview: publicProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async () => ({ message: "Phase 1ではこの機能は使えません", response: "Phase 1ではこの機能は使えません", isComplete: false, currentScenarioIndex: 0, totalScenarios: 18 })),
    getScenarioProgress: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { completed: 0, total: 18 };
      const r = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM value_scenario_responses WHERE userId=? AND twinId=?`).bind(ctx.userId, twin.id).first<any>();
      return { completed: r?.c ?? 0, total: 18 };
    }),
    getCumulativeWaveform: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return null;
      return getCumulativeWaveform(ctx.env.DB, ctx.userId, twin.id);
    }),
    getAvailableScenarios: publicProcedure.query(async () => ({ scenarios: [], categories: [] })),
    searchPublic: publicProcedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(async ({ ctx }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB
          .prepare(`SELECT * FROM digital_twins WHERE isPublic=1 AND userId != ? LIMIT 20`)
          .bind(ctx.userId)
          .all<any>();
        return (rows.results ?? []).map(normalizeTwin);
      }),
    getPublicTwin: publicProcedure
      .input(z.object({ twinId: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const row = await ctx.env.DB
          .prepare(`SELECT * FROM digital_twins WHERE id=? AND isPublic=1 LIMIT 1`)
          .bind(input.twinId)
          .first<any>();
        if (!row) return null;
        const user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE id=?`).bind(row.userId).first<any>();
        return { twin: normalizeTwin(row), user };
      }),
  }),

  // ============ Friends ============
  friends: router({
    list: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB
        .prepare(`SELECT f.*, u.id as fId, u.name as fName, u.email as fEmail, u.friendCode as fFriendCode FROM friendships f JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
        .bind(ctx.userId, ctx.userId, ctx.userId)
        .all<any>();
      const results = [];
      for (const r of rows.results ?? []) {
        const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(r.fId).first<any>();
        results.push({
          friendship: { id: r.id, status: r.status, createdAt: r.createdAt },
          friend: { id: r.fId, name: r.fName, email: r.fEmail, friendCode: r.fFriendCode },
          twin: normalizeTwin(twin),
        });
      }
      return results;
    }),
    pendingRequests: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB
        .prepare(`SELECT f.*, u.name as senderName, u.email as senderEmail FROM friendships f JOIN users u ON u.id=f.userId WHERE f.friendId=? AND f.status='pending'`)
        .bind(ctx.userId)
        .all<any>();
      return (rows.results ?? []).map(r => ({
        id: r.id, userId: r.userId, senderName: r.senderName, createdAt: r.createdAt,
        friendship: { id: r.id, status: r.status, createdAt: r.createdAt },
        sender: { id: r.userId, name: r.senderName, email: r.senderEmail },
      }));
    }),
    sentRequests: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB
        .prepare(`SELECT f.*, u.name as recipientName FROM friendships f JOIN users u ON u.id=f.friendId WHERE f.userId=? AND f.status='pending'`)
        .bind(ctx.userId)
        .all<any>();
      return (rows.results ?? []).map(r => ({ id: r.id, friendId: r.friendId, recipientName: r.recipientName, createdAt: r.createdAt }));
    }),
    searchUsers: publicProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB
          .prepare(`SELECT id, name, email, friendCode FROM users WHERE id!=? AND (name LIKE ? OR friendCode=?) LIMIT 20`)
          .bind(ctx.userId, `%${input.query}%`, input.query.toUpperCase())
          .all<any>();
        return rows.results ?? [];
      }),
    sendRequest: publicProcedure
      .input(z.object({ friendCode: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const friend = await ctx.env.DB.prepare(`SELECT * FROM users WHERE friendCode=?`).bind(input.friendCode.toUpperCase()).first<any>();
        if (!friend) throw new TRPCError({ code: "NOT_FOUND", message: "ユーザーが見つかりません" });
        if (friend.id === ctx.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分にはリクエストを送れません" });
        const res = await ctx.env.DB.prepare(`INSERT INTO friendships (userId, friendId, status) VALUES (?,?,'pending')`).bind(ctx.userId, friend.id).run();
        return { id: Number(res.meta.last_row_id) };
      }),
    acceptRequest: publicProcedure
      .input(z.object({ requestId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE friendships SET status='accepted', updatedAt=datetime('now') WHERE id=? AND friendId=?`).bind(input.requestId, ctx.userId).run();
        return { success: true };
      }),
    rejectRequest: publicProcedure
      .input(z.object({ requestId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE friendships SET status='rejected', updatedAt=datetime('now') WHERE id=? AND friendId=?`).bind(input.requestId, ctx.userId).run();
        return { success: true };
      }),
    remove: publicProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`DELETE FROM friendships WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)`).bind(ctx.userId, input.friendId, input.friendId, ctx.userId).run();
        return { success: true };
      }),
    getWaveformCompatibility: publicProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async () => ({ hasData: false, message: "Phase 1: 波形比較は未対応", compatibility: null })),
    getIntimacy: publicProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async () => ({ intimacyScore: 0, intimacyLevel: "stranger" as const, intimacyLevelLabel: "見知らぬ人", predictionAccuracy: null })),
    updateIntimacy: publicProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async () => ({ intimacyScore: 0, intimacyLevel: "stranger" as const, intimacyLevelLabel: "見知らぬ人" })),
    getAllIntimacyScores: publicProcedure.query(async () => []),
    requestPredictions: publicProcedure
      .input(z.object({ scenarioId: z.string(), scenarioText: z.string(), friendUserIds: z.array(z.number()) }))
      .mutation(async () => ({ predictionIds: [], count: 0 })),
    updateOtherPerspectiveWaveform: publicProcedure.mutation(async () => ({ success: true, selfReportGap: null })),
    generateFriendPredictions: publicProcedure.mutation(async () => ({ success: true, friendsProcessed: 0, successfulPredictions: 0, totalPredictions: 0 })),
    getAllWaveformCompatibilities: publicProcedure.query(async () => ({ hasMyWaveform: false, message: "波形が未生成です", compatibilities: [] as { friendId: number; overallCompatibility: number; waveformSimilarity: number; virtueCompatibility: number; mineCompatibility: number }[] })),
  }),

  // ============ Knowledge Base ============
  knowledge: router({
    list: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC`).bind(twin.id).all<any>();
      return (rows.results ?? []).map(r => ({ ...r, metadata: parseJson<any>(r.metadata) }));
    }),
    add: publicProcedure
      .input(z.object({ sourceType: z.enum(["upload", "api", "manual"]), sourceId: z.string().optional(), title: z.string().optional(), content: z.string().optional(), summary: z.string().optional(), metadata: z.record(z.string(), z.unknown()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const res = await ctx.env.DB.prepare(`INSERT INTO knowledge_base (twinId, sourceType, sourceId, title, content, summary, metadata) VALUES (?,?,?,?,?,?,?)`).bind(twin.id, input.sourceType, input.sourceId ?? null, input.title ?? null, input.content ?? null, input.summary ?? null, toJson(input.metadata)).run();
        return { id: Number(res.meta.last_row_id) };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`DELETE FROM knowledge_base WHERE id=?`).bind(input.id).run();
        return { success: true };
      }),
  }),

  // ============ Files ============
  files: router({
    list: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM uploaded_files WHERE userId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    upload: publicProcedure
      .input(z.object({ filename: z.string(), content: z.string(), mimeType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        const fileKey = `twins/${ctx.userId}/${Date.now()}-${input.filename}`;
        // Store in R2 if available
        const url = `/assets/${fileKey}`;
        const res = await ctx.env.DB.prepare(`INSERT INTO uploaded_files (userId, twinId, filename, fileKey, url, mimeType, size, status) VALUES (?,?,?,?,?,?,?,?)`).bind(ctx.userId, twin?.id ?? null, input.filename, fileKey, url, input.mimeType, input.content.length, "pending").run();
        return { id: Number(res.meta.last_row_id), url };
      }),
    process: publicProcedure
      .input(z.object({ fileId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE uploaded_files SET status='completed', processedAt=datetime('now') WHERE id=?`).bind(input.fileId).run();
        return { success: true };
      }),
  }),

  // ============ AI Config ============
  aiConfig: router({
    list: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM ai_api_configs WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    upsert: publicProcedure
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
    delete: publicProcedure
      .input(z.object({ provider: z.enum(["openai", "gemini", "anthropic", "grok"]) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`DELETE FROM ai_api_configs WHERE userId=? AND provider=?`).bind(ctx.userId, input.provider).run();
        return { success: true };
      }),
    validate: publicProcedure
      .input(z.object({ provider: z.enum(["openai", "gemini", "anthropic", "grok"]), apiKey: z.string() }))
      .mutation(async () => ({ valid: true })),
  }),

  // ============ Orchestration ============
  orchestration: router({
    roles: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM orchestration_roles WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    createRole: publicProcedure
      .input(z.object({ roleName: z.string().min(1), roleDescription: z.string().optional(), assignedProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]), assignedModel: z.string().optional(), priority: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const res = await ctx.env.DB.prepare(`INSERT INTO orchestration_roles (userId, roleName, roleDescription, assignedProvider, assignedModel, priority) VALUES (?,?,?,?,?,?)`).bind(ctx.userId, input.roleName, input.roleDescription ?? null, input.assignedProvider, input.assignedModel ?? null, input.priority ?? 1).run();
        return { id: Number(res.meta.last_row_id) };
      }),
    updateRole: publicProcedure
      .input(z.object({ id: z.number(), roleName: z.string().optional(), roleDescription: z.string().optional(), assignedProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]).optional(), assignedModel: z.string().optional(), priority: z.number().optional(), isActive: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
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
    deleteRole: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM orchestration_roles WHERE id=?`).bind(input.id).run();
      return { success: true };
    }),
    getSettings: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const roles = await ctx.env.DB.prepare(`SELECT * FROM orchestration_roles WHERE userId=?`).bind(ctx.userId).all<any>();
      const configs = await ctx.env.DB.prepare(`SELECT * FROM ai_api_configs WHERE userId=?`).bind(ctx.userId).all<any>();
      return { roles: roles.results ?? [], configs: configs.results ?? [] };
    }),
    updateSettings: publicProcedure
      .input(z.object({ defaultProvider: z.enum(["openai", "gemini", "anthropic", "grok", "builtin"]).optional() }))
      .mutation(async () => ({ success: true })),
  }),

  // ============ Chat ============
  chat: router({
    sessions: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE userId=? ORDER BY updatedAt DESC`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getSession: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const session = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        const msgs = await ctx.env.DB.prepare(`SELECT * FROM chat_messages WHERE sessionId=? ORDER BY createdAt ASC`).bind(input.id).all<any>();
        return { session, messages: (msgs.results ?? []).map(m => ({ ...m, metadata: parseJson<any>(m.metadata) })) };
      }),
    createSession: publicProcedure
      .input(z.object({ title: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const res = await ctx.env.DB.prepare(`INSERT INTO chat_sessions (userId, twinId, title) VALUES (?,?,?)`).bind(ctx.userId, twin.id, input.title || "New Chat").run();
        return { id: Number(res.meta.last_row_id) };
      }),
    sendMessage: publicProcedure
      .input(z.object({ sessionId: z.number(), content: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Save user message
        await ctx.env.DB.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(input.sessionId, "user", input.content).run();
        // Phase 1: simple echo response (no LLM)
        const response = `[Phase 1] あなたのメッセージ「${input.content.slice(0, 50)}...」を受け取りました。LLM統合は次のフェーズで対応します。`;
        const res = await ctx.env.DB.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(input.sessionId, "assistant", response).run();
        await ctx.env.DB.prepare(`UPDATE chat_sessions SET updatedAt=datetime('now') WHERE id=?`).bind(input.sessionId).run();
        return { messageId: Number(res.meta.last_row_id), response };
      }),
  }),

  // ============ Matching ============
  matching: router({
    sessions: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE initiatorUserId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getSession: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.id).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
        const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
        const dialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.id).all<any>();
        const result = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.id).first<any>();
        return {
          session,
          twin1: normalizeTwin(twin1),
          twin2: normalizeTwin(twin2),
          dialogues: dialogues.results ?? [],
          result: result ? { ...result, scoreBreakdown: parseJson<any>(result.scoreBreakdown), strengths: parseJson<string[]>(result.strengths), challenges: parseJson<string[]>(result.challenges), recommendations: parseJson<string[]>(result.recommendations) } : null,
        };
      }),
    availableFriends: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      // Use friends.list logic but filter for those with twins
      const rows = await ctx.env.DB
        .prepare(`SELECT f.*, u.id as fId, u.name as fName FROM friendships f JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
        .bind(ctx.userId, ctx.userId, ctx.userId)
        .all<any>();
      const results = [];
      for (const r of rows.results ?? []) {
        const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(r.fId).first<any>();
        if (twin) {
          results.push({
            friendship: { id: r.id, status: r.status, createdAt: r.createdAt },
            friend: { id: r.fId, name: r.fName },
            twin: normalizeTwin(twin),
          });
        }
      }
      return results;
    }),
    create: publicProcedure
      .input(z.object({ friendId: z.number(), theme: z.string().min(1), turns: z.number().min(1).max(30).default(5) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
        if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIがありません" });
        const res = await ctx.env.DB.prepare(`INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status) VALUES (?,?,?,?,'completed')`).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme).run();
        const sessionId = Number(res.meta.last_row_id);
        // Phase 1: create placeholder dialogue
        await ctx.env.DB.prepare(`INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber) VALUES (?,?,?,?)`).bind(sessionId, myTwin.id, `[Phase 1] ${input.theme}についてお話しましょう`, 0).run();
        return { id: sessionId, dialogues: [] };
      }),
    runDialogue: publicProcedure
      .input(z.object({ sessionId: z.number(), turns: z.number().optional() }))
      .mutation(async () => ({ dialogues: [] })),
    analyze: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ compatibilityScore: 0, summary: "Phase 1: 分析機能は次のフェーズで実装", strengths: [], challenges: [], recommendations: [] })),
    exportReport: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async () => ({ html: "<p>Phase 1</p>" })),
    generatePresentation: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ slideContent: { markdown: "", slideCount: 0 }, slideCount: 0 })),
    generateNanoBananaSlides: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ slideContentFile: "", slideCount: 0, slides: [], theme: "", twin1Name: "", twin2Name: "", compatibilityScore: 0 })),
    exportPptx: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ base64: "", filename: "", url: undefined as string | undefined })),
  }),

  // ============ Points ============
  points: router({
    getBalance: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      return row ?? { balance: 0, totalEarned: 0, totalSpent: 0, totalExpired: 0 };
    }),
    getTransactions: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(`SELECT * FROM point_transactions WHERE userId=? ORDER BY createdAt DESC LIMIT ?`).bind(ctx.userId, input?.limit ?? 50).all<any>();
        return rows.results ?? [];
      }),
    getProducts: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM redeemable_products WHERE isActive=1 ORDER BY sortOrder`).all<any>();
      return rows.results ?? [];
    }),
    redeem: publicProcedure
      .input(z.object({ productId: z.number() }))
      .mutation(async () => ({ success: false, message: "Phase 1: ポイント交換は未対応" })),
    getRedemptions: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM point_redemptions WHERE userId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getSettings: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM point_settings ORDER BY category, actionType`).all<any>();
      return rows.results ?? [];
    }),
    updateSetting: publicProcedure
      .input(z.object({ actionType: z.string(), points: z.number().optional(), isActive: z.number().optional() }))
      .mutation(async () => ({ success: true })),
    redeemProduct: publicProcedure
      .input(z.object({ productId: z.number(), shippingInfo: z.record(z.string(), z.unknown()).optional() }))
      .mutation(async () => ({ success: false, message: "Phase 1: ポイント交換は未対応" })),
    getQuests: publicProcedure.query(async () => ({
      stats: { completedToday: 0, totalCompleted: 0, currentStreak: 0, totalPoints: 0 },
      categories: [] as { name: string; quests: any[] }[],
    })),
    checkDailyLogin: publicProcedure.mutation(async () => ({ points: 0, isFirstLogin: false, awarded: false, streak: 0, streakBonus: null as { name: string; points: number } | null })),
    checkMilestones: publicProcedure.mutation(async () => ({ milestones: [] as any[], newMilestones: [] as any[], awarded: [] as { name: string; points: number }[] })),
  }),

  // ============ Quests ============
  quests: router({
    list: publicProcedure.query(async () => []),
    checkDailyLogin: publicProcedure.mutation(async () => ({ points: 0, isFirstLogin: false })),
  }),

  // ============ Growth ============
  growth: router({
    getStatus: publicProcedure.query(async ({ ctx }) => {
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
    getSkillLevels: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).all<any>();
      return rows.results ?? [];
    }),
    setSkillLevel: publicProcedure
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
    setSkillLevels: publicProcedure
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
    getSkills: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).all<any>();
      return rows.results ?? [];
    }),
    areSkillsConfigured: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return false;
      const row = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).first<any>();
      return (row?.c ?? 0) > 0;
    }),
    getAvailableSkillPoints: publicProcedure
      .input(z.object({ isCampaign: z.boolean().optional() }).optional())
      .query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return 0;
      const status = await ctx.env.DB.prepare(`SELECT level FROM twin_growth_status WHERE twinId=?`).bind(twin.id).first<any>();
      return (status?.level ?? 1) * 3;
    }),
    getMilestones: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_milestones WHERE twinId=?`).bind(twin.id).all<any>();
      return rows.results ?? [];
    }),
  }),

  // ============ Cards ============
  cards: router({
    list: publicProcedure
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
        return (rows.results ?? []).map(r => ({ ...r, tags: parseJson<string[]>(r.tags) ?? [], ocrData: parseJson<any>(r.ocrData) }));
      }),
    create: publicProcedure
      .input(z.object({ cardType: z.string().optional(), name: z.string().optional(), title: z.string().optional(), company: z.string().optional(), position: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), address: z.string().optional(), website: z.string().optional(), imageUrl: z.string().optional(), frontImageUrl: z.string().optional(), frontImageKey: z.string().optional(), ocrData: z.any().optional(), extractedData: z.any().optional(), notes: z.string().optional(), tags: z.array(z.string()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const res = await ctx.env.DB.prepare(`INSERT INTO cards (userId, cardType, name, company, position, email, phone, address, website, imageUrl, ocrData, notes, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ctx.userId, input.cardType ?? "business_card", input.name ?? null, input.company ?? null, input.position ?? null, input.email ?? null, input.phone ?? null, input.address ?? null, input.website ?? null, input.imageUrl ?? null, toJson(input.ocrData), input.notes ?? null, toJson(input.tags)).run();
        return { id: Number(res.meta.last_row_id) };
      }),
    update: publicProcedure
      .input(z.object({ id: z.number(), name: z.string().optional(), title: z.string().optional(), company: z.string().optional(), position: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), notes: z.string().optional(), isFavorite: z.boolean().optional(), isArchived: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const sets: string[] = [];
        const binds: any[] = [];
        if (input.name !== undefined) { sets.push("name=?"); binds.push(input.name); }
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
    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const row = await ctx.env.DB.prepare(`SELECT * FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
        if (!row) return null;
        return { ...row, tags: parseJson<string[]>(row.tags) ?? [], ocrData: parseJson<any>(row.ocrData) };
      }),
    delete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
      return { success: true };
    }),
    toggleFavorite: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const card = await ctx.env.DB.prepare(`SELECT isFavorite FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
        if (!card) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.env.DB.prepare(`UPDATE cards SET isFavorite=?, updatedAt=datetime('now') WHERE id=?`).bind(card.isFavorite ? 0 : 1, input.id).run();
        return { success: true };
      }),
    toggleArchive: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const card = await ctx.env.DB.prepare(`SELECT isArchived FROM cards WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
        if (!card) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.env.DB.prepare(`UPDATE cards SET isArchived=?, updatedAt=datetime('now') WHERE id=?`).bind(card.isArchived ? 0 : 1, input.id).run();
        return { success: true };
      }),
    search: publicProcedure
      .input(z.object({ query: z.string(), cardType: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(`SELECT * FROM cards WHERE userId=? AND (name LIKE ? OR company LIKE ? OR email LIKE ?) ORDER BY createdAt DESC`).bind(ctx.userId, `%${input.query}%`, `%${input.query}%`, `%${input.query}%`).all<any>();
        return (rows.results ?? []).map((r: any) => ({ ...r, tags: parseJson<string[]>(r.tags) ?? [], ocrData: parseJson<any>(r.ocrData) }));
      }),
    uploadImage: publicProcedure
      .input(z.object({ id: z.number().optional(), imageData: z.string(), fileName: z.string().optional(), contentType: z.string().optional() }))
      .mutation(async () => ({ url: "", key: "", imageUrl: "", success: true })),
    analyzeImage: publicProcedure
      .input(z.object({ imageUrl: z.string(), cardType: z.string().optional() }))
      .mutation(async () => ({ extractedData: { name: null as string | null, company: null as string | null, position: null as string | null, email: null as string | null, phone: null as string | null, address: null as string | null, website: null as string | null, storeName: null as string | null, organizationName: null as string | null, hospitalName: null as string | null }, ocrData: null as any })),
    getStats: publicProcedure.query(async ({ ctx }) => {
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
  }),

  // ============ Clawdbot ============
  clawdbot: router({
    getConnection: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      return ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
    }),
    saveConnection: publicProcedure
      .input(z.object({ gatewayUrl: z.string(), authToken: z.string().optional(), agentId: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const existing = await ctx.env.DB.prepare(`SELECT id FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE clawdbot_connections SET gatewayUrl=?, authToken=?, agentId=?, updatedAt=datetime('now') WHERE id=?`).bind(input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main", existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO clawdbot_connections (userId, twinId, gatewayUrl, authToken, agentId) VALUES (?,?,?,?,?)`).bind(ctx.userId, twin.id, input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main").run();
        }
        return { success: true };
      }),
    testConnection: publicProcedure.mutation(async () => ({ success: true, message: "Phase 1: 接続テスト未対応" })),
    sendMessage: publicProcedure
      .input(z.object({ content: z.string().optional(), message: z.string().optional(), sessionKey: z.string().optional() }))
      .mutation(async () => ({ response: "Phase 1: Clawdbotメッセージ未対応", success: true, sessionKey: undefined as string | undefined, error: undefined as string | undefined })),
    getLearningStatus: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, learnedTraits: parseJson<any>(row.learnedTraits) };
    }),
    getMessageHistory: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async () => {
        return [] as any[];
      }),
    getModels: publicProcedure.query(async () => {
      return { success: true, models: [] as string[] };
    }),
    getLearnedTraits: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, learnedTraits: parseJson<any>(row.learnedTraits) };
    }),
    syncConversations: publicProcedure.mutation(async () => ({ success: true, synced: 0, message: "Phase 1: 会話同期は未対応" })),
    analyzePersonality: publicProcedure.mutation(async () => ({ success: true, analyzed: false, message: "Phase 1: 性格分析は未対応" })),
    updateLearningSettings: publicProcedure
      .input(z.object({ autoLearnEnabled: z.boolean().optional(), learningThreshold: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB.prepare(`SELECT id FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
        if (existing) {
          const sets: string[] = [];
          const binds: any[] = [];
          if (input.autoLearnEnabled !== undefined) { sets.push("autoLearnEnabled=?"); binds.push(input.autoLearnEnabled ? 1 : 0); }
          if (input.learningThreshold !== undefined) { sets.push("learningThreshold=?"); binds.push(input.learningThreshold); }
          if (sets.length > 0) {
            sets.push("updatedAt=datetime('now')");
            binds.push(existing.id);
            await ctx.env.DB.prepare(`UPDATE conversation_learning SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
          }
        }
        return { success: true };
      }),
    createConnection: publicProcedure
      .input(z.object({ gatewayUrl: z.string(), authToken: z.string().optional(), agentId: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        await ctx.env.DB.prepare(`INSERT INTO clawdbot_connections (userId, twinId, gatewayUrl, authToken, agentId) VALUES (?,?,?,?,?)`).bind(ctx.userId, twin.id, input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main").run();
        return { success: true };
      }),
    updateConnection: publicProcedure
      .input(z.object({ gatewayUrl: z.string().optional(), authToken: z.string().optional(), agentId: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const sets: string[] = [];
        const binds: any[] = [];
        if (input.gatewayUrl !== undefined) { sets.push("gatewayUrl=?"); binds.push(input.gatewayUrl); }
        if (input.authToken !== undefined) { sets.push("authToken=?"); binds.push(input.authToken); }
        if (input.agentId !== undefined) { sets.push("agentId=?"); binds.push(input.agentId); }
        if (sets.length > 0) {
          sets.push("updatedAt=datetime('now')");
          binds.push(ctx.userId);
          await ctx.env.DB.prepare(`UPDATE clawdbot_connections SET ${sets.join(",")} WHERE userId=?`).bind(...binds).run();
        }
        return { success: true };
      }),
    deleteConnection: publicProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).run();
      return { success: true };
    }),
  }),

  // ============ LINE ============
  line: router({
    getConnection: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, settings: parseJson<any>(row.settings) };
    }),
    linkByCode: publicProcedure
      .input(z.object({ code: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Find connection with matching link code
        const conn = await ctx.env.DB
          .prepare(`SELECT * FROM line_connections WHERE json_extract(settings, '$.linkCode')=?`)
          .bind(input.code.toUpperCase())
          .first<any>();
        if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "コードが見つかりません" });
        // Link to current user
        await ctx.env.DB
          .prepare(`UPDATE line_connections SET userId=?, status='active', connectedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?`)
          .bind(ctx.userId, conn.id)
          .run();
        return { success: true };
      }),
    disconnect: publicProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE line_connections SET status='disconnected', disconnectedAt=datetime('now'), updatedAt=datetime('now') WHERE userId=?`).bind(ctx.userId).run();
      return { success: true };
    }),
    updateSettings: publicProcedure
      .input(z.record(z.string(), z.unknown()))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Merge with existing settings
        const conn = await ctx.env.DB.prepare(`SELECT settings FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
        const existing = conn ? (parseJson<any>(conn.settings) ?? {}) : {};
        const merged = { ...existing, ...input };
        await ctx.env.DB.prepare(`UPDATE line_connections SET settings=?, updatedAt=datetime('now') WHERE userId=?`).bind(toJson(merged), ctx.userId).run();
        return { success: true };
      }),
    toggleStatus: publicProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .mutation(async ({ ctx }) => {
        await ensureSchema(ctx.env.DB);
        const conn = await ctx.env.DB.prepare(`SELECT status FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
        if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
        const newStatus = conn.status === "active" ? "paused" : "active";
        await ctx.env.DB.prepare(`UPDATE line_connections SET status=?, updatedAt=datetime('now') WHERE userId=?`).bind(newStatus, ctx.userId).run();
        return { success: true, status: newStatus };
      }),
    getMessageHistory: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async () => {
        return [] as any[];
      }),
  }),

  // ============ Plan ============
  plan: router({
    getCurrent: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return { plan: user?.plan ?? "free" };
    }),
    getInfo: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return { plan: user?.plan ?? "free", limits: { maxFriends: 5, maxMatchingsPerMonth: 3 } };
    }),
    getStats: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const friends = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`).bind(ctx.userId, ctx.userId).first<any>();
      const matchings = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId=?`).bind(ctx.userId).first<any>();
      const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return {
        friendCount: friends?.c ?? 0,
        matchingCount: matchings?.c ?? 0,
        plan: user?.plan ?? "free",
        usage: { friends: friends?.c ?? 0, matchingsThisMonth: matchings?.c ?? 0, knowledgeEntries: 0, fileUploads: 0, friendCount: friends?.c ?? 0, matchingCount: matchings?.c ?? 0 },
        limits: { maxFriends: 5, maxMatchingsPerMonth: 3, maxKnowledge: 50, maxKnowledgeEntries: 50, maxFileUploads: 10 },
      };
    }),
    getSubscription: publicProcedure.query(async () => null as { cancelAtPeriodEnd: boolean; currentPeriodEnd: string } | null),
    createCheckoutSession: publicProcedure
      .input(z.object({ planId: z.string().optional(), plan: z.string().optional(), billingCycle: z.string().optional(), interval: z.string().optional() }))
      .mutation(async () => ({ url: undefined as string | undefined, message: "Phase 1: Stripe未対応" })),
    createPortalSession: publicProcedure.mutation(async () => ({ url: undefined as string | undefined })),
    getFriendCode: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      let user = await ctx.env.DB.prepare(`SELECT friendCode FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.friendCode) {
        const code = generateCode(8);
        await ctx.env.DB.prepare(`UPDATE users SET friendCode=? WHERE id=?`).bind(code, ctx.userId).run();
        user = { friendCode: code };
      }
      return { friendCode: user.friendCode };
    }),
    getUsage: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const usage = await ctx.env.DB.prepare(`SELECT * FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
      return usage ?? { matchingsThisMonth: 0 };
    }),
  }),

  // ============ Stripe (stubs) ============
  stripe: router({
    createCheckoutSession: publicProcedure
      .input(z.object({ planId: z.string() }))
      .mutation(async () => ({ url: undefined as string | undefined, message: "Phase 1: Stripe未対応" })),
    getSubscription: publicProcedure.query(async () => null as { cancelAtPeriodEnd: boolean; currentPeriodEnd: string } | null),
  }),

  // ============ Discover ============
  discover: router({
    search: publicProcedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(async ({ ctx }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE isPublic=1 AND userId!=? LIMIT 20`).bind(ctx.userId).all<any>();
        return (rows.results ?? []).map(normalizeTwin);
      }),
  }),

  // ============ User (friend code etc) ============
  user: router({
    getFriendCode: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      let user = await ctx.env.DB.prepare(`SELECT friendCode FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.friendCode) {
        const code = generateCode(8);
        await ctx.env.DB.prepare(`UPDATE users SET friendCode=? WHERE id=?`).bind(code, ctx.userId).run();
        user = { friendCode: code };
      }
      return { friendCode: user.friendCode };
    }),
    getStats: publicProcedure.query(async ({ ctx }) => {
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
  }),

  // ============ AI Provider (alias used by frontend) ============
  aiProvider: router({
    getSettings: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM ai_provider_settings WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getAvailableProviders: publicProcedure.query(async () => {
      return [
        { id: "openai", provider: "openai", name: "OpenAI", available: true, models: ["gpt-4o", "gpt-4o-mini"] },
        { id: "gemini", provider: "gemini", name: "Gemini", available: true, models: ["gemini-2.0-flash", "gemini-1.5-pro"] },
        { id: "anthropic", provider: "anthropic", name: "Anthropic", available: true, models: ["claude-sonnet-4-20250514"] },
        { id: "grok", provider: "grok", name: "Grok", available: true, models: ["grok-2"] },
      ];
    }),
    testProvider: publicProcedure
      .input(z.object({ provider: z.string(), model: z.string().optional() }))
      .mutation(async () => ({ success: true, error: null as string | null, message: "Phase 1: プロバイダーテスト未対応", latency: 0 })),
    updateSetting: publicProcedure
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
  }),

  // ============ Admin AI Provider ============
  adminAiProvider: router({
    getSettings: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM ai_provider_settings WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    updateSetting: publicProcedure
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
  }),
});

export type AppRouter = typeof appRouter;

// ============ Hono App ============

const api = new Hono<{ Bindings: Env }>();

api.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

api.get("/", (c) => c.json({ message: "Bunshin AI API v2. Use /api/* endpoints." }));
api.get("/api/health", (c) => c.json({ ok: true }));

api.all("/api/trpc/*", (c) => {
  // Phase 1: no auth; single user.
  const userId = 1;

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ env: c.env as Env, userId }),
  });
});

export default api;
