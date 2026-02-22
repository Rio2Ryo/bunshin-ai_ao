import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import superjson from "superjson";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { SignJWT, jwtVerify } from "jose";
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
import { invokeLLM, getUserLLMConfig } from "./llm";

// ============ Types ============

type Env = {
  DB: D1Database;
  ASSETS?: R2Bucket;
  JWT_SECRET?: string;
  AZURE_FOUNDRY_API_KEY?: string;
  AZURE_FOUNDRY_RESOURCE?: string;
};

type Context = {
  env: Env;
  userId: number;
  user: { id: number; openId: string; name: string | null; email: string | null; role: string } | null;
};

// ============ Auth Helpers ============

const COOKIE_NAME = "app_session_id";
const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

function getJwtSecret(env: Env): Uint8Array {
  const secret = env.JWT_SECRET || "bunshin-ai-dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

async function hashPassword(password: string): Promise<string> {
  // Use PBKDF2 via Web Crypto (available in CF Workers)
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  // Store as salt:hash in hex
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  const computedHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  return computedHex === hashHex;
}

async function createSessionToken(userId: number, env: Env): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .setIssuedAt()
    .sign(getJwtSecret(env));
}

async function verifySessionToken(token: string, env: Env): Promise<{ userId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    if (typeof payload.userId === "number") return { userId: payload.userId };
    return null;
  } catch {
    return null;
  }
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ============ tRPC Setup ============

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const router = t.router;
const publicProcedure = t.procedure;
const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "ログインが必要です" });
  }
  return next({ ctx: { ...ctx, user: ctx.user, userId: ctx.user.id } });
});

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
    register: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Check if email already exists
        const existing = await ctx.env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(input.email).first<any>();
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "このメールアドレスは既に登録されています" });
        const passwordHash = await hashPassword(input.password);
        const openId = `email_${input.email}`;
        await ctx.env.DB.prepare(
          `INSERT INTO users (openId, name, email, passwordHash, loginMethod, role, plan) VALUES (?,?,?,?,?,?,?)`
        ).bind(openId, input.name, input.email, passwordHash, "email", "user", "free").run();
        const user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE email=?`).bind(input.email).first<any>();
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ユーザー作成に失敗しました" });

        // Auto-create default Twin
        const twinName = `${input.name}の分身AI`;
        const onboardingSystemPrompt = `あなたはオンボーディングガイドです。ユーザーの情報を会話で収集し、分身AIプロフィールを構築します。

ステップ: 1.仕事・スキル → 2.経験・実績 → 3.趣味・興味 → 4.性格・価値観 → 5.まとめ確認

ルール:
- 各ステップ1-2問だけ聞いて次へ進む
- 応答は200文字以内で短くフレンドリーに
- ユーザーの回答が短くてもポジティブに受けて次へ
- 考えすぎず直接応答する

Step 5完了時に以下を出力:
---PROFILE_DATA---
{"description": "概要", "personality": "性格", "rawInput": "全情報まとめ"}
---END_PROFILE_DATA---`;

        const twinRes = await ctx.env.DB.prepare(
          `INSERT INTO digital_twins (userId, name, systemPrompt, status, updatedAt) VALUES (?, ?, ?, 'active', datetime('now'))`
        ).bind(user.id, twinName, onboardingSystemPrompt).run();
        const twinId = Number(twinRes.meta.last_row_id);

        // Create onboarding chat session
        const sessionRes = await ctx.env.DB.prepare(
          `INSERT INTO chat_sessions (userId, twinId, title, mode) VALUES (?, ?, ?, ?)`
        ).bind(user.id, twinId, "はじめてのチャット", "onboarding").run();
        const onboardingSessionId = Number(sessionRes.meta.last_row_id);

        // Insert welcome message
        const welcomeMessage = `はじめまして！私はあなた専用の分身AI「${twinName}」です。

これから私があなたのことを学んで、あなたの「デジタル分身」になっていきます。

まずは自己紹介から始めましょう！

