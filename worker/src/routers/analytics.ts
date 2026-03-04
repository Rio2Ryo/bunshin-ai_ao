import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { ensureSchema, toJson, addTrustAction, getTrustRank, getMyTwin } from "../db-helpers";
import { cachedQuery } from "../cache";

export const analyticsRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;
    const uid = ctx.userId;

    return cachedQuery(`analytics:dashboard:${uid}`, 120, async () => {
      // Matching stats
      const totalMatching = await db.prepare(`SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=?`).bind(uid).first<any>();
      const completedMatching = await db.prepare(`SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`).bind(uid).first<any>();
      const avgScore = await db.prepare(
        `SELECT AVG(CAST(mr.compatibilityScore AS REAL)) as avg FROM matching_results mr JOIN matching_sessions ms ON ms.id=mr.sessionId WHERE ms.initiatorUserId=?`
      ).bind(uid).first<any>();
      const highScoreCount = await db.prepare(
        `SELECT COUNT(*) as cnt FROM matching_results mr JOIN matching_sessions ms ON ms.id=mr.sessionId WHERE ms.initiatorUserId=? AND CAST(mr.compatibilityScore AS REAL)>=70`
      ).bind(uid).first<any>();

      // Monthly matching trend (last 6 months)
      const monthlyTrend = await db.prepare(
        `SELECT strftime('%Y-%m', ms.createdAt) as month, COUNT(*) as count, AVG(CAST(mr.compatibilityScore AS REAL)) as avgScore
         FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id
         WHERE ms.initiatorUserId=? AND ms.createdAt >= datetime('now','-6 months')
         GROUP BY month ORDER BY month`
      ).bind(uid).all<any>();

      // Chat engagement
      const totalChats = await db.prepare(`SELECT COUNT(*) as cnt FROM chat_sessions WHERE userId=?`).bind(uid).first<any>();
      const totalMessages = await db.prepare(
        `SELECT COUNT(*) as cnt FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId WHERE cs.userId=?`
      ).bind(uid).first<any>();

      // Weekly message trend (last 8 weeks)
      const weeklyMessages = await db.prepare(
        `SELECT strftime('%Y-W%W', cm.createdAt) as week, COUNT(*) as count
         FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId
         WHERE cs.userId=? AND cm.createdAt >= datetime('now','-8 weeks')
         GROUP BY week ORDER BY week`
      ).bind(uid).all<any>();

      // Friends + Trust
      const friendCount = await db.prepare(
        `SELECT COUNT(*) as cnt FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
      ).bind(uid, uid).first<any>();
      const trustRow = await db.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(uid).first<any>();

      // Score distribution
      const scoreDist = await db.prepare(
        `SELECT
          SUM(CASE WHEN CAST(mr.compatibilityScore AS REAL) >= 80 THEN 1 ELSE 0 END) as excellent,
          SUM(CASE WHEN CAST(mr.compatibilityScore AS REAL) >= 60 AND CAST(mr.compatibilityScore AS REAL) < 80 THEN 1 ELSE 0 END) as good,
          SUM(CASE WHEN CAST(mr.compatibilityScore AS REAL) >= 40 AND CAST(mr.compatibilityScore AS REAL) < 60 THEN 1 ELSE 0 END) as fair,
          SUM(CASE WHEN CAST(mr.compatibilityScore AS REAL) < 40 THEN 1 ELSE 0 END) as low
         FROM matching_results mr JOIN matching_sessions ms ON ms.id=mr.sessionId WHERE ms.initiatorUserId=?`
      ).bind(uid).first<any>();

      return {
        matching: {
          total: totalMatching?.cnt ?? 0,
          completed: completedMatching?.cnt ?? 0,
          avgScore: Math.round((avgScore?.avg ?? 0) * 10) / 10,
          highScoreCount: highScoreCount?.cnt ?? 0,
          successRate: totalMatching?.cnt > 0 ? Math.round(((highScoreCount?.cnt ?? 0) / totalMatching.cnt) * 100) : 0,
        },
        scoreDist: {
          excellent: scoreDist?.excellent ?? 0,
          good: scoreDist?.good ?? 0,
          fair: scoreDist?.fair ?? 0,
          low: scoreDist?.low ?? 0,
        },
        monthlyTrend: (monthlyTrend.results ?? []).map((r: any) => ({ month: r.month, count: r.count, avgScore: Math.round((r.avgScore ?? 0) * 10) / 10 })),
        engagement: {
          totalChats: totalChats?.cnt ?? 0,
          totalMessages: totalMessages?.cnt ?? 0,
          friendCount: friendCount?.cnt ?? 0,
          trustScore: trustRow?.score ?? 0,
        },
        weeklyMessages: (weeklyMessages.results ?? []).map((r: any) => ({ week: r.week, count: r.count })),
      };
    });
  }),

  /** Admin-only aggregate analytics: DAU/MAU, retention, matching success, signups */
  adminDashboard: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    return cachedQuery("analytics:admin", 300, async () => {
      // Total counts
      const totalUsers = (await db.prepare(`SELECT COUNT(*) as c FROM users`).first<any>())?.c ?? 0;
      const totalMatchings = (await db.prepare(`SELECT COUNT(*) as c FROM matching_sessions`).first<any>())?.c ?? 0;
      const totalChats = (await db.prepare(`SELECT COUNT(*) as c FROM chat_sessions`).first<any>())?.c ?? 0;
      const totalMessages = (await db.prepare(`SELECT COUNT(*) as c FROM chat_messages`).first<any>())?.c ?? 0;

      // DAU: daily distinct users who logged in (last 30 days)
      const dauRows = await db.prepare(
        `SELECT date(lastSignedIn) as day, COUNT(DISTINCT id) as count
         FROM users WHERE lastSignedIn >= datetime('now', '-30 days') AND lastSignedIn IS NOT NULL
         GROUP BY day ORDER BY day`
      ).all<any>();

      // MAU: monthly distinct users (last 12 months)
      const mauRows = await db.prepare(
        `SELECT strftime('%Y-%m', lastSignedIn) as month, COUNT(DISTINCT id) as count
         FROM users WHERE lastSignedIn >= datetime('now', '-12 months') AND lastSignedIn IS NOT NULL
         GROUP BY month ORDER BY month`
      ).all<any>();

      // New signups per day (last 30 days)
      const signupRows = await db.prepare(
        `SELECT date(createdAt) as day, COUNT(*) as count
         FROM users WHERE createdAt >= datetime('now', '-30 days')
         GROUP BY day ORDER BY day`
      ).all<any>();

      // User retention: % of users from each weekly cohort who returned within 7 days
      // Cohorts from last 8 weeks
      const retentionRows = await db.prepare(
        `SELECT
           strftime('%Y-W%W', u.createdAt) as cohort,
           COUNT(*) as cohortSize,
           SUM(CASE WHEN u.lastSignedIn > datetime(u.createdAt, '+7 days') THEN 1 ELSE 0 END) as retained7d,
           SUM(CASE WHEN u.lastSignedIn > datetime(u.createdAt, '+30 days') THEN 1 ELSE 0 END) as retained30d
         FROM users u
         WHERE u.createdAt >= datetime('now', '-8 weeks')
         GROUP BY cohort ORDER BY cohort`
      ).all<any>();

      // Matching success rate by month (last 12 months)
      const matchSuccessRows = await db.prepare(
        `SELECT
           strftime('%Y-%m', ms.createdAt) as month,
           COUNT(*) as total,
           SUM(CASE WHEN ms.status='completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN CAST(mr.compatibilityScore AS REAL) >= 70 THEN 1 ELSE 0 END) as highScore,
           AVG(CAST(mr.compatibilityScore AS REAL)) as avgScore
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         WHERE ms.createdAt >= datetime('now', '-12 months')
         GROUP BY month ORDER BY month`
      ).all<any>();

      // Active users today
      const activeToday = (await db.prepare(
        `SELECT COUNT(*) as c FROM users WHERE lastSignedIn >= date('now')`
      ).first<any>())?.c ?? 0;

      // Active users this month
      const activeMonth = (await db.prepare(
        `SELECT COUNT(*) as c FROM users WHERE lastSignedIn >= datetime('now', 'start of month')`
      ).first<any>())?.c ?? 0;

      return {
        overview: { totalUsers, totalMatchings, totalChats, totalMessages, activeToday, activeMonth },
        dau: (dauRows.results ?? []).map((r: any) => ({ day: r.day, count: r.count })),
        mau: (mauRows.results ?? []).map((r: any) => ({ month: r.month, count: r.count })),
        signups: (signupRows.results ?? []).map((r: any) => ({ day: r.day, count: r.count })),
        retention: (retentionRows.results ?? []).map((r: any) => ({
          cohort: r.cohort,
          cohortSize: r.cohortSize,
          retained7d: r.retained7d ?? 0,
          retained30d: r.retained30d ?? 0,
          rate7d: r.cohortSize > 0 ? Math.round(((r.retained7d ?? 0) / r.cohortSize) * 100) : 0,
          rate30d: r.cohortSize > 0 ? Math.round(((r.retained30d ?? 0) / r.cohortSize) * 100) : 0,
        })),
        matchingSuccess: (matchSuccessRows.results ?? []).map((r: any) => ({
          month: r.month,
          total: r.total,
          completed: r.completed ?? 0,
          highScore: r.highScore ?? 0,
          avgScore: Math.round((r.avgScore ?? 0) * 10) / 10,
          successRate: r.total > 0 ? Math.round(((r.highScore ?? 0) / r.total) * 100) : 0,
        })),
      };
    });
  }),

  getLLMUsage: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const days = input?.days ?? 30;
      const rows = await ctx.env.DB.prepare(
        `SELECT provider, model, purpose,
                SUM(promptTokens) as totalPromptTokens,
                SUM(completionTokens) as totalCompletionTokens,
                COUNT(*) as callCount,
                AVG(durationMs) as avgDurationMs
         FROM llm_usage WHERE userId=? AND createdAt > datetime('now', '-' || ? || ' days')
         GROUP BY provider, model, purpose ORDER BY totalPromptTokens DESC`
      ).bind(ctx.userId, days).all();

      const totals = await ctx.env.DB.prepare(
        `SELECT SUM(promptTokens) as totalPromptTokens,
                SUM(completionTokens) as totalCompletionTokens,
                COUNT(*) as totalCalls
         FROM llm_usage WHERE userId=? AND createdAt > datetime('now', '-' || ? || ' days')`
      ).bind(ctx.userId, days).first<any>();

      return {
        breakdown: rows.results || [],
        totals: {
          promptTokens: totals?.totalPromptTokens ?? 0,
          completionTokens: totals?.totalCompletionTokens ?? 0,
          totalCalls: totals?.totalCalls ?? 0,
        },
      };
    }),
});

export const trustRouter = router({
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
});

export const onboardingRouter = router({
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
        // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
        const sets: string[] = [];
        const binds: any[] = [];
        if (input.description) { sets.push("description=?"); binds.push(input.description); }
        if (input.personality) { sets.push("personality=?"); binds.push(input.personality); }
        if (input.rawInput) { sets.push("rawInput=?"); binds.push(input.rawInput); }
        // Clear onboarding system prompt and set a normal one
        sets.push("systemPrompt=?");
        binds.push(null);

        // Auto-generate tags from description + personality keywords
        if (input.description || input.personality) {
          const tagSource = `${input.description || ""} ${input.personality || ""}`;
          const tagWords = tagSource
            .replace(/[、。！？\s,.\n]/g, " ")
            .split(" ")
            .map(w => w.trim())
            .filter(w => w.length >= 2 && w.length <= 20)
            .filter((w, i, arr) => arr.indexOf(w) === i)
            .slice(0, 5);
          if (tagWords.length > 0) {
            sets.push("tags=?");
            binds.push(toJson(tagWords));
          }
        }

        if (sets.length > 0) {
          sets.push("updatedAt=datetime('now')");
          binds.push(twin.id);
          await ctx.env.DB.prepare(`UPDATE digital_twins SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
        }
      }

      // Auto-populate user_profiles from onboarding data
      const user = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      const displayName = user?.name || null;
      const bio = input.description || null;
      // Parse rawInput for company/industry keywords
      let company: string | null = null;
      let industry: string | null = null;
      let position: string | null = null;
      if (input.rawInput) {
        const raw = input.rawInput;
        // Try to extract company (会社/企業/所属)
        const companyMatch = raw.match(/(?:会社|企業|所属|勤務先)[はにで：:]\s*(.+?)(?:[。、\n]|$)/);
        if (companyMatch) company = companyMatch[1].trim().slice(0, 100);
        // Try to extract industry (業界/業種/分野)
        const industryMatch = raw.match(/(?:業界|業種|分野)[はにで：:]\s*(.+?)(?:[。、\n]|$)/);
        if (industryMatch) industry = industryMatch[1].trim().slice(0, 100);
        // Try to extract position (役職/職種/ポジション)
        const positionMatch = raw.match(/(?:役職|職種|ポジション|職業)[はにで：:]\s*(.+?)(?:[。、\n]|$)/);
        if (positionMatch) position = positionMatch[1].trim().slice(0, 100);
      }
      const existingProfile = await ctx.env.DB.prepare(`SELECT id FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      if (existingProfile) {
        await ctx.env.DB.prepare(
          `UPDATE user_profiles SET displayName=COALESCE(?,displayName), bio=COALESCE(?,bio), company=COALESCE(?,company), industry=COALESCE(?,industry), position=COALESCE(?,position), updatedAt=datetime('now') WHERE userId=?`
        ).bind(displayName, bio, company, industry, position, ctx.userId).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO user_profiles (userId, displayName, bio, company, industry, position) VALUES (?,?,?,?,?,?)`
        ).bind(ctx.userId, displayName, bio, company, industry, position).run();
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
});
