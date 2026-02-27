import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, getMyTwin, normalizeTwin } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { createNotification } from "../notifications";

export const friendsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB
      .prepare(`SELECT f.id as fshipId, f.status as fshipStatus, f.createdAt as fshipCreatedAt,
        u.id as fId, u.name as fName, u.email as fEmail, u.friendCode as fFriendCode, u.isNpc as fIsNpc,
        dt.id as twinId, dt.name as twinName, dt.description as twinDesc, dt.personality as twinPersonality,
        dt.isPublic as twinIsPublic, dt.tags as twinTags, dt.systemPrompt as twinSystemPrompt,
        dt.bigFiveTraits as twinBigFive, dt.mbtiType as twinMbti
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END
        LEFT JOIN digital_twins dt ON dt.userId = u.id
        WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
      .bind(ctx.userId, ctx.userId, ctx.userId)
      .all<any>();
    return (rows.results ?? []).map(r => ({
      friendship: { id: r.fshipId, status: r.fshipStatus, createdAt: r.fshipCreatedAt },
      friend: { id: r.fId, name: r.fName, email: r.fEmail, friendCode: r.fFriendCode, isNpc: r.fIsNpc === 1 },
      twin: r.twinId ? normalizeTwin({
        id: r.twinId, name: r.twinName, description: r.twinDesc, personality: r.twinPersonality,
        isPublic: r.twinIsPublic, tags: r.twinTags, systemPrompt: r.twinSystemPrompt,
        bigFiveTraits: r.twinBigFive, mbtiType: r.twinMbti, userId: r.fId,
      }) : null,
    }));
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

      // Enforce maxFriends plan limit
      const userRow = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      const userPlan = userRow?.plan || "free";
      const maxFriendsMap: Record<string, number> = { free: 5, premium: 50, enterprise: -1 };
      const maxFriends = maxFriendsMap[userPlan] ?? 5;
      if (maxFriends !== -1) {
        const friendCount = (await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
        ).bind(ctx.userId, ctx.userId).first<any>())?.c ?? 0;
        if (friendCount >= maxFriends) {
          throw new TRPCError({ code: "FORBIDDEN", message: `友達上限（${maxFriends}人）に達しました。プランをアップグレードしてください。` });
        }
      }

      const friend = await ctx.env.DB.prepare(`SELECT * FROM users WHERE friendCode=?`).bind(input.friendCode.toUpperCase()).first<any>();
      if (!friend) throw new TRPCError({ code: "NOT_FOUND", message: "ユーザーが見つかりません" });
      if (friend.id === ctx.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分にはリクエストを送れません" });
      const res = await ctx.env.DB.prepare(`INSERT INTO friendships (userId, friendId, status) VALUES (?,?,'pending')`).bind(ctx.userId, friend.id).run();
      // Notify receiver
      const senderName = ctx.user?.name || "ユーザー";
      await createNotification(ctx.env.DB, friend.id, "friend_request", "友達リクエスト", `${senderName}さんから友達リクエストが届きました`, { link: "/friends" });
      return { id: Number(res.meta.last_row_id) };
    }),
  acceptRequest: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const req = await ctx.env.DB.prepare(`SELECT userId FROM friendships WHERE id=? AND friendId=?`).bind(input.requestId, ctx.userId).first<any>();
      await ctx.env.DB.prepare(`UPDATE friendships SET status='accepted', updatedAt=datetime('now') WHERE id=? AND friendId=?`).bind(input.requestId, ctx.userId).run();
      // Notify sender that request was accepted
      if (req?.userId) {
        const accepterName = ctx.user?.name || "ユーザー";
        await createNotification(ctx.env.DB, req.userId, "friend_accepted", "友達リクエスト承認", `${accepterName}さんが友達リクエストを承認しました`, { link: "/friends" });
      }
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

  // ===== Enhanced Intimacy System =====

  /** Get waveform comparison: self vs others' perspective + gap */
  getWaveformComparison: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return { hasSelf: false, selfWaveform: null, othersWaveform: null, gap: null, evaluators: [] as any[] };

    // Self waveform
    const selfWave = await ctx.env.DB.prepare(
      `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
    ).bind(ctx.userId, twin.id).first<any>();
    const selfData = selfWave ? (parseJson<any>(selfWave.waveformData) ?? null) : null;

    // Others' perspective: aggregate per evaluator twin
    const otherPerspectives = await ctx.env.DB.prepare(
      `SELECT opw.evaluatorTwinId, dt.name as evaluatorName, dt.userId as evaluatorUserId,
              AVG(opw.virtueScore) as avgVirtue, AVG(opw.mineScore) as avgMine, COUNT(*) as evalCount
       FROM other_perspective_waveforms opw
       LEFT JOIN digital_twins dt ON dt.id = opw.evaluatorTwinId
       WHERE opw.userId=? AND opw.twinId=?
       GROUP BY opw.evaluatorTwinId`
    ).bind(ctx.userId, twin.id).all<any>();

    const evaluators = (otherPerspectives.results ?? []).map((e: any) => ({
      twinId: e.evaluatorTwinId,
      name: e.evaluatorName || "不明",
      userId: e.evaluatorUserId,
      avgVirtue: Math.round(e.avgVirtue ?? 50),
      avgMine: Math.round(e.avgMine ?? 50),
      evalCount: e.evalCount ?? 0,
    }));

    // Overall others' average
    const totalVirtue = evaluators.length > 0 ? Math.round(evaluators.reduce((s: number, e: any) => s + e.avgVirtue, 0) / evaluators.length) : null;
    const totalMine = evaluators.length > 0 ? Math.round(evaluators.reduce((s: number, e: any) => s + e.avgMine, 0) / evaluators.length) : null;
    const othersWaveform = totalVirtue !== null ? { virtue: totalVirtue, mine: totalMine } : null;

    // Gap calculation
    let gap = null;
    if (selfData && othersWaveform) {
      const virtueGap = selfData.virtue - othersWaveform.virtue;
      const mineGap = selfData.mine - (othersWaveform.mine ?? 50);
      const totalGap = Math.abs(virtueGap) + Math.abs(mineGap);
      gap = {
        virtueGap,
        mineGap,
        totalGap: Math.round(totalGap),
        gapLevel: totalGap < 10 ? "excellent" : totalGap < 25 ? "good" : totalGap < 50 ? "moderate" : "significant",
        gapLabel: totalGap < 10 ? "自己認識が非常に正確" : totalGap < 25 ? "自己認識が良好" : totalGap < 50 ? "やや乖離あり" : "大きな乖離あり",
      };
    }

    return { hasSelf: !!selfData, selfWaveform: selfData, othersWaveform, gap, evaluators };
  }),

  /** Friend's twin predicts how user would answer a scenario */
  predictFriendResponse: protectedProcedure
    .input(z.object({
      friendUserId: z.number(),
      scenarioId: z.string(),
      scenarioText: z.string(),
      scenarioCategory: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { success: false, prediction: null };

      const friendTwin = await ctx.env.DB.prepare(
        `SELECT * FROM digital_twins WHERE userId=? LIMIT 1`
      ).bind(input.friendUserId).first<any>();
      if (!friendTwin) return { success: false, prediction: null };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { success: false, prediction: null };

      // Get user's profile for context
      const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

      try {
        const result = await invokeLLM(llmConfig, [{
          role: "system",
          content: `あなたは「${friendTwin.name || "友達の分身AI"}」です。
性格: ${friendTwin.personality || "不明"}
あなたの友達（${profile?.displayName || "ユーザー"}）のことをよく知っています。
相手がこのシナリオにどう答えるか予測してください。`,
        }, {
          role: "user",
          content: `シナリオ（${input.scenarioCategory || "価値観"}）: ${input.scenarioText}

あなたの友達なら、このシナリオにどう答えると思いますか？
JSON形式で出力:
{
  "predictedResponse": "予測される回答（1-3文）",
  "predictedVirtueScore": 0-100の数値（利他的な度合い）,
  "predictedMineScore": 0-100の数値（自己中心的な度合い）,
  "confidence": 0-100の数値（予測の自信度）,
  "reasoning": "この予測の根拠"
}`,
        }], { maxTokens: 512 });

        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const pred = JSON.parse(jsonMatch[0]);
          // Save prediction to other_perspective_waveforms
          await ctx.env.DB.prepare(
            `INSERT INTO other_perspective_waveforms (userId, twinId, evaluatorTwinId, scenarioId, virtueScore, mineScore, comment)
             VALUES (?,?,?,?,?,?,?)`
          ).bind(
            ctx.userId, twin.id, friendTwin.id, input.scenarioId,
            pred.predictedVirtueScore ?? 50, pred.predictedMineScore ?? 50,
            toJson({ prediction: pred.predictedResponse, confidence: pred.confidence, reasoning: pred.reasoning })
          ).run();

          return {
            success: true,
            prediction: {
              predictedResponse: pred.predictedResponse || "",
              predictedVirtueScore: pred.predictedVirtueScore ?? 50,
              predictedMineScore: pred.predictedMineScore ?? 50,
              confidence: pred.confidence ?? 50,
              reasoning: pred.reasoning || "",
              evaluatorTwinName: friendTwin.name || "友達のAI",
            },
          };
        }
      } catch { /* best effort */ }
      return { success: false, prediction: null };
    }),

  /** Compare prediction vs actual answer, compute accuracy, update intimacy */
  comparePredictions: protectedProcedure
    .input(z.object({ friendUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return { totalPredictions: 0, correctPredictions: 0, accuracy: 0 };

      const friendTwin = await ctx.env.DB.prepare(
        `SELECT id FROM digital_twins WHERE userId=? LIMIT 1`
      ).bind(input.friendUserId).first<any>();
      if (!friendTwin) return { totalPredictions: 0, correctPredictions: 0, accuracy: 0 };

      // Get predictions by this friend's twin
      const predictions = await ctx.env.DB.prepare(
        `SELECT opw.scenarioId, opw.virtueScore as predVirtue, opw.mineScore as predMine
         FROM other_perspective_waveforms opw
         WHERE opw.userId=? AND opw.twinId=? AND opw.evaluatorTwinId=?`
      ).bind(ctx.userId, twin.id, friendTwin.id).all<any>();

      // Get actual responses
      const responses = await ctx.env.DB.prepare(
        `SELECT scenarioId, virtueScore, mineScore FROM value_scenario_responses
         WHERE userId=? AND twinId=? AND evaluation IS NOT NULL`
      ).bind(ctx.userId, twin.id).all<any>();

      const actualMap = new Map<string, { virtue: number; mine: number }>();
      for (const r of responses.results ?? []) {
        if (r.virtueScore != null) actualMap.set(r.scenarioId, { virtue: r.virtueScore, mine: r.mineScore ?? 50 });
      }

      let totalPredictions = 0;
      let correctPredictions = 0;
      for (const p of predictions.results ?? []) {
        const actual = actualMap.get(p.scenarioId);
        if (!actual) continue;
        totalPredictions++;
        // "Correct" if both virtue and mine scores are within 20 points
        const virtueDiff = Math.abs((p.predVirtue ?? 50) - actual.virtue);
        const mineDiff = Math.abs((p.predMine ?? 50) - actual.mine);
        if (virtueDiff <= 20 && mineDiff <= 20) correctPredictions++;
      }

      const accuracy = totalPredictions > 0 ? Math.round((correctPredictions / totalPredictions) * 100) : 0;

      // Update intimacy_scores with prediction data
      const matchings = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId=? AND (twin1Id IN (SELECT id FROM digital_twins WHERE userId=?) OR twin2Id IN (SELECT id FROM digital_twins WHERE userId=?))`
      ).bind(ctx.userId, input.friendUserId, input.friendUserId).first<any>();
      const chatMsgs = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM chat_messages cm
         JOIN chat_sessions cs ON cs.id = cm.sessionId
         WHERE cs.userId=? AND cm.twinId IN (SELECT id FROM digital_twins WHERE userId=?)`
      ).bind(ctx.userId, input.friendUserId).first<any>();

      const msgCount = (chatMsgs?.c ?? 0) + (matchings?.c ?? 0) * 10;
      // Intimacy: 40% conversation volume + 30% prediction accuracy + 30% interaction count
      const volumeScore = Math.min(msgCount / 100 * 40, 40);
      const accuracyScore = accuracy * 0.3;
      const interactionScore = Math.min((matchings?.c ?? 0) * 10, 30);
      const intimacyScore = Math.round(volumeScore + accuracyScore + interactionScore);

      const levels = [
        { min: 0, level: "stranger", label: "見知らぬ人" },
        { min: 20, level: "acquaintance", label: "知り合い" },
        { min: 40, level: "friend", label: "友達" },
        { min: 60, level: "close_friend", label: "親しい友人" },
        { min: 80, level: "best_friend", label: "親友" },
      ] as const;
      const levelInfo = [...levels].reverse().find(l => intimacyScore >= l.min) ?? levels[0];

      // Upsert
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM intimacy_scores WHERE userId=? AND friendId=?`
      ).bind(ctx.userId, input.friendUserId).first<any>();
      if (existing) {
        await ctx.env.DB.prepare(
          `UPDATE intimacy_scores SET totalMessageCount=?, totalPredictions=?, correctPredictions=?, predictionAccuracy=?, intimacyScore=?, intimacyLevel=?, updatedAt=datetime('now') WHERE id=?`
        ).bind(msgCount, totalPredictions, correctPredictions, accuracy, intimacyScore, levelInfo.level, existing.id).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO intimacy_scores (userId, friendId, totalMessageCount, totalPredictions, correctPredictions, predictionAccuracy, intimacyScore, intimacyLevel) VALUES (?,?,?,?,?,?,?,?)`
        ).bind(ctx.userId, input.friendUserId, msgCount, totalPredictions, correctPredictions, accuracy, intimacyScore, levelInfo.level).run();
      }

      return { totalPredictions, correctPredictions, accuracy, intimacyScore, intimacyLevel: levelInfo.level, intimacyLevelLabel: levelInfo.label };
    }),

  /** Full intimacy dashboard data: all friends with intimacy + waveform gaps */
  getIntimacyDashboard: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return { friends: [] as any[] };

    // Get all friends
    const friendships = await ctx.env.DB.prepare(
      `SELECT CASE WHEN userId=? THEN friendId ELSE userId END as fId
       FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
    ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();

    // Get my self waveform
    const selfWave = await ctx.env.DB.prepare(
      `SELECT waveformData FROM cumulative_waveforms WHERE userId=? AND twinId=? AND waveformType='self'`
    ).bind(ctx.userId, twin.id).first<any>();
    const selfData = selfWave ? (parseJson<any>(selfWave.waveformData) ?? { virtue: 50, mine: 50 }) : null;

    const friends: any[] = [];
    for (const f of friendships.results ?? []) {
      const friendUser = await ctx.env.DB.prepare(`SELECT id, name FROM users WHERE id=?`).bind(f.fId).first<any>();
      const friendTwin = await ctx.env.DB.prepare(`SELECT id, name FROM digital_twins WHERE userId=? LIMIT 1`).bind(f.fId).first<any>();
      const intimacy = await ctx.env.DB.prepare(`SELECT * FROM intimacy_scores WHERE userId=? AND friendId=?`).bind(ctx.userId, f.fId).first<any>();

      // Get this friend's twin's perspective on me
      let friendPerspective = null;
      if (friendTwin) {
        const avg = await ctx.env.DB.prepare(
          `SELECT AVG(virtueScore) as v, AVG(mineScore) as m, COUNT(*) as c
           FROM other_perspective_waveforms WHERE userId=? AND twinId=? AND evaluatorTwinId=?`
        ).bind(ctx.userId, twin.id, friendTwin.id).first<any>();
        if (avg && avg.c > 0) {
          friendPerspective = { virtue: Math.round(avg.v ?? 50), mine: Math.round(avg.m ?? 50), evalCount: avg.c };
        }
      }

      // Calculate gap between self and this friend's perspective
      let gap = null;
      if (selfData && friendPerspective) {
        gap = {
          virtueGap: Math.round(selfData.virtue - friendPerspective.virtue),
          mineGap: Math.round(selfData.mine - friendPerspective.mine),
        };
      }

      const levels = [
        { min: 0, level: "stranger", label: "見知らぬ人" },
        { min: 20, level: "acquaintance", label: "知り合い" },
        { min: 40, level: "friend", label: "友達" },
        { min: 60, level: "close_friend", label: "親しい友人" },
        { min: 80, level: "best_friend", label: "親友" },
      ] as const;
      const lvl = [...levels].reverse().find(l => (intimacy?.intimacyScore ?? 0) >= l.min) ?? levels[0];

      friends.push({
        friendId: f.fId,
        friendName: friendUser?.name || "不明",
        twinName: friendTwin?.name || null,
        intimacyScore: intimacy?.intimacyScore ?? 0,
        intimacyLevel: intimacy?.intimacyLevel ?? "stranger",
        intimacyLevelLabel: lvl.label,
        predictionAccuracy: intimacy?.predictionAccuracy ?? null,
        totalPredictions: intimacy?.totalPredictions ?? 0,
        totalMessageCount: intimacy?.totalMessageCount ?? 0,
        friendPerspective,
        gap,
      });
    }

    // Sort by intimacy score descending
    friends.sort((a, b) => b.intimacyScore - a.intimacyScore);

    return {
      friends,
      selfWaveform: selfData,
    };
  }),
});