あなたのお仕事や得意なことを教えてください。
例えば「マーケティング10年やってます」「デザインが得意です」など、なんでもOKです！`;

        await ctx.env.DB.prepare(
          `INSERT INTO chat_messages (sessionId, role, content) VALUES (?, ?, ?)`
        ).bind(onboardingSessionId, "assistant", welcomeMessage).run();

        const token = await createSessionToken(user.id, ctx.env);
        return {
          user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan },
          token,
          onboardingSessionId,
        };
      }),
    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE email=?`).bind(input.email).first<any>();
        if (!user || !user.passwordHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "メールアドレスまたはパスワードが正しくありません" });
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "メールアドレスまたはパスワードが正しくありません" });
        await ctx.env.DB.prepare(`UPDATE users SET lastSignedIn=datetime('now') WHERE id=?`).bind(user.id).run();
        const token = await createSessionToken(user.id, ctx.env);
        return { user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, onboardingCompleted: user.onboardingCompleted ?? 0 }, token };
      }),
    me: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (ctx.user) {
        const row = await ctx.env.DB.prepare(`SELECT onboardingCompleted FROM users WHERE id=?`).bind(ctx.user.id).first<any>();
        return { ...ctx.user, onboardingCompleted: row?.onboardingCompleted ?? 0 };
      }
      // Not logged in
      return null;
    }),
    logout: publicProcedure.mutation(() => ({ success: true })),
  }),

  // ============ Profile ============
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
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
    update: protectedProcedure
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
    get: protectedProcedure.query(async ({ ctx }) => {
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

    upsert: protectedProcedure
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

    update: protectedProcedure
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

    updatePublicSettings: protectedProcedure
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

    reset: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM digital_twins WHERE userId = ?`).bind(ctx.userId).run();
      return { ok: true };
    }),

    // Personality & Waveform stubs (Phase 1 - return ok)
    analyzeBigFive: protectedProcedure.mutation(async () => ({ bigFiveTraits: null })),
    analyzeJudgmentThresholds: protectedProcedure.mutation(async () => ({ judgmentThresholds: null })),
    generateSelfWaveform: protectedProcedure.mutation(async () => ({ ok: true })),
    evaluateWaveform: protectedProcedure.mutation(async () => ({ ok: true })),
    reevaluateAndUpdateWaveform: protectedProcedure.mutation(async () => ({ success: true, evaluatedCount: 0, totalResponses: 0 })),
    refreshCumulativeWaveform: protectedProcedure.mutation(async () => ({ success: true })),
    evaluateByAllTwins: protectedProcedure.mutation(async () => ({ success: true, evaluatedCount: 0, totalResponses: 0, totalEvaluators: 0, totalEvaluations: 0 })),
    calculateAccuracy: protectedProcedure.mutation(async () => ({ personalitySimilarity: 0, accuracyScore: 0 })),
    runFullAnalysis: protectedProcedure.mutation(async () => ({ ok: true })),
    runIntegratedAnalysis: protectedProcedure.mutation(async () => ({ ok: true })),
    personalityInterview: protectedProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async () => ({ message: "Phase 1ではこの機能は使えません", question: "Phase 1ではこの機能は使えません", isComplete: false, traits: null as { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number } | null })),
    mbtiInterview: protectedProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async () => ({ message: "Phase 1ではこの機能は使えません", question: "Phase 1ではこの機能は使えません", isComplete: false, mbtiType: null as any })),
    valueScenarioInterview: protectedProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async () => ({ message: "Phase 1ではこの機能は使えません", response: "Phase 1ではこの機能は使えません", isComplete: false, currentScenarioIndex: 0, totalScenarios: 18 })),
    getScenarioProgress: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { completed: 0, total: 18 };
      const r = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM value_scenario_responses WHERE userId=? AND twinId=?`).bind(ctx.userId, twin.id).first<any>();
      return { completed: r?.c ?? 0, total: 18 };
    }),
    getCumulativeWaveform: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return null;
      return getCumulativeWaveform(ctx.env.DB, ctx.userId, twin.id);
    }),
    getAvailableScenarios: protectedProcedure.query(async () => ({ scenarios: [], categories: [] })),
    searchPublic: protectedProcedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(async ({ ctx }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB
          .prepare(`SELECT * FROM digital_twins WHERE isPublic=1 AND userId != ? LIMIT 20`)
          .bind(ctx.userId)
          .all<any>();
        const results = [];
        for (const row of rows.results ?? []) {
          const user = await ctx.env.DB.prepare(`SELECT * FROM users WHERE id=?`).bind(row.userId).first<any>();
          results.push({ twin: normalizeTwin(row), user });
        }
        return results;
      }),
    getPublicTwin: protectedProcedure
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
    list: protectedProcedure.query(async ({ ctx }) => {
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
    pendingRequests: protectedProcedure.query(async ({ ctx }) => {
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
    sentRequests: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB
        .prepare(`SELECT f.*, u.name as recipientName FROM friendships f JOIN users u ON u.id=f.friendId WHERE f.userId=? AND f.status='pending'`)
        .bind(ctx.userId)
        .all<any>();
      return (rows.results ?? []).map(r => ({ id: r.id, friendId: r.friendId, recipientName: r.recipientName, createdAt: r.createdAt }));
    }),
    searchUsers: protectedProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB
          .prepare(`SELECT id, name, email, friendCode FROM users WHERE id!=? AND (name LIKE ? OR friendCode=?) LIMIT 20`)
          .bind(ctx.userId, `%${input.query}%`, input.query.toUpperCase())
          .all<any>();
        return rows.results ?? [];
      }),
    sendRequest: protectedProcedure
      .input(z.object({ friendCode: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const friend = await ctx.env.DB.prepare(`SELECT * FROM users WHERE friendCode=?`).bind(input.friendCode.toUpperCase()).first<any>();
        if (!friend) throw new TRPCError({ code: "NOT_FOUND", message: "ユーザーが見つかりません" });
        if (friend.id === ctx.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分にはリクエストを送れません" });
        const res = await ctx.env.DB.prepare(`INSERT INTO friendships (userId, friendId, status) VALUES (?,?,'pending')`).bind(ctx.userId, friend.id).run();
        return { id: Number(res.meta.last_row_id) };
      }),
    acceptRequest: protectedProcedure
      .input(z.object({ requestId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE friendships SET status='accepted', updatedAt=datetime('now') WHERE id=? AND friendId=?`).bind(input.requestId, ctx.userId).run();
        return { success: true };
      }),
    rejectRequest: protectedProcedure
      .input(z.object({ requestId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE friendships SET status='rejected', updatedAt=datetime('now') WHERE id=? AND friendId=?`).bind(input.requestId, ctx.userId).run();
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`DELETE FROM friendships WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)`).bind(ctx.userId, input.friendId, input.friendId, ctx.userId).run();
        return { success: true };
      }),
    getWaveformCompatibility: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async () => ({ hasData: false, message: "Phase 1: 波形比較は未対応", compatibility: null })),
    getIntimacy: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async () => ({ intimacyScore: 0, intimacyLevel: "stranger" as const, intimacyLevelLabel: "見知らぬ人", predictionAccuracy: null })),
    updateIntimacy: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async () => ({ intimacyScore: 0, intimacyLevel: "stranger" as const, intimacyLevelLabel: "見知らぬ人" })),
    getAllIntimacyScores: protectedProcedure.query(async () => []),
    requestPredictions: protectedProcedure
      .input(z.object({ scenarioId: z.string(), scenarioText: z.string(), friendUserIds: z.array(z.number()) }))
      .mutation(async () => ({ predictionIds: [], count: 0 })),
    updateOtherPerspectiveWaveform: protectedProcedure.mutation(async () => ({ success: true, selfReportGap: null })),
    generateFriendPredictions: protectedProcedure.mutation(async () => ({ success: true, friendsProcessed: 0, successfulPredictions: 0, totalPredictions: 0 })),
    getAllWaveformCompatibilities: protectedProcedure.query(async () => ({ hasMyWaveform: false, message: "波形が未生成です", compatibilities: [] as { friendId: number; overallCompatibility: number; waveformSimilarity: number; virtueCompatibility: number; mineCompatibility: number }[] })),
  }),

  // ============ Knowledge Base ============
  knowledge: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC`).bind(twin.id).all<any>();
      return (rows.results ?? []).map(r => ({ ...r, metadata: parseJson<any>(r.metadata) }));
    }),
    add: protectedProcedure
      .input(z.object({ sourceType: z.enum(["upload", "api", "manual"]), sourceId: z.string().optional(), title: z.string().optional(), content: z.string().optional(), summary: z.string().optional(), metadata: z.record(z.string(), z.unknown()).optional() }))
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
        await ctx.env.DB.prepare(`DELETE FROM knowledge_base WHERE id=?`).bind(input.id).run();
        return { success: true };
      }),
  }),

  // ============ Files ============
  files: router({
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
  }),

  // ============ AI Config ============
  aiConfig: router({
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
  }),

  // ============ Orchestration ============
  orchestration: router({
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
      .mutation(async () => ({ success: true })),
  }),

  // ============ Chat ============
  chat: router({
    sessions: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE userId=? ORDER BY updatedAt DESC`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getSession: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const session = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        const msgs = await ctx.env.DB.prepare(`SELECT * FROM chat_messages WHERE sessionId=? ORDER BY createdAt ASC`).bind(input.id).all<any>();
        return { session, messages: (msgs.results ?? []).map(m => ({ ...m, metadata: parseJson<any>(m.metadata) })) };
      }),
    createSession: protectedProcedure
      .input(z.object({ title: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const res = await ctx.env.DB.prepare(`INSERT INTO chat_sessions (userId, twinId, title) VALUES (?,?,?)`).bind(ctx.userId, twin.id, input.title || "New Chat").run();
        return { id: Number(res.meta.last_row_id) };
      }),
    sendMessage: protectedProcedure
      .input(z.object({ sessionId: z.number(), content: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Save user message
        await ctx.env.DB.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(input.sessionId, "user", input.content).run();

        // Build context: get twin info, conversation history, and LLM config
        const session = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "チャットセッションが見つかりません" });

        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);

        let response: string;

        if (!llmConfig && session.mode === "onboarding") {
          // Onboarding without LLM: provide scripted fallback responses
          const userMsgCount = (await ctx.env.DB.prepare(
            `SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=? AND role='user'`
          ).bind(input.sessionId).first<any>())?.c ?? 0;
          const fallbackResponses = [
            `ありがとうございます！いい感じですね。\n\n次に、これまでの経験や実績について教えてください。\n例えば「3年間チームリーダーをしていました」「売上を2倍に伸ばしました」など。`,
            `素晴らしいですね！\n\nでは、趣味や興味のあることを教えてください。\n仕事以外でも構いません！`,
            `なるほど！とても多彩ですね。\n\nでは最後に、あなたの性格や大切にしている価値観を教えてください。\n例えば「チームワークを大切にしている」「新しいことに挑戦するのが好き」など。`,
            `ありがとうございます！あなたのことがよく分かりました。\n\n以下の内容であなたの分身AIプロフィールを作成しますね。\n\n---PROFILE_DATA---\n{"description": "多才なプロフェッショナル", "personality": "前向きで協調性がある", "rawInput": "${input.content}"}\n---END_PROFILE_DATA---`,
          ];
          response = fallbackResponses[Math.min(userMsgCount - 1, fallbackResponses.length - 1)] || fallbackResponses[fallbackResponses.length - 1];
        } else if (!llmConfig) {
          response = `AI APIキーが設定されていません。「AI API設定」ページでAPIキー（OpenAI、Gemini、Anthropic等）を登録してください。\n\nあなたのメッセージ: ${input.content}`;
        } else {
          // Check if session is onboarding mode - use twin's systemPrompt directly
          const isOnboarding = session.mode === "onboarding";

          // Build system prompt from twin data
          const twinName = twin?.name || "分身AI";
          let systemPrompt: string;

          if (isOnboarding && twin?.systemPrompt) {
            systemPrompt = twin.systemPrompt;
          } else {
            const twinDesc = twin?.description || "";
            const twinPersonality = twin?.personality || "";
            const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

            systemPrompt = `あなたは「${twinName}」というデジタル分身AIです。ユーザーの代わりに会話します。`;
            if (twinDesc) systemPrompt += `\n\n分身AIの説明: ${twinDesc}`;
            if (twinPersonality) systemPrompt += `\n\n性格特性: ${twinPersonality}`;
            if (profile?.bio) systemPrompt += `\n\nユーザーの自己紹介: ${profile.bio}`;
            if (profile?.skills) {
              const skills = parseJson<string[]>(profile.skills);
              if (skills?.length) systemPrompt += `\n\nスキル: ${skills.join(", ")}`;
            }
            if (profile?.industry) systemPrompt += `\n\n業界: ${profile.industry}`;
            systemPrompt += `\n\n丁寧かつ親しみやすい日本語で回答してください。ユーザーの専門知識を反映した回答を心がけてください。`;
          }

          // Get conversation history (last 20 messages)
          const history = await ctx.env.DB.prepare(
            `SELECT role, content FROM chat_messages WHERE sessionId=? ORDER BY createdAt DESC LIMIT 20`
          ).bind(input.sessionId).all<any>();

          const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
            { role: "system", content: systemPrompt },
            ...(history.results ?? []).reverse().map((m: any) => ({
              role: m.role as "user" | "assistant",
              content: m.content as string,
            })),
          ];

          try {
            const llmMaxTokens = isOnboarding ? 512 : 2048;
            const result = await invokeLLM(llmConfig, messages, { maxTokens: llmMaxTokens });
            response = result.content;
          } catch (error: any) {
            response = `AIの応答生成中にエラーが発生しました: ${error.message}\n\nAPIキーが正しいか、利用制限に達していないか確認してください。`;
          }
        }

        const res = await ctx.env.DB.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(input.sessionId, "assistant", response).run();
        await ctx.env.DB.prepare(`UPDATE chat_sessions SET updatedAt=datetime('now') WHERE id=?`).bind(input.sessionId).run();
        return { messageId: Number(res.meta.last_row_id), response };
      }),
  }),

  // ============ Matching ============
  matching: router({
    sessions: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE initiatorUserId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
      const results = [];
      for (const session of rows.results ?? []) {
        const twin1 = await ctx.env.DB.prepare(`SELECT id, name FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
        const twin2 = await ctx.env.DB.prepare(`SELECT id, name FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
        results.push({ ...session, twin1: twin1 ?? { id: session.twin1Id, name: `Twin #${session.twin1Id}` }, twin2: twin2 ?? { id: session.twin2Id, name: `Twin #${session.twin2Id}` } });
      }
      return results;
    }),
    getSession: protectedProcedure
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
    availableFriends: protectedProcedure.query(async ({ ctx }) => {
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
    create: protectedProcedure
      .input(z.object({ friendId: z.number(), theme: z.string().min(1), turns: z.number().min(1).max(30).default(5) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
        if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIがありません" });

        // Create session in 'running' status
        const sessionRes = await ctx.env.DB.prepare(
          `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status) VALUES (?,?,?,?,'running')`
        ).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme).run();
        const sessionId = Number(sessionRes.meta.last_row_id);

        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
        if (!llmConfig) {
          // No LLM config - insert placeholder and mark completed
          await ctx.env.DB.prepare(`INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber) VALUES (?,?,?,?)`)
            .bind(sessionId, myTwin.id, `AI APIキーが未設定のため、対話を生成できません。「AI API設定」でキーを登録してください。`, 0).run();
          await ctx.env.DB.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
          return { id: sessionId, dialogues: [] };
        }

        // Generate real dialogue between twins
        const twins = [
          { id: myTwin.id, name: myTwin.name, desc: myTwin.description || "", personality: myTwin.personality || "" },
          { id: friendTwin.id, name: normalizeTwin(friendTwin)?.name || "Twin", desc: friendTwin.description || "", personality: friendTwin.personality || "" },
        ];
        const dialogueHistory: { speaker: string; content: string }[] = [];
        const turnsToRun = Math.min(input.turns, 10);

        for (let turn = 0; turn < turnsToRun; turn++) {
          const speakerIdx = turn % 2;
          const speaker = twins[speakerIdx];
          const other = twins[1 - speakerIdx];

          const systemPrompt = `あなたは「${speaker.name}」というデジタル分身AIです。${speaker.desc ? `説明: ${speaker.desc}。` : ""}${speaker.personality ? `性格: ${speaker.personality}。` : ""}
テーマ「${input.theme}」について「${other.name}」と建設的なビジネス対話をしています。
相手の意見を尊重しつつ、自分の専門性や経験に基づいた具体的な提案や考えを述べてください。
簡潔で具体的な発言（150〜300文字程度）をしてください。`;

          const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
            { role: "system", content: systemPrompt },
          ];
          // Add dialogue history as context
          for (const d of dialogueHistory) {
            messages.push({
              role: d.speaker === speaker.name ? "assistant" : "user",
              content: `${d.speaker}: ${d.content}`,
            });
          }
          if (turn === 0) {
            messages.push({ role: "user", content: `テーマ「${input.theme}」について話し始めてください。` });
          }

          try {
            const result = await invokeLLM(llmConfig, messages, { maxTokens: 512, temperature: 0.8 });
            const content = result.content.replace(new RegExp(`^${speaker.name}:\\s*`, "i"), "");
            dialogueHistory.push({ speaker: speaker.name, content });
            await ctx.env.DB.prepare(
              `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES (?,?,?,?,?,?)`
            ).bind(sessionId, speaker.id, content, turn, result.provider, result.model).run();
          } catch (error: any) {
            await ctx.env.DB.prepare(
              `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber) VALUES (?,?,?,?)`
            ).bind(sessionId, speaker.id, `[対話生成エラー: ${error.message}]`, turn).run();
            break;
          }
        }

        // Run analysis after dialogue
        try {
          const analysisPrompt = `以下は「${twins[0].name}」と「${twins[1].name}」のビジネスマッチング対話です。テーマ: ${input.theme}

${dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n")}

以下のJSON形式で分析結果を返してください（日本語で）:
{
  "compatibilityScore": (0-100の数値),
  "summary": "(総合評価の要約)",
  "collaborationPotential": "(協業可能性の詳細な説明)",
  "strengths": ["強み1", "強み2", "強み3"],
  "challenges": ["課題1", "課題2"],
  "recommendations": ["提案1", "提案2", "提案3"],
  "scoreBreakdown": {
    "skillMatch": {"score": (0-20), "reason": "理由"},
    "valueAlignment": {"score": (0-20), "reason": "理由"},
    "communicationStyle": {"score": (0-20), "reason": "理由"},
    "businessGoalFit": {"score": (0-20), "reason": "理由"},
    "complementaryStrengths": {"score": (0-20), "reason": "理由"}
  },
  "detailedAnalysis": "(詳細分析のマークダウン)",
  "roleDistribution": "(役割分担の提案マークダウン)",
  "timeline": "(タイムライン提案のマークダウン)",
  "resources": "(必要リソースのマークダウン)",
  "kpis": "(期待成果・KPIのマークダウン)",
  "nextSteps": "(明日からできるアクションのマークダウン)"
}

JSONのみ出力し、他の説明は不要です。`;

          const analysisResult = await invokeLLM(llmConfig, [
            { role: "system", content: "あなたはビジネスマッチングの専門アナリストです。" },
            { role: "user", content: analysisPrompt },
          ], { maxTokens: 4096, temperature: 0.5 });

          // Parse JSON from response
          let analysis: any;
          try {
            const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
            analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          } catch { analysis = null; }

          if (analysis) {
            await ctx.env.DB.prepare(
              `INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
            ).bind(
              sessionId,
              analysis.compatibilityScore ?? 50,
              toJson(analysis.scoreBreakdown),
              analysis.collaborationPotential ?? "",
              toJson(analysis.strengths),
              toJson(analysis.challenges),
              toJson(analysis.recommendations),
              analysis.summary ?? "",
              analysis.detailedAnalysis ?? "",
              analysis.roleDistribution ?? "",
              analysis.timeline ?? "",
              analysis.resources ?? "",
              analysis.kpis ?? "",
              analysis.nextSteps ?? "",
            ).run();
          }
        } catch {
          // Analysis failed, session still has dialogues
        }

        await ctx.env.DB.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
        return { id: sessionId, dialogues: dialogueHistory };
      }),
    runDialogue: protectedProcedure
      .input(z.object({ sessionId: z.number(), turns: z.number().optional() }))
      .mutation(async () => ({ dialogues: [] })),
    analyze: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ compatibilityScore: 0, summary: "分析にはマッチング対話の生成が必要です", strengths: [], challenges: [], recommendations: [] })),
    exportReport: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async () => ({ html: "<p>Phase 1</p>" })),
    generatePresentation: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ slideContent: { markdown: "", slideCount: 0 }, slideCount: 0 })),
    generateNanoBananaSlides: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ slideContentFile: "", slideCount: 0, slides: [], theme: "", twin1Name: "", twin2Name: "", compatibilityScore: 0 })),
    exportPptx: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async () => ({ base64: "", filename: "", url: undefined as string | undefined })),
  }),

  // ============ Points ============
  points: router({
    getBalance: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      return row ?? { balance: 0, totalEarned: 0, totalSpent: 0, totalExpired: 0 };
    }),
    getTransactions: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(`SELECT * FROM point_transactions WHERE userId=? ORDER BY createdAt DESC LIMIT ?`).bind(ctx.userId, input?.limit ?? 50).all<any>();
        return rows.results ?? [];
      }),
    getProducts: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM redeemable_products WHERE isActive=1 ORDER BY sortOrder`).all<any>();
      return rows.results ?? [];
    }),
    redeem: protectedProcedure
      .input(z.object({ productId: z.number() }))
      .mutation(async () => ({ success: false, message: "Phase 1: ポイント交換は未対応" })),
    getRedemptions: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM point_redemptions WHERE userId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM point_settings ORDER BY category, actionType`).all<any>();
      return rows.results ?? [];
    }),
    updateSetting: protectedProcedure
      .input(z.object({ actionType: z.string(), points: z.number().optional(), isActive: z.number().optional() }))
      .mutation(async () => ({ success: true })),
    redeemProduct: protectedProcedure
      .input(z.object({ productId: z.number(), shippingInfo: z.record(z.string(), z.unknown()).optional() }))
      .mutation(async () => ({ success: false, message: "Phase 1: ポイント交換は未対応" })),
    getQuests: protectedProcedure.query(async () => ({
      stats: { completedToday: 0, totalCompleted: 0, currentStreak: 0, totalPoints: 0 },
      categories: [] as { name: string; quests: any[] }[],
    })),
    checkDailyLogin: protectedProcedure.mutation(async () => ({ points: 0, isFirstLogin: false, awarded: false, streak: 0, streakBonus: null as { name: string; points: number } | null })),
    checkMilestones: protectedProcedure.mutation(async () => ({ milestones: [] as any[], newMilestones: [] as any[], awarded: [] as { name: string; points: number }[] })),
  }),

  // ============ Quests ============
  quests: router({
    list: protectedProcedure.query(async () => []),
    checkDailyLogin: protectedProcedure.mutation(async () => ({ points: 0, isFirstLogin: false })),
  }),

  // ============ Growth ============
  growth: router({
    getStatus: protectedProcedure.query(async ({ ctx }) => {
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
    getSkillLevels: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).all<any>();
      return rows.results ?? [];
    }),
    setSkillLevel: protectedProcedure
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
    setSkillLevels: protectedProcedure
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
    getSkills: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).all<any>();
      return rows.results ?? [];
    }),
    areSkillsConfigured: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return false;
      const row = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM twin_skill_levels WHERE twinId=?`).bind(twin.id).first<any>();
      return (row?.c ?? 0) > 0;
    }),
    getAvailableSkillPoints: protectedProcedure
      .input(z.object({ isCampaign: z.boolean().optional() }).optional())
      .query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return 0;
      const status = await ctx.env.DB.prepare(`SELECT level FROM twin_growth_status WHERE twinId=?`).bind(twin.id).first<any>();
      return (status?.level ?? 1) * 3;
    }),
    getMilestones: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      const rows = await ctx.env.DB.prepare(`SELECT * FROM twin_milestones WHERE twinId=?`).bind(twin.id).all<any>();
      return rows.results ?? [];
    }),
  }),

  // ============ Cards ============
  cards: router({
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
              imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
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
  }),

  // ============ Clawdbot ============
  clawdbot: router({
    getConnection: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      return ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
    }),
    saveConnection: protectedProcedure
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
    testConnection: protectedProcedure.mutation(async () => ({ success: true, message: "Phase 1: 接続テスト未対応" })),
    sendMessage: protectedProcedure
      .input(z.object({ content: z.string().optional(), message: z.string().optional(), sessionKey: z.string().optional() }))
      .mutation(async () => ({ response: "Phase 1: Clawdbotメッセージ未対応", success: true, sessionKey: undefined as string | undefined, error: undefined as string | undefined })),
    getLearningStatus: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, learnedTraits: parseJson<any>(row.learnedTraits) };
    }),
    getMessageHistory: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async () => {
        return [] as any[];
      }),
    getModels: protectedProcedure.query(async () => {
      return { success: true, models: [] as string[] };
    }),
    getLearnedTraits: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, learnedTraits: parseJson<any>(row.learnedTraits) };
    }),
    syncConversations: protectedProcedure.mutation(async () => ({ success: true, synced: 0, message: "Phase 1: 会話同期は未対応" })),
    analyzePersonality: protectedProcedure.mutation(async () => ({ success: true, analyzed: false, message: "Phase 1: 性格分析は未対応" })),
    updateLearningSettings: protectedProcedure
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
    updateLearnedTraits: protectedProcedure
      .input(z.object({ learnedTraits: z.any() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const existing = await ctx.env.DB.prepare(`SELECT id FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE conversation_learning SET learnedTraits=?, updatedAt=datetime('now') WHERE id=?`).bind(toJson(input.learnedTraits), existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO conversation_learning (userId, twinId, learnedTraits) VALUES (?,?,?)`).bind(ctx.userId, twin.id, toJson(input.learnedTraits)).run();
        }
        return { success: true };
      }),
    createConnection: protectedProcedure
      .input(z.object({ gatewayUrl: z.string(), authToken: z.string().optional(), agentId: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        await ctx.env.DB.prepare(`INSERT INTO clawdbot_connections (userId, twinId, gatewayUrl, authToken, agentId) VALUES (?,?,?,?,?)`).bind(ctx.userId, twin.id, input.gatewayUrl, input.authToken ?? null, input.agentId ?? "main").run();
        return { success: true };
      }),
    updateConnection: protectedProcedure
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
    deleteConnection: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).run();
      return { success: true };
    }),
  }),

  // ============ LINE ============
  line: router({
    getConnection: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, settings: parseJson<any>(row.settings) };
    }),
    linkByCode: protectedProcedure
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
    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE line_connections SET status='disconnected', disconnectedAt=datetime('now'), updatedAt=datetime('now') WHERE userId=?`).bind(ctx.userId).run();
      return { success: true };
    }),
    updateSettings: protectedProcedure
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
    toggleStatus: protectedProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .mutation(async ({ ctx }) => {
        await ensureSchema(ctx.env.DB);
        const conn = await ctx.env.DB.prepare(`SELECT status FROM line_connections WHERE userId=?`).bind(ctx.userId).first<any>();
        if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
        const newStatus = conn.status === "active" ? "paused" : "active";
        await ctx.env.DB.prepare(`UPDATE line_connections SET status=?, updatedAt=datetime('now') WHERE userId=?`).bind(newStatus, ctx.userId).run();
        return { success: true, status: newStatus };
      }),
    getMessageHistory: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async () => {
        return [] as any[];
      }),
  }),

  // ============ Plan ============
  plan: router({
    getCurrent: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return { plan: user?.plan ?? "free" };
    }),
    getInfo: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return { plan: user?.plan ?? "free", limits: { maxFriends: 5, maxMatchingsPerMonth: 3 } };
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
        usage: { friends: friends?.c ?? 0, matchingsThisMonth: matchings?.c ?? 0, knowledgeEntries: 0, fileUploads: 0, friendCount: friends?.c ?? 0, matchingCount: matchings?.c ?? 0 },
        limits: { maxFriends: 5, maxMatchingsPerMonth: 3, maxKnowledge: 50, maxKnowledgeEntries: 50, maxFileUploads: 10 },
      };
    }),
    getSubscription: protectedProcedure.query(async () => null as { cancelAtPeriodEnd: boolean; currentPeriodEnd: string } | null),
    createCheckoutSession: protectedProcedure
      .input(z.object({ planId: z.string().optional(), plan: z.string().optional(), billingCycle: z.string().optional(), interval: z.string().optional() }))
      .mutation(async () => ({ url: undefined as string | undefined, message: "Phase 1: Stripe未対応" })),
    createPortalSession: protectedProcedure.mutation(async () => ({ url: undefined as string | undefined })),
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
    getUsage: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const usage = await ctx.env.DB.prepare(`SELECT * FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
      return usage ?? { matchingsThisMonth: 0 };
    }),
  }),

  // ============ Stripe (stubs) ============
  stripe: router({
    createCheckoutSession: protectedProcedure
      .input(z.object({ planId: z.string() }))
      .mutation(async () => ({ url: undefined as string | undefined, message: "Phase 1: Stripe未対応" })),
    getSubscription: protectedProcedure.query(async () => null as { cancelAtPeriodEnd: boolean; currentPeriodEnd: string } | null),
  }),

  // ============ Discover ============
  discover: router({
    search: protectedProcedure
      .input(z.object({ query: z.string().optional(), limit: z.number().optional() }).optional())
      .query(async ({ ctx }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE isPublic=1 AND userId!=? LIMIT 20`).bind(ctx.userId).all<any>();
        return (rows.results ?? []).map(normalizeTwin);
      }),
  }),

  // ============ User (friend code etc) ============
  user: router({
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
  }),

  // ============ AI Provider (alias used by frontend) ============
  aiProvider: router({
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
  }),

  // ============ Onboarding ============
  onboarding: router({
    getStatus: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.userId) return { onboardingCompleted: 0 };
      const row = await ctx.env.DB.prepare(`SELECT onboardingCompleted FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return { onboardingCompleted: row?.onboardingCompleted ?? 0 };
    }),
    getSession: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.userId) return null;
      const session = await ctx.env.DB.prepare(
        `SELECT * FROM chat_sessions WHERE userId=? AND mode='onboarding' ORDER BY createdAt DESC LIMIT 1`
      ).bind(ctx.userId).first<any>();
      return session ?? null;
    }),
    complete: protectedProcedure
      .input(z.object({
        description: z.string().optional(),
        personality: z.string().optional(),
        rawInput: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        // Update onboardingCompleted flag
        await ctx.env.DB.prepare(`UPDATE users SET onboardingCompleted=1 WHERE id=?`).bind(ctx.userId).run();
        // Update twin profile if data provided
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (twin) {
          const sets: string[] = [];
          const binds: any[] = [];
          if (input.description) { sets.push("description=?"); binds.push(input.description); }
          if (input.personality) { sets.push("personality=?"); binds.push(input.personality); }
          if (input.rawInput) { sets.push("rawInput=?"); binds.push(input.rawInput); }
          // Clear onboarding system prompt and set a normal one
          sets.push("systemPrompt=?");
          binds.push(null);
          if (sets.length > 0) {
            sets.push("updatedAt=datetime('now')");
            binds.push(twin.id);
            await ctx.env.DB.prepare(`UPDATE digital_twins SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
          }
        }
        return { success: true };
      }),
  }),

  // ============ Admin AI Provider ============
  adminAiProvider: router({
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
  }),
});

