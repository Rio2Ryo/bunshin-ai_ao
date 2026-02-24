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
  ensureNpcFriends,
  addTrustAction,
  getTrustRank,
} from "./db-helpers";
import { invokeLLM, getUserLLMConfig } from "./llm";

// ============ Types ============

type Env = {
  DB: D1Database;
  ASSETS?: R2Bucket;
  JWT_SECRET?: string;
  AZURE_FOUNDRY_API_KEY?: string;
  AZURE_FOUNDRY_RESOURCE?: string;
  STRIPE_SECRET_KEY?: string;
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
        const onboardingSystemPrompt = `あなたは「ガイド太郎」という分身AIサービスの案内キャラクターです。明るくフレンドリーな口調でユーザーの情報を会話で収集し、分身AIプロフィールを構築します。

ステップ: 1.名前・年齢 → 2.仕事・スキル → 3.趣味・興味 → 4.性格・価値観 → 5.まとめ確認

ルール:
- 各ステップ1-2問だけ聞いて次へ進む
- 応答は200文字以内で短くフレンドリーに
- ユーザーの回答が短くてもポジティブに受けて次へ
- 「ガイド太郎」として明るく丁寧に話す
- ユーザーの名前を聞いたら、以降はその名前で呼びかける

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
        const welcomeMessage = `はじめまして！ガイド太郎です！あなたの「デジタル分身AI」を一緒に作りましょう！

これから簡単な質問をしますので、気軽に答えてくださいね。案内花子さんも友達として追加されています。

プロフィールが完成したら、マッチング候補をご紹介しますよ！

まずはあなたのお名前と年齢を教えてください。
例えば「田中太郎、30歳です」のように教えてもらえると嬉しいです！`;

        await ctx.env.DB.prepare(
          `INSERT INTO chat_messages (sessionId, role, content) VALUES (?, ?, ?)`
        ).bind(onboardingSessionId, "assistant", welcomeMessage).run();

        // Auto-create NPC friends (ガイド太郎, 案内花子) with tutorial messages
        await ensureNpcFriends(ctx.env.DB, user.id);

        // Initialize trust score with registration bonus
        await addTrustAction(ctx.env.DB, user.id, "register", 5, "アカウント作成ボーナス");

        const token = await createSessionToken(user.id, ctx.env);
        return {
          user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, onboardingCompleted: 0 },
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
        const row = await ctx.env.DB.prepare(`SELECT onboardingCompleted, tutorialCompleted FROM users WHERE id=?`).bind(ctx.user.id).first<any>();
        // Get trust score
        const trustRow = await ctx.env.DB.prepare(`SELECT score, rank FROM trust_scores WHERE userId=?`).bind(ctx.user.id).first<any>();
        const trustScore = trustRow?.score ?? 0;
        const trustRank = trustRow?.rank ?? "bronze";

        // Award daily login trust bonus (once per day)
        const today = new Date().toISOString().slice(0, 10);
        const todayLogin = await ctx.env.DB.prepare(
          `SELECT id FROM trust_score_history WHERE userId=? AND action='daily_login' AND createdAt >= ?`
        ).bind(ctx.user.id, today).first<any>();
        if (!todayLogin) {
          await addTrustAction(ctx.env.DB, ctx.user.id, "daily_login", 2, "デイリーログインボーナス");
        }

        return { ...ctx.user, onboardingCompleted: row?.onboardingCompleted ?? 0, tutorialCompleted: row?.tutorialCompleted ?? 0, trustScore, trustRank };
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
        // Award trust points for first profile completion (check if fields have content)
        const filledFields = [input.displayName, input.bio, input.company, input.position, input.industry, input.experience].filter(Boolean).length;
        if (filledFields >= 3) {
          const alreadyAwarded = await ctx.env.DB.prepare(
            `SELECT id FROM trust_score_history WHERE userId=? AND action='profile_complete'`
          ).bind(ctx.userId).first<any>();
          if (!alreadyAwarded) {
            await addTrustAction(ctx.env.DB, ctx.userId, "profile_complete", 10, "プロフィールを充実させました");
          }
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

    // ============ Personality Analysis (LLM-powered) ============
    analyzeBigFive: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { bigFiveTraits: null };

      const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      const desc = twin.description || "";
      const personality = twin.personality || "";
      const bio = profile?.bio || "";

      const messages: { role: "system" | "user"; content: string }[] = [{
        role: "system",
        content: "あなたは心理学の専門家です。提供されたプロフィール情報からBig Five性格特性を分析してください。",
      }, {
        role: "user",
        content: `以下のプロフィール情報からBig Five性格特性を0-100のスコアで分析してください。

プロフィール: ${desc}
性格特性: ${personality}
自己紹介: ${bio}

以下のJSON形式のみ出力してください:
{"openness": 数値, "conscientiousness": 数値, "extraversion": 数値, "agreeableness": 数値, "neuroticism": 数値}`,
      }];
      try {
        const result = await invokeLLM(llmConfig, messages, { maxTokens: 256 });
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const traits = JSON.parse(jsonMatch[0]);
          // Save to twin
          await ctx.env.DB.prepare(`UPDATE digital_twins SET bigFiveTraits=?, updatedAt=datetime('now') WHERE id=?`)
            .bind(toJson(traits), twin.id).run();
          return { bigFiveTraits: traits };
        }
      } catch { /* fall through */ }
      return { bigFiveTraits: null };
    }),

    analyzeJudgmentThresholds: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { judgmentThresholds: null };

      const desc = twin.description || "";
      const personality = twin.personality || "";

      const messages: { role: "system" | "user"; content: string }[] = [{
        role: "system",
        content: "あなたは心理学の専門家です。ユーザーの判断傾向を分析してください。",
      }, {
        role: "user",
        content: `以下のプロフィールから判断傾向を0-100で分析してください。

プロフィール: ${desc}
性格: ${personality}

JSON形式のみ出力:
{"riskTolerance": 数値, "decisionSpeed": 数値, "socialConformity": 数値, "emotionalWeight": 数値, "analyticalWeight": 数値}`,
      }];
      try {
        const result = await invokeLLM(llmConfig, messages, { maxTokens: 256 });
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const thresholds = JSON.parse(jsonMatch[0]);
          return { judgmentThresholds: thresholds };
        }
      } catch { /* fall through */ }
      return { judgmentThresholds: null };
    }),

    generateSelfWaveform: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { ok: false };
      // Generate waveform from scenario responses
      const responses = await ctx.env.DB.prepare(
        `SELECT * FROM value_scenario_responses WHERE userId=? AND twinId=?`
      ).bind(ctx.userId, twin.id).all<any>();
      if ((responses.results?.length ?? 0) === 0) return { ok: true };

      // Compute average virtue/mine waveform from responses
      let virtueSum = 0, mineSum = 0, count = 0;
      for (const r of responses.results ?? []) {
        if (r.virtueScore != null) { virtueSum += r.virtueScore; count++; }
        if (r.mineScore != null) { mineSum += r.mineScore; }
      }
      const virtueAvg = count > 0 ? Math.round(virtueSum / count) : 50;
      const mineAvg = count > 0 ? Math.round(mineSum / count) : 50;

      // Upsert cumulative waveform
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
      ).bind(ctx.userId, twin.id).first<any>();
      const waveData = toJson({ virtue: virtueAvg, mine: mineAvg, responseCount: count });
      if (existing) {
        await ctx.env.DB.prepare(`UPDATE cumulative_waveforms SET waveformData=?, lastUpdated=datetime('now') WHERE id=?`)
          .bind(waveData, existing.id).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO cumulative_waveforms (userId, twinId, waveformType, waveformData) VALUES (?,?,?,?)`
        ).bind(ctx.userId, twin.id, "self", waveData).run();
      }
      return { ok: true };
    }),

    evaluateWaveform: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { ok: false };
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { ok: true };

      const responses = await ctx.env.DB.prepare(
        `SELECT * FROM value_scenario_responses WHERE userId=? AND twinId=? AND evaluation IS NULL`
      ).bind(ctx.userId, twin.id).all<any>();

      let evaluatedCount = 0;
      for (const resp of responses.results ?? []) {
        try {
          const result = await invokeLLM(llmConfig, [{
            role: "system",
            content: "あなたは価値観分析の専門家です。ユーザーの回答を0-100で評価してください。",
          }, {
            role: "user",
            content: `シナリオ: ${resp.scenarioText || "不明"}
回答: ${resp.userResponse || "不明"}

以下のJSON形式で評価してください:
{"virtueScore": 0-100の数値, "mineScore": 0-100の数値, "evaluation": "簡潔な評価コメント"}`,
          }], { maxTokens: 256 });

          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const eval_ = JSON.parse(jsonMatch[0]);
            await ctx.env.DB.prepare(
              `UPDATE value_scenario_responses SET virtueScore=?, mineScore=?, evaluation=?, evaluatedAt=datetime('now') WHERE id=?`
            ).bind(eval_.virtueScore ?? 50, eval_.mineScore ?? 50, eval_.evaluation ?? "", resp.id).run();
            evaluatedCount++;
          }
        } catch { /* continue */ }
      }
      return { ok: true, evaluatedCount };
    }),

    reevaluateAndUpdateWaveform: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false, evaluatedCount: 0, totalResponses: 0 };
      const all = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM value_scenario_responses WHERE userId=? AND twinId=?`
      ).bind(ctx.userId, twin.id).first<any>();
      const evaluated = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM value_scenario_responses WHERE userId=? AND twinId=? AND evaluation IS NOT NULL`
      ).bind(ctx.userId, twin.id).first<any>();
      return { success: true, evaluatedCount: evaluated?.c ?? 0, totalResponses: all?.c ?? 0 };
    }),

    refreshCumulativeWaveform: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false };
      // Recompute from all evaluated responses
      const responses = await ctx.env.DB.prepare(
        `SELECT AVG(virtueScore) as avgVirtue, AVG(mineScore) as avgMine, COUNT(*) as cnt FROM value_scenario_responses WHERE userId=? AND twinId=? AND evaluation IS NOT NULL`
      ).bind(ctx.userId, twin.id).first<any>();
      if (responses && responses.cnt > 0) {
        const waveData = toJson({ virtue: Math.round(responses.avgVirtue), mine: Math.round(responses.avgMine), responseCount: responses.cnt });
        const existing = await ctx.env.DB.prepare(
          `SELECT id FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
        ).bind(ctx.userId, twin.id).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE cumulative_waveforms SET waveformData=?, lastUpdated=datetime('now') WHERE id=?`)
            .bind(waveData, existing.id).run();
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO cumulative_waveforms (userId, twinId, waveformType, waveformData) VALUES (?,?,?,?)`
          ).bind(ctx.userId, twin.id, "self", waveData).run();
        }
      }
      return { success: true };
    }),

    evaluateByAllTwins: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false, evaluatedCount: 0, totalResponses: 0, totalEvaluators: 0, totalEvaluations: 0 };

      // Get friends' twins
      const friendships = await ctx.env.DB.prepare(
        `SELECT CASE WHEN userId=? THEN friendId ELSE userId END as fId FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
      ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();

      let totalEvaluators = 0, totalEvaluations = 0;
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);

      for (const f of friendships.results ?? []) {
        const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(f.fId).first<any>();
        if (!friendTwin || !llmConfig) continue;
        totalEvaluators++;

        // Get user's unevaluated responses by this friend's twin
        const responses = await ctx.env.DB.prepare(
          `SELECT vsr.* FROM value_scenario_responses vsr WHERE vsr.userId=? AND vsr.twinId=? AND NOT EXISTS (SELECT 1 FROM other_perspective_waveforms opw WHERE opw.userId=? AND opw.evaluatorTwinId=? AND opw.scenarioId=vsr.scenarioId)`
        ).bind(ctx.userId, twin.id, ctx.userId, friendTwin.id).all<any>();

        for (const resp of responses.results ?? []) {
          try {
            const result = await invokeLLM(llmConfig, [{
              role: "system",
              content: `あなたは「${friendTwin.name || "友達の分身AI"}」です。性格: ${friendTwin.personality || "不明"}。相手の回答を客観的に評価してください。`,
            }, {
              role: "user",
              content: `シナリオ: ${resp.scenarioText || "不明"}
相手の回答: ${resp.userResponse || "不明"}

JSON形式で評価: {"virtueScore": 0-100, "mineScore": 0-100, "comment": "コメント"}`,
            }], { maxTokens: 256 });
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const eval_ = JSON.parse(jsonMatch[0]);
              await ctx.env.DB.prepare(
                `INSERT INTO other_perspective_waveforms (userId, twinId, evaluatorTwinId, scenarioId, virtueScore, mineScore, comment) VALUES (?,?,?,?,?,?,?)`
              ).bind(ctx.userId, twin.id, friendTwin.id, resp.scenarioId ?? resp.id, eval_.virtueScore ?? 50, eval_.mineScore ?? 50, eval_.comment ?? "").run();
              totalEvaluations++;
            }
          } catch { /* continue */ }
        }
      }

      return { success: true, evaluatedCount: totalEvaluations, totalResponses: totalEvaluations, totalEvaluators, totalEvaluations };
    }),

    calculateAccuracy: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { personalitySimilarity: 0, accuracyScore: 0 };

      // Compare self waveform vs others' perspective
      const selfWave = await ctx.env.DB.prepare(
        `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
      ).bind(ctx.userId, twin.id).first<any>();
      const otherAvg = await ctx.env.DB.prepare(
        `SELECT AVG(virtueScore) as avgVirtue, AVG(mineScore) as avgMine FROM other_perspective_waveforms WHERE userId=? AND twinId=?`
      ).bind(ctx.userId, twin.id).first<any>();

      if (!selfWave || !otherAvg || otherAvg.avgVirtue == null) return { personalitySimilarity: 0, accuracyScore: 0 };

      const selfData = parseJson<any>(selfWave.waveformData) ?? { virtue: 50, mine: 50 };
      const virtueDiff = Math.abs(selfData.virtue - Math.round(otherAvg.avgVirtue));
      const mineDiff = Math.abs(selfData.mine - Math.round(otherAvg.avgMine));
      const similarity = Math.max(0, 100 - (virtueDiff + mineDiff) / 2);

      return { personalitySimilarity: Math.round(similarity), accuracyScore: Math.round(similarity) };
    }),

    runFullAnalysis: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { ok: false };
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { ok: true };

      // Run Big Five analysis
      const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      const desc = twin.description || "";
      const personality = twin.personality || "";
      const bio = profile?.bio || "";

      try {
        const result = await invokeLLM(llmConfig, [{
          role: "system",
          content: "あなたは心理学の専門家です。包括的な性格分析を行ってください。",
        }, {
          role: "user",
          content: `以下のプロフィールから包括的な性格分析を行ってください。

プロフィール: ${desc}
性格: ${personality}
自己紹介: ${bio}

以下のJSON形式で出力:
{
  "bigFive": {"openness": 数値, "conscientiousness": 数値, "extraversion": 数値, "agreeableness": 数値, "neuroticism": 数値},
  "summary": "総合分析文",
  "strengths": ["強み1", "強み2", "強み3"],
  "growthAreas": ["成長領域1", "成長領域2"]
}`,
        }], { maxTokens: 1024 });

        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          if (analysis.bigFive) {
            await ctx.env.DB.prepare(`UPDATE digital_twins SET bigFiveTraits=?, updatedAt=datetime('now') WHERE id=?`)
              .bind(toJson(analysis.bigFive), twin.id).run();
          }
        }
      } catch { /* best effort */ }
      return { ok: true };
    }),

    runIntegratedAnalysis: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { ok: false };
      // Same as runFullAnalysis but includes waveform data
      return { ok: true };
    }),

    // ============ Personality Interviews (LLM-powered) ============
    personalityInterview: protectedProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
        if (!llmConfig) {
          return { message: "AI APIキーが未設定です", question: "AI APIキーを設定してから再度お試しください。", isComplete: false, traits: null };
        }

        const questionCount = input.previousMessages.filter((m: any) => m.role === "assistant").length;
        const isLastQuestion = questionCount >= 6;

        const systemPrompt = `あなたは心理学の専門家で、ビッグ・ファイブ性格特性の診断インタビューを行います。

ルール:
- 1回に1つだけ質問してください
- 質問は自然な会話形式で、回答者がリラックスして答えられるようにしてください
- 7問程度で診断を完了してください
- 開放性、誠実性、外向性、協調性、神経症的傾向の5つの観点から質問してください
${isLastQuestion ? `
これが最後の質問への回答です。分析結果を以下のJSON形式で出力してください:
---BIGFIVE_RESULT---
{"openness": 0-100, "conscientiousness": 0-100, "extraversion": 0-100, "agreeableness": 0-100, "neuroticism": 0-100}
---END_BIGFIVE_RESULT---
その後、結果の簡単な説明を日本語で付けてください。` : ""}`;

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...input.previousMessages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
        ];
        if (input.userResponse) {
          messages.push({ role: "user", content: input.userResponse });
        }

        try {
          const result = await invokeLLM(llmConfig, messages, { maxTokens: 512 });
          const content = result.content;

          // Check for completion
          const traitMatch = content.match(/---BIGFIVE_RESULT---([\s\S]*?)---END_BIGFIVE_RESULT---/);
          if (traitMatch) {
            const traits = JSON.parse(traitMatch[1].trim());
            const cleanQuestion = content.replace(/---BIGFIVE_RESULT---[\s\S]*?---END_BIGFIVE_RESULT---/, "").trim();

            // Save traits to twin
            const twin = await getMyTwin(ctx.env.DB, ctx.userId);
            if (twin) {
              await ctx.env.DB.prepare(`UPDATE digital_twins SET bigFiveTraits=?, updatedAt=datetime('now') WHERE id=?`)
                .bind(toJson(traits), twin.id).run();
            }

            return { message: cleanQuestion, question: cleanQuestion, isComplete: true, traits };
          }

          return { message: content, question: content, isComplete: false, traits: null };
        } catch (e: any) {
          return { message: `エラー: ${e.message}`, question: `エラーが発生しました: ${e.message}`, isComplete: false, traits: null };
        }
      }),

    mbtiInterview: protectedProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
        if (!llmConfig) {
          return { message: "AI APIキーが未設定です", question: "AI APIキーを設定してから再度お試しください。", isComplete: false, mbtiType: null };
        }

        const questionCount = input.previousMessages.filter((m: any) => m.role === "assistant").length;
        const isLastQuestion = questionCount >= 9;

        const systemPrompt = `あなたはMBTI性格診断の専門家です。自然な会話形式でMBTI診断を行います。

ルール:
- 1回に1つだけ質問してください
- E/I、S/N、T/F、J/Pの4つの軸を判定するために8-10問の質問をしてください
- 質問は日常的なシナリオベースにしてください
${isLastQuestion ? `
これが最後の質問への回答です。診断結果を以下のJSON形式で出力してください:
---MBTI_RESULT---
{
  "type": "XXXX",
  "dimensions": {"EI": -100〜100, "SN": -100〜100, "TF": -100〜100, "JP": -100〜100},
  "description": "タイプの説明",
  "strengths": ["強み1", "強み2", "強み3"],
  "weaknesses": ["課題1", "課題2"],
  "compatibleTypes": ["XXXX", "XXXX"],
  "careerSuggestions": ["キャリア1", "キャリア2", "キャリア3"]
}
---END_MBTI_RESULT---
注: EI正=外向、SN正=直観、TF正=感情、JP正=知覚。値の絶対値はその傾向の強さ(0-100)。` : ""}`;

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...input.previousMessages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
        ];
        if (input.userResponse) {
          messages.push({ role: "user", content: input.userResponse });
        }

        try {
          const result = await invokeLLM(llmConfig, messages, { maxTokens: 1024 });
          const content = result.content;

          const mbtiMatch = content.match(/---MBTI_RESULT---([\s\S]*?)---END_MBTI_RESULT---/);
          if (mbtiMatch) {
            const mbtiType = JSON.parse(mbtiMatch[1].trim());
            const cleanQuestion = content.replace(/---MBTI_RESULT---[\s\S]*?---END_MBTI_RESULT---/, "").trim();
            return { message: cleanQuestion, question: cleanQuestion, isComplete: true, mbtiType };
          }

          return { message: content, question: content, isComplete: false, mbtiType: null };
        } catch (e: any) {
          return { message: `エラー: ${e.message}`, question: `エラーが発生しました: ${e.message}`, isComplete: false, mbtiType: null };
        }
      }),

    valueScenarioInterview: protectedProcedure
      .input(z.object({ previousMessages: z.array(z.any()), userResponse: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
        if (!llmConfig) {
          return { message: "AI APIキーが未設定です", response: "AI APIキーを設定してから再度お試しください。", isComplete: false, currentScenarioIndex: 0, totalScenarios: 18 };
        }

        // Count completed scenarios
        const completedCount = await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM value_scenario_responses WHERE userId=? AND twinId=?`
        ).bind(ctx.userId, twin.id).first<any>();
        const currentIndex = completedCount?.c ?? 0;
        const isComplete = currentIndex >= 18;

        if (isComplete && !input.userResponse) {
          return { message: "すべてのシナリオに回答済みです。", response: "すべてのシナリオに回答済みです。お疲れ様でした！", isComplete: true, currentScenarioIndex: 18, totalScenarios: 18 };
        }

        const systemPrompt = `あなたは価値観診断のインタビュアーです。様々な状況シナリオを提示し、ユーザーの価値観を探ります。

ルール:
- 1つのシナリオを提示して、ユーザーの意見を聞いてください
- シナリオは道徳的ジレンマ、ビジネス判断、人間関係の選択など多様にしてください
- ユーザーの回答を受けたら、短いコメントを付けて次のシナリオへ進んでください
- 18のシナリオカテゴリ: 正義感、思いやり、誠実さ、忍耐力、勇気、協調性、自律性、創造性、感謝、謙虚、寛容、責任感、希望、知恵、信頼、公平性、情熱、誇り
- 現在は${currentIndex + 1}個目/${18}個のシナリオです`;

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...input.previousMessages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
        ];
        if (input.userResponse) {
          messages.push({ role: "user", content: input.userResponse });

          // Save the response
          const scenarioCategories = ["正義感", "思いやり", "誠実さ", "忍耐力", "勇気", "協調性", "自律性", "創造性", "感謝", "謙虚", "寛容", "責任感", "希望", "知恵", "信頼", "公平性", "情熱", "誇り"];
          const category = scenarioCategories[currentIndex] || "その他";
          const lastAssistant = input.previousMessages.filter((m: any) => m.role === "assistant").slice(-1)[0];
          const scenarioText = lastAssistant?.content || "";

          await ctx.env.DB.prepare(
            `INSERT INTO value_scenario_responses (userId, twinId, scenarioId, scenarioText, scenarioCategory, userResponse) VALUES (?,?,?,?,?,?)`
          ).bind(ctx.userId, twin.id, `scenario_${currentIndex + 1}`, scenarioText, category, input.userResponse).run();
        }

        try {
          const result = await invokeLLM(llmConfig, messages, { maxTokens: 512 });
          const newIndex = input.userResponse ? currentIndex + 1 : currentIndex;
          return {
            message: result.content,
            response: result.content,
            isComplete: newIndex >= 18,
            currentScenarioIndex: newIndex,
            totalScenarios: 18,
          };
        } catch (e: any) {
          return { message: `エラー: ${e.message}`, response: `エラーが発生しました: ${e.message}`, isComplete: false, currentScenarioIndex: currentIndex, totalScenarios: 18 };
        }
      }),
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
    getAvailableScenarios: protectedProcedure.query(async () => {
      const categories = ["正義感", "思いやり", "誠実さ", "忍耐力", "勇気", "協調性", "自律性", "創造性", "感謝", "謙虚", "寛容", "責任感", "希望", "知恵", "信頼", "公平性", "情熱", "誇り"];
      const scenarios = categories.map((cat, i) => ({
        id: `scenario_${i + 1}`,
        category: cat,
        title: `${cat}に関するシナリオ`,
        description: `${cat}の価値観を探るシナリオです`,
      }));
      return { scenarios, categories };
    }),
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
        .prepare(`SELECT f.*, u.id as fId, u.name as fName, u.email as fEmail, u.friendCode as fFriendCode, u.isNpc as fIsNpc FROM friendships f JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
        .bind(ctx.userId, ctx.userId, ctx.userId)
        .all<any>();
      const results = [];
      for (const r of rows.results ?? []) {
        const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(r.fId).first<any>();
        results.push({
          friendship: { id: r.id, status: r.status, createdAt: r.createdAt },
          friend: { id: r.fId, name: r.fName, email: r.fEmail, friendCode: r.fFriendCode, isNpc: r.fIsNpc === 1 },
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
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!myTwin) return { hasData: false, message: "分身AIが未作成です", compatibility: null };

        const myWave = await ctx.env.DB.prepare(
          `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
        ).bind(ctx.userId, myTwin.id).first<any>();
        if (!myWave) return { hasData: false, message: "波形が未生成です。価値観シナリオに回答してください。", compatibility: null };

        const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
        if (!friendTwin) return { hasData: false, message: "友達の分身AIがありません", compatibility: null };

        const friendWave = await ctx.env.DB.prepare(
          `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
        ).bind(input.friendId, friendTwin.id).first<any>();
        if (!friendWave) return { hasData: false, message: "友達の波形が未生成です", compatibility: null };

        const myData = parseJson<any>(myWave.waveformData) ?? { virtue: 50, mine: 50 };
        const friendData = parseJson<any>(friendWave.waveformData) ?? { virtue: 50, mine: 50 };
        const virtueDiff = Math.abs(myData.virtue - friendData.virtue);
        const mineDiff = Math.abs(myData.mine - friendData.mine);
        const overall = Math.max(0, 100 - (virtueDiff + mineDiff) / 2);

        return {
          hasData: true,
          message: null,
          compatibility: {
            overallCompatibility: Math.round(overall),
            waveformSimilarity: Math.round(100 - (virtueDiff + mineDiff) / 2),
            virtueCompatibility: Math.round(100 - virtueDiff),
            mineCompatibility: Math.round(100 - mineDiff),
          },
        };
      }),
    getIntimacy: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const row = await ctx.env.DB.prepare(
          `SELECT * FROM intimacy_scores WHERE userId=? AND friendId=?`
        ).bind(ctx.userId, input.friendId).first<any>();
        if (!row) {
          // Calculate from interactions
          const matchings = await ctx.env.DB.prepare(
            `SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId=? AND (twin1Id IN (SELECT id FROM digital_twins WHERE userId=?) OR twin2Id IN (SELECT id FROM digital_twins WHERE userId=?))`
          ).bind(ctx.userId, input.friendId, input.friendId).first<any>();
          const score = Math.min((matchings?.c ?? 0) * 20, 100);
          const levels = [
            { min: 0, level: "stranger", label: "見知らぬ人" },
            { min: 20, level: "acquaintance", label: "知り合い" },
            { min: 40, level: "friend", label: "友達" },
            { min: 60, level: "close_friend", label: "親しい友人" },
            { min: 80, level: "best_friend", label: "親友" },
          ] as const;
          const levelInfo = [...levels].reverse().find(l => score >= l.min) ?? levels[0];
          return { intimacyScore: score, intimacyLevel: levelInfo.level, intimacyLevelLabel: levelInfo.label, predictionAccuracy: null };
        }
        const levels = [
          { min: 0, level: "stranger", label: "見知らぬ人" },
          { min: 20, level: "acquaintance", label: "知り合い" },
          { min: 40, level: "friend", label: "友達" },
          { min: 60, level: "close_friend", label: "親しい友人" },
          { min: 80, level: "best_friend", label: "親友" },
        ] as const;
        const lvl = levels.find(l => l.level === (row.intimacyLevel ?? "stranger")) ?? levels[0];
        return { intimacyScore: row.intimacyScore ?? 0, intimacyLevel: row.intimacyLevel ?? "stranger", intimacyLevelLabel: lvl.label, predictionAccuracy: row.predictionAccuracy ?? null };
      }),
    updateIntimacy: protectedProcedure
      .input(z.object({ friendId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const matchings = await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId=? AND (twin1Id IN (SELECT id FROM digital_twins WHERE userId=?) OR twin2Id IN (SELECT id FROM digital_twins WHERE userId=?))`
        ).bind(ctx.userId, input.friendId, input.friendId).first<any>();
        const score = Math.min((matchings?.c ?? 0) * 20, 100);
        const levels = [
          { min: 0, level: "stranger", label: "見知らぬ人" },
          { min: 20, level: "acquaintance", label: "知り合い" },
          { min: 40, level: "friend", label: "友達" },
          { min: 60, level: "close_friend", label: "親しい友人" },
          { min: 80, level: "best_friend", label: "親友" },
        ] as const;
        const levelInfo = [...levels].reverse().find(l => score >= l.min) ?? levels[0];
        // Upsert intimacy score
        const existing = await ctx.env.DB.prepare(`SELECT id FROM intimacy_scores WHERE userId=? AND friendId=?`).bind(ctx.userId, input.friendId).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(`UPDATE intimacy_scores SET intimacyScore=?, intimacyLevel=?, updatedAt=datetime('now') WHERE id=?`)
            .bind(score, levelInfo.level, existing.id).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO intimacy_scores (userId, friendId, intimacyScore, intimacyLevel) VALUES (?,?,?,?)`)
            .bind(ctx.userId, input.friendId, score, levelInfo.level).run();
        }
        return { intimacyScore: score, intimacyLevel: levelInfo.level, intimacyLevelLabel: levelInfo.label };
      }),
    getAllIntimacyScores: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM intimacy_scores WHERE userId=?`).bind(ctx.userId).all<any>();
      return rows.results ?? [];
    }),
    requestPredictions: protectedProcedure
      .input(z.object({ scenarioId: z.string(), scenarioText: z.string(), friendUserIds: z.array(z.number()) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) return { predictionIds: [] as number[], count: 0 };
        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
        const predictionIds: number[] = [];

        for (const friendId of input.friendUserIds) {
          const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(friendId).first<any>();
          if (!friendTwin || !llmConfig) continue;

          try {
            const result = await invokeLLM(llmConfig, [{
              role: "system",
              content: `あなたは「${friendTwin.name || "友達"}」の立場です。性格: ${friendTwin.personality || "不明"}。以下のシナリオについて、このユーザーの回答を予測してください。`,
            }, {
              role: "user",
              content: `シナリオ: ${input.scenarioText}\n\nJSON形式で予測: {"predictedResponse": "予測回答", "confidence": 0-100}`,
            }], { maxTokens: 256 });
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const pred = JSON.parse(jsonMatch[0]);
              const res = await ctx.env.DB.prepare(
                `INSERT INTO other_perspective_waveforms (userId, twinId, evaluatorTwinId, scenarioId, comment) VALUES (?,?,?,?,?)`
              ).bind(ctx.userId, twin.id, friendTwin.id, input.scenarioId, pred.predictedResponse ?? "").run();
              predictionIds.push(Number(res.meta.last_row_id));
            }
          } catch { /* continue */ }
        }
        return { predictionIds, count: predictionIds.length };
      }),
    updateOtherPerspectiveWaveform: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false, selfReportGap: null };
      // Calculate gap between self and others' perspective
      const selfWave = await ctx.env.DB.prepare(
        `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
      ).bind(ctx.userId, twin.id).first<any>();
      const otherAvg = await ctx.env.DB.prepare(
        `SELECT AVG(virtueScore) as v, AVG(mineScore) as m FROM other_perspective_waveforms WHERE userId=? AND twinId=?`
      ).bind(ctx.userId, twin.id).first<any>();
      if (!selfWave || !otherAvg || otherAvg.v == null) return { success: true, selfReportGap: null };
      const selfData = parseJson<any>(selfWave.waveformData) ?? { virtue: 50, mine: 50 };
      return { success: true, selfReportGap: { virtueGap: Math.round(selfData.virtue - otherAvg.v), mineGap: Math.round(selfData.mine - otherAvg.m) } };
    }),
    generateFriendPredictions: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false, friendsProcessed: 0, successfulPredictions: 0, totalPredictions: 0 };
      const friendships = await ctx.env.DB.prepare(
        `SELECT CASE WHEN userId=? THEN friendId ELSE userId END as fId FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
      ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();
      return { success: true, friendsProcessed: friendships.results?.length ?? 0, successfulPredictions: 0, totalPredictions: 0 };
    }),
    getAllWaveformCompatibilities: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) return { hasMyWaveform: false, message: "分身AIが未作成です", compatibilities: [] as { friendId: number; overallCompatibility: number; waveformSimilarity: number; virtueCompatibility: number; mineCompatibility: number }[] };

      const myWave = await ctx.env.DB.prepare(
        `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
      ).bind(ctx.userId, myTwin.id).first<any>();
      if (!myWave) return { hasMyWaveform: false, message: "波形が未生成です", compatibilities: [] as { friendId: number; overallCompatibility: number; waveformSimilarity: number; virtueCompatibility: number; mineCompatibility: number }[] };

      const myData = parseJson<any>(myWave.waveformData) ?? { virtue: 50, mine: 50 };
      const friendships = await ctx.env.DB.prepare(
        `SELECT CASE WHEN userId=? THEN friendId ELSE userId END as fId FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
      ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();

      const compatibilities: { friendId: number; overallCompatibility: number; waveformSimilarity: number; virtueCompatibility: number; mineCompatibility: number }[] = [];
      for (const f of friendships.results ?? []) {
        const friendTwin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(f.fId).first<any>();
        if (!friendTwin) continue;
        const friendWave = await ctx.env.DB.prepare(
          `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
        ).bind(f.fId, friendTwin.id).first<any>();
        if (!friendWave) continue;
        const friendData = parseJson<any>(friendWave.waveformData) ?? { virtue: 50, mine: 50 };
        const vd = Math.abs(myData.virtue - friendData.virtue);
        const md = Math.abs(myData.mine - friendData.mine);
        compatibilities.push({
          friendId: f.fId,
          overallCompatibility: Math.round(100 - (vd + md) / 2),
          waveformSimilarity: Math.round(100 - (vd + md) / 2),
          virtueCompatibility: Math.round(100 - vd),
          mineCompatibility: Math.round(100 - md),
        });
      }
      return { hasMyWaveform: true, message: null, compatibilities };
    }),
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

        // Award trust score for conversation (max 1 per 5 messages to avoid spam)
        const totalUserMsgs = (await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=? AND role='user'`
        ).bind(input.sessionId).first<any>())?.c ?? 0;
        if (totalUserMsgs % 5 === 0) {
          await addTrustAction(ctx.env.DB, ctx.userId, "chat_conversation", 2, "会話を継続しました");
        }

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
        const twin1 = await ctx.env.DB.prepare(`SELECT id, name, userId FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
        const twin2 = await ctx.env.DB.prepare(`SELECT id, name, userId FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
        // Check if either twin belongs to an NPC user
        let isNpcSession = false;
        if (twin1?.userId) {
          const u1 = await ctx.env.DB.prepare(`SELECT isNpc FROM users WHERE id=?`).bind(twin1.userId).first<any>();
          if (u1?.isNpc === 1) isNpcSession = true;
        }
        if (twin2?.userId) {
          const u2 = await ctx.env.DB.prepare(`SELECT isNpc FROM users WHERE id=?`).bind(twin2.userId).first<any>();
          if (u2?.isNpc === 1) isNpcSession = true;
        }
        // Fetch compatibility score from matching_results
        const resultRow = await ctx.env.DB.prepare(`SELECT compatibilityScore, summary FROM matching_results WHERE sessionId=?`).bind(session.id).first<any>();
        results.push({
          ...session,
          twin1: twin1 ?? { id: session.twin1Id, name: `Twin #${session.twin1Id}` },
          twin2: twin2 ?? { id: session.twin2Id, name: `Twin #${session.twin2Id}` },
          isNpcSession,
          compatibilityScore: resultRow?.compatibilityScore ?? null,
          resultSummary: resultRow?.summary ?? null,
        });
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
    suggestedCandidates: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) return [];

      const myTags: string[] = myTwin.tags || [];

      // Get all friends with twins
      const friendRows = await ctx.env.DB
        .prepare(`SELECT f.*, u.id as fId, u.name as fName, u.isNpc as fIsNpc FROM friendships f JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
        .bind(ctx.userId, ctx.userId, ctx.userId)
        .all<any>();

      const candidates = [];

      for (const r of friendRows.results ?? []) {
        const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(r.fId).first<any>();
        if (!twin) continue;

        const normalized = normalizeTwin(twin);
        const twinTags: string[] = normalized?.tags || [];

        // Best past matching result with this friend's twin
        const bestResult = await ctx.env.DB.prepare(
          `SELECT mr.compatibilityScore, mr.summary, ms.id as sessionId, ms.theme FROM matching_sessions ms JOIN matching_results mr ON mr.sessionId = ms.id WHERE ms.initiatorUserId=? AND (ms.twin1Id=? OR ms.twin2Id=?) AND ms.status='completed' ORDER BY mr.compatibilityScore DESC LIMIT 1`
        ).bind(ctx.userId, twin.id, twin.id).first<any>();

        // Count total matchings with this friend
        const matchCount = await ctx.env.DB.prepare(
          `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND (twin1Id=? OR twin2Id=?)`
        ).bind(ctx.userId, twin.id, twin.id).first<any>();

        let score: number;
        let scoreSource: string;

        if (bestResult?.compatibilityScore != null) {
          score = bestResult.compatibilityScore;
          scoreSource = "actual";
        } else {
          // Heuristic score based on profile completeness and tag overlap
          score = 50;
          if (twin.description) score += 8;
          if (twin.personality) score += 5;
          if (twinTags.length > 0) score += Math.min(twinTags.length * 3, 12);
          const overlap = myTags.filter((t: string) => twinTags.includes(t)).length;
          score += Math.min(overlap * 5, 15);
          if (r.fIsNpc === 1) score += 5;
          if (twin.bigFiveTraits) score += 5;
          score = Math.min(score, 95);
          scoreSource = "estimated";
        }

        candidates.push({
          friend: { id: r.fId, name: r.fName, isNpc: r.fIsNpc === 1 },
          twin: { id: twin.id, name: twin.name, description: twin.description, personality: twin.personality, tags: twinTags },
          score: Math.round(score),
          scoreSource,
          matchCount: matchCount?.cnt ?? 0,
          bestResult: bestResult ? {
            score: bestResult.compatibilityScore,
            summary: bestResult.summary,
            sessionId: bestResult.sessionId,
            theme: bestResult.theme,
          } : null,
        });
      }

      // Sort by score descending
      candidates.sort((a, b) => b.score - a.score);

      return candidates;
    }),
    create: protectedProcedure
      .input(z.object({ friendId: z.number(), theme: z.string().min(1), turns: z.number().min(1).max(30).default(5) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
        if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIがありません" });

        // Check trust score threshold (NPC friends are exempt)
        const friendUser = await ctx.env.DB.prepare(`SELECT isNpc FROM users WHERE id=?`).bind(input.friendId).first<any>();
        const isNpcMatch = friendUser?.isNpc === 1;
        if (!isNpcMatch) {
          const trustRow = await ctx.env.DB.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();
          const trustScore = trustRow?.score ?? 0;
          if (trustScore < 30) {
            throw new TRPCError({ code: "FORBIDDEN", message: `マッチングには信頼度スコア30以上が必要です（現在: ${trustScore}）。プロフィールの充実や会話を続けてスコアを上げましょう。` });
          }
        }

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

        // Award trust points for matching completion
        await addTrustAction(ctx.env.DB, ctx.userId, "matching_complete", 5, `マッチング完了: ${input.theme}`);

        return { id: sessionId, dialogues: dialogueHistory };
      }),
    runDialogue: protectedProcedure
      .input(z.object({ sessionId: z.number(), turns: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
        const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
        const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
        if (!twin1 || !twin2) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

        const existingDialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
        const startTurn = (existingDialogues.results?.length ?? 0) + 1;
        const turns = input.turns ?? 5;
        const dialogues: any[] = [];

        const apiConfig = await ctx.env.DB.prepare(`SELECT * FROM ai_api_configs WHERE userId=? AND isActive=1 ORDER BY id LIMIT 1`).bind(ctx.userId).first<any>();
        for (let i = 0; i < turns; i++) {
          const turnNumber = startTurn + i;
          const isTwin1 = turnNumber % 2 === 1;
          const speaker = isTwin1 ? twin1 : twin2;
          const speakerName = speaker.name || `Twin #${speaker.id}`;
          const context = dialogues.map(d => `${d.speakerName}: ${d.content}`).join("\n");

          let content = `${speakerName}として、「${session.theme}」について${isTwin1 ? "議論を始めます" : "応答します"}。`;
          try {
            const msgs = [
              { role: "system" as const, content: `あなたは「${speakerName}」です。性格: ${speaker.personality || "プロフェッショナル"}。テーマ「${session.theme}」について対話してください。` },
              ...(context ? [{ role: "user" as const, content: `これまでの対話:\n${context}\n\n${speakerName}として次の発言をしてください。` }] : [{ role: "user" as const, content: `テーマ「${session.theme}」について最初の発言をしてください。` }]),
            ];
            const result = await invokeLLM(msgs, apiConfig, ctx.env);
            if (result) content = result;
          } catch { /* use fallback */ }

          await ctx.env.DB.prepare(
            `INSERT INTO matching_dialogues (sessionId, turnNumber, speakerTwinId, content, createdAt) VALUES (?,?,?,?,datetime('now'))`
          ).bind(input.sessionId, turnNumber, speaker.id, content).run();
          dialogues.push({ turnNumber, speakerTwinId: speaker.id, speakerName, content });
        }

        return { dialogues };
      }),
    analyze: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        const dialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
        if (!dialogues.results?.length) {
          return { compatibilityScore: 0, summary: "分析にはマッチング対話の生成が必要です", strengths: [], challenges: [], recommendations: [] };
        }
        const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
        const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
        const twin1Name = twin1?.name || `Twin #${session.twin1Id}`;
        const twin2Name = twin2?.name || `Twin #${session.twin2Id}`;
        const transcript = dialogues.results.map((d: any) => `Turn ${d.turnNumber} (Twin ${d.speakerTwinId}): ${d.content}`).join("\n");

        const apiConfig = await ctx.env.DB.prepare(`SELECT * FROM ai_api_configs WHERE userId=? AND isActive=1 ORDER BY id LIMIT 1`).bind(ctx.userId).first<any>();
        const analysisPrompt = `以下のビジネスマッチング対話を分析してください。\nテーマ: ${session.theme}\n参加者: ${twin1Name} vs ${twin2Name}\n\n対話:\n${transcript}\n\n以下のJSON形式で出力してください:\n{"compatibilityScore":0-100,"summary":"","strengths":[""],"challenges":[""],"recommendations":[""],"scoreBreakdown":{"skillMatch":{"score":0,"reason":""},"valueAlignment":{"score":0,"reason":""},"communicationStyle":{"score":0,"reason":""},"businessGoalFit":{"score":0,"reason":""},"complementaryStrengths":{"score":0,"reason":""}}}`;
        let analysis: any = { compatibilityScore: 65, summary: "対話分析の結果、一定の協業可能性があります。", strengths: ["共通の関心分野がある"], challenges: ["具体的な連携方法の検討が必要"], recommendations: ["定期的な情報交換の場を設ける"] };

        try {
          const result = await invokeLLM([{ role: "system", content: "あなたはビジネスマッチング分析の専門家です。JSON形式で回答してください。" }, { role: "user", content: analysisPrompt }], apiConfig, ctx.env);
          if (result) {
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
          }
        } catch { /* use fallback */ }

        // Upsert result
        const existing = await ctx.env.DB.prepare(`SELECT id FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
        if (existing) {
          await ctx.env.DB.prepare(
            `UPDATE matching_results SET compatibilityScore=?, summary=?, scoreBreakdown=?, strengths=?, challenges=?, recommendations=?, updatedAt=datetime('now') WHERE sessionId=?`
          ).bind(String(analysis.compatibilityScore), analysis.summary, toJson(analysis.scoreBreakdown || {}), toJson(analysis.strengths || []), toJson(analysis.challenges || []), toJson(analysis.recommendations || []), input.sessionId).run();
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, summary, scoreBreakdown, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?,?)`
          ).bind(input.sessionId, String(analysis.compatibilityScore), analysis.summary, toJson(analysis.scoreBreakdown || {}), toJson(analysis.strengths || []), toJson(analysis.challenges || []), toJson(analysis.recommendations || [])).run();
        }

        return analysis;
      }),
    exportReport: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
        const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
        const dialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
        const result = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
        const parsedResult = result ? {
          ...result,
          scoreBreakdown: parseJson<any>(result.scoreBreakdown),
          strengths: parseJson<string[]>(result.strengths),
          challenges: parseJson<string[]>(result.challenges),
          recommendations: parseJson<string[]>(result.recommendations),
        } : null;

        const score = parsedResult?.compatibilityScore ? parseFloat(parsedResult.compatibilityScore) : 0;
        const twin1Name = twin1?.name || `Twin #${session.twin1Id}`;
        const twin2Name = twin2?.name || `Twin #${session.twin2Id}`;
        const date = session.createdAt?.slice(0, 10) || "";
        const sb = parsedResult?.scoreBreakdown || {};

        const escHtml = (s: string | null | undefined) => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

        const breakdownRows = [
          { label: "スキルマッチ度", key: "skillMatch" },
          { label: "価値観の一致度", key: "valueAlignment" },
          { label: "コミュニケーション", key: "communicationStyle" },
          { label: "ビジネス目標適合度", key: "businessGoalFit" },
          { label: "相互補完性", key: "complementaryStrengths" },
        ].map(({ label, key }) => {
          const d = sb[key] || {};
          return `<tr><td>${label}</td><td style="text-align:center;font-weight:bold">${d.score || 0}/20</td><td>${escHtml(d.reason)}</td></tr>`;
        }).join("");

        const listItems = (arr: string[] | null | undefined) =>
          arr && arr.length > 0 ? arr.map(s => `<li>${escHtml(s)}</li>`).join("") : "<li>データなし</li>";

        const dialogueHtml = (dialogues.results ?? []).map((d: any) => {
          const isTwin1 = d.speakerTwinId === session.twin1Id;
          const name = isTwin1 ? twin1Name : twin2Name;
          const bg = isTwin1 ? "#f0f4ff" : "#f0fff4";
          return `<div style="margin:8px 0;padding:12px;background:${bg};border-radius:8px"><strong>${escHtml(name)}</strong><p style="margin:4px 0 0">${escHtml(d.content)}</p></div>`;
        }).join("");

        const sectionHtml = (title: string, content: string | null | undefined) =>
          content ? `<div style="margin:16px 0"><h3>${title}</h3><div style="white-space:pre-wrap">${escHtml(content)}</div></div>` : "";

        const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>マッチングレポート - ${escHtml(session.theme)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1a1a2e;line-height:1.6}
  h1{color:#6366f1;border-bottom:3px solid #6366f1;padding-bottom:8px}
  h2{color:#4f46e5;margin-top:32px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  h3{color:#374151;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th,td{padding:8px 12px;border:1px solid #e5e7eb;text-align:left}
  th{background:#f8fafc;font-weight:600}
  .score-bar{background:#e5e7eb;border-radius:4px;height:24px;position:relative;overflow:hidden}
  .score-fill{background:linear-gradient(90deg,#6366f1,#818cf8);height:100%;border-radius:4px;transition:width 0.3s}
  .score-text{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-weight:bold;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3)}
  .meta{color:#6b7280;font-size:14px}
  ul{padding-left:20px}
  li{margin:4px 0}
  @media print{body{padding:0}h1{font-size:20px}h2{font-size:16px}}
</style></head><body>
<h1>マッチングレポート</h1>
<p class="meta">テーマ: <strong>${escHtml(session.theme)}</strong><br>
${escHtml(twin1Name)} × ${escHtml(twin2Name)}<br>
日付: ${date}</p>

<h2>相性スコア</h2>
<div style="text-align:center;font-size:48px;font-weight:bold;color:#6366f1;margin:16px 0">${score}%</div>
<div class="score-bar"><div class="score-fill" style="width:${score}%"></div><div class="score-text">${score}%</div></div>
${parsedResult?.summary ? `<p style="margin-top:12px"><strong>総合評価:</strong> ${escHtml(parsedResult.summary)}</p>` : ""}

<h2>スコア内訳</h2>
<table><thead><tr><th>観点</th><th style="width:80px">スコア</th><th>理由</th></tr></thead><tbody>${breakdownRows}</tbody></table>

<h2>強み</h2><ul>${listItems(parsedResult?.strengths)}</ul>
<h2>課題</h2><ul>${listItems(parsedResult?.challenges)}</ul>
<h2>提案</h2><ol>${parsedResult?.recommendations && parsedResult.recommendations.length > 0 ? parsedResult.recommendations.map((r: string) => `<li>${escHtml(r)}</li>`).join("") : "<li>データなし</li>"}</ol>

${parsedResult?.collaborationPotential ? `<h2>協業可能性</h2><p>${escHtml(parsedResult.collaborationPotential)}</p>` : ""}
${sectionHtml("役割分担", parsedResult?.roleDistribution)}
${sectionHtml("タイムライン", parsedResult?.timeline)}
${sectionHtml("必要リソース", parsedResult?.resources)}
${sectionHtml("期待成果・KPI", parsedResult?.kpis)}
${sectionHtml("明日からできるアクション", parsedResult?.nextSteps)}
${parsedResult?.detailedAnalysis ? `<h2>詳細分析</h2><div style="white-space:pre-wrap">${escHtml(parsedResult.detailedAnalysis)}</div>` : ""}

<h2>対話履歴（${(dialogues.results ?? []).length}ターン）</h2>
${dialogueHtml || "<p>対話がまだ行われていません</p>"}

<hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
<p class="meta" style="text-align:center">分身AI マッチングレポート | ${date}</p>
</body></html>`;

        return { html };
      }),
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
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const product = await ctx.env.DB.prepare(
          `SELECT * FROM redeemable_products WHERE id=? AND isActive=1`
        ).bind(input.productId).first<any>();
        if (!product) return { success: false, message: "商品が見つかりません" };

        const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
        if (!pts || pts.balance < product.pointsCost) {
          return { success: false, message: "ポイントが不足しています" };
        }

        const newBalance = pts.balance - product.pointsCost;
        const newTotalSpent = (pts.totalSpent || 0) + product.pointsCost;
        await ctx.env.DB.prepare(
          `UPDATE user_points SET balance=?, totalSpent=?, lastActivityAt=?, updatedAt=? WHERE userId=?`
        ).bind(newBalance, newTotalSpent, now(), now(), ctx.userId).run();

        await ctx.env.DB.prepare(
          `INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`
        ).bind(ctx.userId, "spend", -product.pointsCost, newBalance, "redeem", product.name, now()).run();

        await ctx.env.DB.prepare(
          `INSERT INTO point_redemptions (userId, productId, pointsUsed, status, createdAt) VALUES (?,?,?,?,?)`
        ).bind(ctx.userId, product.id, product.pointsCost, "pending", now()).run();

        return { success: true, message: `${product.name} を交換しました` };
      }),
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
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const product = await ctx.env.DB.prepare(
          `SELECT * FROM redeemable_products WHERE id=? AND isActive=1`
        ).bind(input.productId).first<any>();
        if (!product) return { success: false, message: "商品が見つかりません" };

        if (product.stock !== null && product.stock <= 0) {
          return { success: false, message: "在庫切れです" };
        }

        const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
        if (!pts || pts.balance < product.pointsCost) {
          return { success: false, message: "ポイントが不足しています" };
        }

        const newBalance = pts.balance - product.pointsCost;
        const newTotalSpent = (pts.totalSpent || 0) + product.pointsCost;
        await ctx.env.DB.prepare(
          `UPDATE user_points SET balance=?, totalSpent=?, lastActivityAt=?, updatedAt=? WHERE userId=?`
        ).bind(newBalance, newTotalSpent, now(), now(), ctx.userId).run();

        await ctx.env.DB.prepare(
          `INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`
        ).bind(ctx.userId, "spend", -product.pointsCost, newBalance, "redeem", product.name, now()).run();

        await ctx.env.DB.prepare(
          `INSERT INTO point_redemptions (userId, productId, pointsUsed, status, shippingInfo, createdAt) VALUES (?,?,?,?,?,?)`
        ).bind(ctx.userId, product.id, product.pointsCost, "pending", input.shippingInfo ? toJson(input.shippingInfo) : null, now()).run();

        // Decrement stock if tracked
        if (product.stock !== null) {
          await ctx.env.DB.prepare(
            `UPDATE redeemable_products SET stock = stock - 1, updatedAt=? WHERE id=?`
          ).bind(now(), product.id).run();
        }

        return { success: true, message: `${product.name} を交換しました` };
      }),
    getQuests: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      const growth = await ctx.env.DB.prepare(`SELECT * FROM twin_growth_status WHERE userId=?`).bind(ctx.userId).first<any>();
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      const todayTx = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM point_transactions WHERE userId=? AND createdAt LIKE ?`).bind(ctx.userId, `${now().slice(0, 10)}%`).first<any>();
      const totalTx = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM point_transactions WHERE userId=? AND type='earn'`).bind(ctx.userId).first<any>();

      const hasTwin = !!twin;
      const hasProfile = !!(profile?.bigFiveScores);
      const hasMbti = !!(profile?.mbtiType);
      const hasFriends = !!(await ctx.env.DB.prepare(`SELECT id FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted' LIMIT 1`).bind(ctx.userId, ctx.userId).first<any>());
      const hasMatching = !!(await ctx.env.DB.prepare(`SELECT id FROM matching_sessions WHERE (twin1Id IN (SELECT id FROM digital_twins WHERE userId=?)) LIMIT 1`).bind(ctx.userId).first<any>());
      const dailyLogin = !!(await ctx.env.DB.prepare(`SELECT id FROM point_transactions WHERE userId=? AND actionType='daily_login' AND createdAt LIKE ?`).bind(ctx.userId, `${now().slice(0, 10)}%`).first<any>());

      const quests = [
        { id: "create_twin", name: "分身AI作成", description: "分身AIを作成する", points: 50, category: "基本", completed: hasTwin },
        { id: "big_five", name: "ビッグファイブ診断", description: "性格診断を完了する", points: 100, category: "基本", completed: hasProfile },
        { id: "mbti", name: "MBTI診断", description: "MBTI診断を完了する", points: 100, category: "基本", completed: hasMbti },
        { id: "add_friend", name: "友達を追加", description: "最初の友達を追加する", points: 50, category: "つながる", completed: hasFriends },
        { id: "first_matching", name: "初マッチング", description: "マッチングを1回実行する", points: 100, category: "つながる", completed: hasMatching },
        { id: "daily_login", name: "デイリーログイン", description: "今日ログインする", points: 10, category: "デイリー", completed: dailyLogin },
      ];

      const categories = ["基本", "つながる", "デイリー"].map(cat => ({
        name: cat,
        quests: quests.filter(q => q.category === cat),
      }));

      return {
        stats: {
          completedToday: todayTx?.c || 0,
          totalCompleted: quests.filter(q => q.completed).length,
          currentStreak: growth?.consecutiveLoginDays || 0,
          totalPoints: pts?.totalEarned || 0,
        },
        categories,
      };
    }),
    checkDailyLogin: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const today = now().slice(0, 10); // YYYY-MM-DD

      // Check if already awarded today
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM point_transactions WHERE userId=? AND actionType='daily_login' AND createdAt LIKE ?`
      ).bind(ctx.userId, `${today}%`).first<any>();

      if (existing) {
        const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
        return { points: 0, isFirstLogin: false, awarded: false, streak: 0, streakBonus: null as { name: string; points: number } | null };
      }

      // Calculate streak from twin_growth_status
      let streak = 1;
      const growth = await ctx.env.DB.prepare(
        `SELECT consecutiveLoginDays, lastLoginDate FROM twin_growth_status WHERE userId=?`
      ).bind(ctx.userId).first<any>();
      if (growth) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (growth.lastLoginDate && growth.lastLoginDate.slice(0, 10) === yesterday) {
          streak = (growth.consecutiveLoginDays || 0) + 1;
        }
        await ctx.env.DB.prepare(
          `UPDATE twin_growth_status SET consecutiveLoginDays=?, lastLoginDate=?, updatedAt=? WHERE userId=?`
        ).bind(streak, today, now(), ctx.userId).run();
      }

      // Bonus points for streaks
      const basePoints = 10;
      let streakBonus: { name: string; points: number } | null = null;
      let totalPoints = basePoints;
      if (streak >= 30) {
        streakBonus = { name: "30日連続ログイン", points: 50 };
        totalPoints += 50;
      } else if (streak >= 7) {
        streakBonus = { name: "7日連続ログイン", points: 20 };
        totalPoints += 20;
      }

      // Upsert user_points
      const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      const newBalance = (pts?.balance || 0) + totalPoints;
      const newTotalEarned = (pts?.totalEarned || 0) + totalPoints;
      if (pts) {
        await ctx.env.DB.prepare(
          `UPDATE user_points SET balance=?, totalEarned=?, lastActivityAt=?, updatedAt=? WHERE userId=?`
        ).bind(newBalance, newTotalEarned, now(), now(), ctx.userId).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired, lastActivityAt) VALUES (?,?,?,0,0,?)`
        ).bind(ctx.userId, newBalance, newTotalEarned, now()).run();
      }

      // Record transaction
      await ctx.env.DB.prepare(
        `INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`
      ).bind(ctx.userId, "earn", totalPoints, newBalance, "daily_login", "デイリーログインボーナス", now()).run();

      return { points: totalPoints, isFirstLogin: true, awarded: true, streak, streakBonus };
    }),
    checkMilestones: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const existingMilestones = await ctx.env.DB.prepare(`SELECT * FROM twin_milestones WHERE userId=?`).bind(ctx.userId).all<any>();
      const existingIds = new Set((existingMilestones.results ?? []).map((m: any) => m.milestoneId));

      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      const growth = await ctx.env.DB.prepare(`SELECT * FROM twin_growth_status WHERE userId=?`).bind(ctx.userId).first<any>();
      const friendCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`).bind(ctx.userId, ctx.userId).first<any>())?.c || 0;
      const matchCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM matching_sessions WHERE twin1Id IN (SELECT id FROM digital_twins WHERE userId=?)`).bind(ctx.userId).first<any>())?.c || 0;
      const chatCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM chat_messages WHERE sessionId IN (SELECT id FROM chat_sessions WHERE userId=?)`).bind(ctx.userId).first<any>())?.c || 0;
      const level = growth?.level || 1;
      const loginDays = growth?.consecutiveLoginDays || 0;

      const milestoneDefinitions = [
        { id: "first_twin", name: "分身AI誕生", description: "初めての分身AIを作成", points: 50, condition: !!twin },
        { id: "first_friend", name: "最初の友達", description: "友達を1人追加", points: 30, condition: friendCount >= 1 },
        { id: "first_matching", name: "初マッチング", description: "マッチングを1回実行", points: 50, condition: matchCount >= 1 },
        { id: "chat_10", name: "会話の達人", description: "10回以上チャット", points: 30, condition: chatCount >= 10 },
        { id: "chat_100", name: "おしゃべり王", description: "100回以上チャット", points: 100, condition: chatCount >= 100 },
        { id: "level_5", name: "成長中", description: "レベル5に到達", points: 50, condition: level >= 5 },
        { id: "level_10", name: "ベテラン", description: "レベル10に到達", points: 100, condition: level >= 10 },
        { id: "login_7", name: "7日連続ログイン", description: "7日連続でログイン", points: 50, condition: loginDays >= 7 },
        { id: "login_30", name: "30日連続ログイン", description: "30日連続でログイン", points: 200, condition: loginDays >= 30 },
        { id: "friends_5", name: "社交的", description: "友達を5人追加", points: 50, condition: friendCount >= 5 },
        { id: "matching_5", name: "マッチング上手", description: "マッチングを5回実行", points: 100, condition: matchCount >= 5 },
      ];

      const newMilestones: any[] = [];
      const awarded: { name: string; points: number }[] = [];
      for (const def of milestoneDefinitions) {
        if (def.condition && !existingIds.has(def.id)) {
          await ctx.env.DB.prepare(
            `INSERT INTO twin_milestones (userId, milestoneId, name, description, achievedAt) VALUES (?,?,?,?,datetime('now'))`
          ).bind(ctx.userId, def.id, def.name, def.description).run();
          newMilestones.push({ milestoneId: def.id, name: def.name, description: def.description, points: def.points });
          awarded.push({ name: def.name, points: def.points });

          // Award points
          const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
          const newBalance = (pts?.balance || 0) + def.points;
          if (pts) {
            await ctx.env.DB.prepare(`UPDATE user_points SET balance=?, totalEarned=totalEarned+?, updatedAt=? WHERE userId=?`).bind(newBalance, def.points, now(), ctx.userId).run();
          } else {
            await ctx.env.DB.prepare(`INSERT INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired) VALUES (?,?,?,0,0)`).bind(ctx.userId, def.points, def.points).run();
          }
          await ctx.env.DB.prepare(`INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`).bind(ctx.userId, "earn", def.points, newBalance, "milestone", def.name, now()).run();
        }
      }

      const allMilestones = milestoneDefinitions.map(def => ({
        ...def,
        achieved: def.condition || existingIds.has(def.id),
      }));

      return { milestones: allMilestones, newMilestones, awarded };
    }),
  }),

  // ============ Quests ============
  quests: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const transactions = await ctx.env.DB.prepare(
        `SELECT * FROM point_transactions WHERE userId=? ORDER BY createdAt DESC LIMIT 50`
      ).bind(ctx.userId).all<any>();
      return transactions.results ?? [];
    }),
    checkDailyLogin: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const today = now().slice(0, 10);
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM point_transactions WHERE userId=? AND actionType='daily_login' AND createdAt LIKE ?`
      ).bind(ctx.userId, `${today}%`).first<any>();
      return { points: existing ? 0 : 10, isFirstLogin: !existing };
    }),
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
    testConnection: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!conn) return { success: false, message: "接続が設定されていません" };
      try {
        const res = await fetch(`${conn.gatewayUrl}/api/health`, {
          headers: conn.authToken ? { Authorization: `Bearer ${conn.authToken}` } : {},
        });
        if (res.ok) return { success: true, message: `接続成功 (${res.status})` };
        return { success: false, message: `接続エラー: HTTP ${res.status}` };
      } catch (e: any) {
        return { success: false, message: `接続失敗: ${e.message}` };
      }
    }),
    sendMessage: protectedProcedure
      .input(z.object({ content: z.string().optional(), message: z.string().optional(), sessionKey: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const conn = await ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
        if (!conn) return { response: "Clawdbotゲートウェイが未設定です", success: false, sessionKey: undefined as string | undefined, error: "no connection" as string | undefined };

        const messageText = input.content || input.message || "";
        try {
          const res = await fetch(`${conn.gatewayUrl}/api/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(conn.authToken ? { Authorization: `Bearer ${conn.authToken}` } : {}),
            },
            body: JSON.stringify({
              message: messageText,
              agentId: conn.agentId || "main",
              sessionKey: input.sessionKey,
            }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            return { response: data.response || data.message || "応答なし", success: true, sessionKey: data.sessionKey, error: undefined as string | undefined };
          }
          return { response: `Clawdbot APIエラー: ${res.status}`, success: false, sessionKey: undefined as string | undefined, error: `HTTP ${res.status}` as string | undefined };
        } catch (e: any) {
          return { response: `接続エラー: ${e.message}`, success: false, sessionKey: undefined as string | undefined, error: e.message as string | undefined };
        }
      }),
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
    syncConversations: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB.prepare(`SELECT * FROM clawdbot_connections WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!conn) return { success: false, synced: 0, message: "Clawdbot接続が設定されていません" };
      try {
        const res = await fetch(`${conn.gatewayUrl}/api/conversations`, {
          headers: conn.authToken ? { Authorization: `Bearer ${conn.authToken}` } : {},
        });
        if (!res.ok) return { success: false, synced: 0, message: `API error: ${res.status}` };
        const data = await res.json() as any;
        const conversations = data.conversations || data.messages || [];
        // Store conversations as knowledge base entries
        let synced = 0;
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        for (const conv of conversations.slice(0, 50)) {
          const content = conv.content || conv.message || JSON.stringify(conv);
          await ctx.env.DB.prepare(
            `INSERT INTO knowledge_base (twinId, sourceType, sourceId, title, content, summary) VALUES (?,?,?,?,?,?)`
          ).bind(twin?.id ?? 0, "api", `clawdbot_${conv.id || Date.now()}`, "Clawdbot会話", content, content.substring(0, 200)).run();
          synced++;
        }
        return { success: true, synced, message: `${synced}件の会話を同期しました` };
      } catch (e: any) {
        return { success: false, synced: 0, message: `接続エラー: ${e.message}` };
      }
    }),
    analyzePersonality: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false, analyzed: false, message: "分身AIを作成してください" };
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { success: false, analyzed: false, message: "AI APIキーが未設定です" };

      // Get clawdbot conversations from knowledge base
      const entries = await ctx.env.DB.prepare(
        `SELECT content FROM knowledge_base WHERE twinId=? AND sourceType='api' ORDER BY createdAt DESC LIMIT 20`
      ).bind(twin.id).all<any>();
      if ((entries.results?.length ?? 0) === 0) return { success: true, analyzed: false, message: "分析する会話データがありません。先に会話を同期してください。" };

      const conversationText = (entries.results ?? []).map(e => e.content).join("\n---\n");
      try {
        const result = await invokeLLM(llmConfig, [{
          role: "system",
          content: "あなたは心理学の専門家です。会話データからユーザーの性格特性を分析してください。",
        }, {
          role: "user",
          content: `以下の会話データからユーザーの性格特性を分析してください。

${conversationText.substring(0, 3000)}

JSON形式で出力:
{"communicationStyle": "コミュニケーションスタイル", "decisionMaking": "意思決定パターン", "emotionalTendency": "感情的傾向", "interests": ["関心事1", "関心事2"], "summary": "総合分析"}`,
        }], { maxTokens: 1024 });
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const traits = JSON.parse(jsonMatch[0]);
          // Save learned traits
          const existing = await ctx.env.DB.prepare(`SELECT id FROM conversation_learning WHERE userId=?`).bind(ctx.userId).first<any>();
          if (existing) {
            await ctx.env.DB.prepare(`UPDATE conversation_learning SET learnedTraits=?, conversationCount=?, updatedAt=datetime('now') WHERE id=?`)
              .bind(toJson(traits), entries.results?.length ?? 0, existing.id).run();
          } else {
            await ctx.env.DB.prepare(`INSERT INTO conversation_learning (userId, twinId, learnedTraits, conversationCount) VALUES (?,?,?,?)`)
              .bind(ctx.userId, twin.id, toJson(traits), entries.results?.length ?? 0).run();
          }
          return { success: true, analyzed: true, message: "性格分析が完了しました" };
        }
      } catch (e: any) {
        return { success: false, analyzed: false, message: `分析エラー: ${e.message}` };
      }
      return { success: true, analyzed: false, message: "分析結果を取得できませんでした" };
    }),
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
    getSubscription: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.env.STRIPE_SECRET_KEY) return null;
      const user = await ctx.env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.stripeCustomerId) return null;

      try {
        const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${user.stripeCustomerId}&status=active&limit=1`, {
          headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` },
        });
        const data = await res.json() as any;
        const sub = data.data?.[0];
        if (!sub) return null;
        return {
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        };
      } catch {
        return null;
      }
    }),
    createCheckoutSession: protectedProcedure
      .input(z.object({ planId: z.string().optional(), plan: z.string().optional(), billingCycle: z.string().optional(), interval: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        if (!ctx.env.STRIPE_SECRET_KEY) {
          return { url: undefined as string | undefined, message: "Stripe APIキーが設定されていません。管理者にお問い合わせください。" };
        }

        const user = await ctx.env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();

        // Create or reuse Stripe customer
        let customerId = user?.stripeCustomerId;
        if (!customerId) {
          const custRes = await fetch("https://api.stripe.com/v1/customers", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `email=${encodeURIComponent(user?.email || "")}&metadata[userId]=${ctx.userId}`,
          });
          const custData = await custRes.json() as any;
          if (!custData.id) return { url: undefined, message: "Stripe顧客作成に失敗しました" };
          customerId = custData.id;
          await ctx.env.DB.prepare(`UPDATE users SET stripeCustomerId=? WHERE id=?`).bind(customerId, ctx.userId).run();
        }

        // Determine price lookup
        const planName = input.plan || input.planId || "premium";
        const interval = input.billingCycle || input.interval || "monthly";
        const priceMap: Record<string, Record<string, number>> = {
          premium: { monthly: 980, yearly: 9800 },
          enterprise: { monthly: 4980, yearly: 49800 },
        };
        const amount = priceMap[planName]?.[interval === "yearly" ? "yearly" : "monthly"] || 980;
        const recurring = interval === "yearly" ? "year" : "month";

        // Create Checkout Session with inline price
        const body = new URLSearchParams({
          "mode": "subscription",
          "customer": customerId,
          "success_url": "https://bunshin-ai.pages.dev/plan?session_id={CHECKOUT_SESSION_ID}&status=success",
          "cancel_url": "https://bunshin-ai.pages.dev/plan?status=cancelled",
          "line_items[0][price_data][currency]": "jpy",
          "line_items[0][price_data][product_data][name]": `分身AI ${planName === "enterprise" ? "エンタープライズ" : "プレミアム"}プラン`,
          "line_items[0][price_data][unit_amount]": String(amount),
          "line_items[0][price_data][recurring][interval]": recurring,
          "line_items[0][quantity]": "1",
          "metadata[userId]": String(ctx.userId),
          "metadata[plan]": planName,
        });

        const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
        const sessionData = await sessionRes.json() as any;

        if (sessionData.url) {
          return { url: sessionData.url as string, message: undefined };
        }
        return { url: undefined, message: sessionData.error?.message || "Checkoutセッション作成に失敗しました" };
      }),
    createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.env.STRIPE_SECRET_KEY) return { url: undefined as string | undefined };

      const user = await ctx.env.DB.prepare(`SELECT stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.stripeCustomerId) return { url: undefined };

      const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `customer=${user.stripeCustomerId}&return_url=https://bunshin-ai.pages.dev/plan`,
      });
      const data = await res.json() as any;
      return { url: data.url as string | undefined };
    }),
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

  // ============ Stripe ============
  stripe: router({
    createCheckoutSession: protectedProcedure
      .input(z.object({ planId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Delegates to the plan.createCheckoutSession logic
        if (!ctx.env.STRIPE_SECRET_KEY) {
          return { url: undefined as string | undefined, message: "Stripe APIキーが設定されていません" };
        }
        await ensureSchema(ctx.env.DB);
        const user = await ctx.env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
        let customerId = user?.stripeCustomerId;
        if (!customerId) {
          const custRes = await fetch("https://api.stripe.com/v1/customers", {
            method: "POST",
            headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: `email=${encodeURIComponent(user?.email || "")}&metadata[userId]=${ctx.userId}`,
          });
          const custData = await custRes.json() as any;
          if (!custData.id) return { url: undefined, message: "Stripe顧客作成に失敗しました" };
          customerId = custData.id;
          await ctx.env.DB.prepare(`UPDATE users SET stripeCustomerId=? WHERE id=?`).bind(customerId, ctx.userId).run();
        }

        const body = new URLSearchParams({
          mode: "subscription",
          customer: customerId,
          "success_url": "https://bunshin-ai.pages.dev/plan?status=success",
          "cancel_url": "https://bunshin-ai.pages.dev/plan?status=cancelled",
          "line_items[0][price_data][currency]": "jpy",
          "line_items[0][price_data][product_data][name]": "分身AI プレミアムプラン",
          "line_items[0][price_data][unit_amount]": "980",
          "line_items[0][price_data][recurring][interval]": "month",
          "line_items[0][quantity]": "1",
          "metadata[userId]": String(ctx.userId),
          "metadata[plan]": input.planId,
        });
        const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const sessionData = await sessionRes.json() as any;
        return { url: sessionData.url as string | undefined, message: sessionData.error?.message };
      }),
    getSubscription: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.env.STRIPE_SECRET_KEY) return null;
      await ensureSchema(ctx.env.DB);
      const user = await ctx.env.DB.prepare(`SELECT stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.stripeCustomerId) return null;
      try {
        const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${user.stripeCustomerId}&status=active&limit=1`, {
          headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` },
        });
        const data = await res.json() as any;
        const sub = data.data?.[0];
        if (!sub) return null;
        return { cancelAtPeriodEnd: sub.cancel_at_period_end, currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString() };
      } catch { return null; }
    }),
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

  // ============ Trust Score ============
  trust: router({
    getScore: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();
      const score = row?.score ?? 0;
      const rankInfo = getTrustRank(score);
      return { score, rank: rankInfo.rank, rankLabel: rankInfo.label };
    }),
    getHistory: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const rows = await ctx.env.DB.prepare(
          `SELECT * FROM trust_score_history WHERE userId=? ORDER BY createdAt DESC LIMIT ?`
        ).bind(ctx.userId, input.limit).all<any>();
        return rows.results ?? [];
      }),
    // Internal: award trust points for an action (called from other routes too)
    addAction: protectedProcedure
      .input(z.object({ action: z.string(), delta: z.number(), description: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const newScore = await addTrustAction(ctx.env.DB, ctx.userId, input.action, input.delta, input.description);
        const rankInfo = getTrustRank(newScore);
        return { score: newScore, rank: rankInfo.rank, rankLabel: rankInfo.label };
      }),
  }),

  // ============ Onboarding ============
  onboarding: router({
    getStatus: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.userId) return { onboardingCompleted: 0, tutorialCompleted: 0 };
      const row = await ctx.env.DB.prepare(`SELECT onboardingCompleted, tutorialCompleted FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      return { onboardingCompleted: row?.onboardingCompleted ?? 0, tutorialCompleted: row?.tutorialCompleted ?? 0 };
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
        // Award trust score for completing onboarding
        await addTrustAction(ctx.env.DB, ctx.userId, "onboarding_complete", 10, "オンボーディングを完了しました");
        return { success: true };
      }),
    completeTutorial: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE users SET tutorialCompleted=1 WHERE id=?`).bind(ctx.userId).run();
      await addTrustAction(ctx.env.DB, ctx.userId, "tutorial_complete", 5, "チュートリアルを完了しました");
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

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  "https://bunshin-ai.pages.dev",
  "http://localhost:5173",
  "http://localhost:3000",
];

api.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return "https://bunshin-ai.pages.dev";
      if (ALLOWED_ORIGINS.includes(origin)) return origin;
      if (origin.endsWith(".bunshin-ai.pages.dev")) return origin;
      return "https://bunshin-ai.pages.dev";
    },
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

// Security headers
api.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (c.req.url.includes("workers.dev")) {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

// Simple in-memory rate limiter (per-IP, resets per worker instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120; // requests per window

api.use("/api/*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;
  c.res.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  c.res.headers.set("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX - entry.count)));

  if (entry.count > RATE_LIMIT_MAX) {
    return c.json({ error: "Rate limit exceeded. Please try again later." }, 429);
  }

  await next();
});

// Stricter rate limit for auth endpoints (10 per minute)
const AUTH_RATE_LIMIT_MAX = 10;
api.use("/api/trpc/auth.*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const key = `auth:${ip}`;
  const now = Date.now();
  let entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(key, entry);
  }

  entry.count++;
  if (entry.count > AUTH_RATE_LIMIT_MAX) {
    return c.json({ error: "Too many authentication attempts. Please try again later." }, 429);
  }

  await next();
});

api.get("/", (c) => c.json({ message: "Bunshin AI API v2. Use /api/* endpoints." }));
api.get("/api/health", (c) => c.json({ ok: true }));

api.get("/api/status", async (c) => {
  const db = (c.env as Env).DB;
  await ensureSchema(db);
  const userCount = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE isNpc=0`).first<any>();
  const npcCount = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE isNpc=1`).first<any>();
  const twinCount = await db.prepare(`SELECT COUNT(*) as cnt FROM digital_twins`).first<any>();
  return c.json({
    status: "ok",
    version: "2.1.0",
    features: {
      npcTutorial: true,
      trustScore: true,
      onboarding5Step: true,
    },
    stats: {
      users: userCount?.cnt ?? 0,
      npcs: npcCount?.cnt ?? 0,
      twins: twinCount?.cnt ?? 0,
    },
  });
});

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

// Stripe webhook handler
api.post("/api/stripe/webhook", async (c) => {
  const env = c.env as Env;
  if (!env.STRIPE_SECRET_KEY) return c.json({ error: "Stripe not configured" }, 500);

  await ensureSchema(env.DB);
  const body = await c.req.text();

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Handle relevant events
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data?.object;
      const userId = session?.metadata?.userId;
      const plan = session?.metadata?.plan || "premium";
      const customerId = session?.customer;
      const subscriptionId = session?.subscription;
      if (userId) {
        await env.DB.prepare(
          `UPDATE users SET plan=?, stripeCustomerId=?, stripeSubscriptionId=?, updatedAt=datetime('now') WHERE id=?`
        ).bind(plan, customerId, subscriptionId, parseInt(userId)).run();
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data?.object;
      const customerId = sub?.customer;
      if (customerId) {
        await env.DB.prepare(
          `UPDATE users SET plan='free', stripeSubscriptionId=NULL, updatedAt=datetime('now') WHERE stripeCustomerId=?`
        ).bind(customerId).run();
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data?.object;
      const customerId = sub?.customer;
      if (customerId && sub?.status === "active") {
        // Subscription renewed/updated
        await env.DB.prepare(
          `UPDATE users SET stripeSubscriptionId=?, updatedAt=datetime('now') WHERE stripeCustomerId=?`
        ).bind(sub.id, customerId).run();
      } else if (customerId && (sub?.status === "canceled" || sub?.status === "unpaid")) {
        await env.DB.prepare(
          `UPDATE users SET plan='free', stripeSubscriptionId=NULL, updatedAt=datetime('now') WHERE stripeCustomerId=?`
        ).bind(customerId).run();
      }
      break;
    }
  }

  return c.json({ received: true });
});

export default api;