export type AppRouter = typeof appRouter;

// ============ Hono App ============

const api = new Hono<{ Bindings: Env }>();

api.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "*",
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

api.get("/", (c) => c.json({ message: "Bunshin AI API v2. Use /api/* endpoints." }));
api.get("/api/health", (c) => c.json({ ok: true }));

api.all("/api/trpc/*", async (c) => {
  const env = c.env as Env;
  const db = env.DB;
  await ensureSchema(db);

  // Try to resolve user from JWT cookie
  let userId = 0;
  let user: Context["user"] = null;
  const cookieHeader = c.req.header("cookie") || null;
  const token = parseCookie(cookieHeader, COOKIE_NAME);

  if (token) {
    const session = await verifySessionToken(token, env);
    if (session) {
      const row = await db.prepare(`SELECT id, openId, name, email, role, plan FROM users WHERE id=?`).bind(session.userId).first<any>();
      if (row) {
        userId = row.id;
        user = { id: row.id, openId: row.openId, name: row.name, email: row.email, role: row.role };
      }
    }
  }

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ env, userId, user }),
  });
});

// Set-cookie endpoint for login/register (called by client after tRPC mutation)
api.post("/api/auth/set-session", async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) return c.json({ error: "token required" }, 400);

  const env = c.env as Env;
  const session = await verifySessionToken(body.token, env);
  if (!session) return c.json({ error: "invalid token" }, 401);

  const isProduction = c.req.url.includes("workers.dev") || c.req.url.includes("pages.dev");
  const cookie = [
    `${COOKIE_NAME}=${body.token}`,
    `Path=/`,
    `HttpOnly`,
    isProduction ? `SameSite=None` : `SameSite=Lax`,
    `Max-Age=${Math.floor(ONE_YEAR_MS / 1000)}`,
    isProduction ? `Secure` : "",
  ].filter(Boolean).join("; ");

  return c.json({ success: true }, 200, { "Set-Cookie": cookie });
});

// Serve R2 assets
api.get("/assets/*", async (c) => {
  const env = c.env as Env;
  const r2 = env.ASSETS;
  if (!r2) return c.json({ error: "R2 not configured" }, 500);

  const key = c.req.path.replace(/^\/assets\//, "");
  if (!key) return c.json({ error: "Key required" }, 400);

  const object = await r2.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

// Clear session cookie on logout
api.post("/api/auth/logout", (c) => {
  const isProduction = c.req.url.includes("workers.dev") || c.req.url.includes("pages.dev");
  const cookie = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `HttpOnly`,
    isProduction ? `SameSite=None` : `SameSite=Lax`,
    `Max-Age=0`,
    isProduction ? `Secure` : "",
  ].filter(Boolean).join("; ");
  return c.json({ success: true }, 200, { "Set-Cookie": cookie });
});

export default api;
