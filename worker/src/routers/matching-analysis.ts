import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { createNotification } from "../notifications";

export const matchingAnalysisRouter = router({
  recommendations: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!myTwin) return { recommendations: [], insights: null };

    // Get all completed matching results with details
    const completedResults = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, ms.twin1Id, ms.twin2Id, ms.createdAt,
        mr.compatibilityScore, mr.summary, mr.strengths, mr.challenges, mr.scoreBreakdown,
        t1.name as t1Name, t1.tags as t1Tags, t1.personality as t1Personality,
        t2.name as t2Name, t2.tags as t2Tags, t2.personality as t2Personality,
        u1.id as u1Id, u1.name as u1Name, u2.id as u2Id, u2.name as u2Name,
        up1.industry as u1Industry, up2.industry as u2Industry
      FROM matching_sessions ms
      JOIN matching_results mr ON mr.sessionId = ms.id
      LEFT JOIN digital_twins t1 ON t1.id = ms.twin1Id
      LEFT JOIN digital_twins t2 ON t2.id = ms.twin2Id
      LEFT JOIN users u1 ON u1.id = t1.userId
      LEFT JOIN users u2 ON u2.id = t2.userId
      LEFT JOIN user_profiles up1 ON up1.userId = u1.id
      LEFT JOIN user_profiles up2 ON up2.userId = u2.id
      WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
      ORDER BY mr.compatibilityScore DESC`
    ).bind(ctx.userId).all<any>();

    const results = completedResults.results ?? [];
    if (results.length === 0) return { recommendations: [], insights: null };

    // Analyze patterns from successful matches (score >= 60)
    const successfulMatches = results.filter(r => r.compatibilityScore >= 60);
    const allScores = results.map(r => r.compatibilityScore);
    const avgScore = Math.round(allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length);

    // Extract tags from successful matches
    const successTags: Record<string, number> = {};
    const successIndustries: Record<string, number> = {};
    for (const r of successfulMatches) {
      const partnerTags = r.twin1Id === myTwin.id ? r.t2Tags : r.t1Tags;
      const partnerIndustry = r.twin1Id === myTwin.id ? r.u2Industry : r.u1Industry;
      if (partnerTags) {
        try {
          const tags = JSON.parse(partnerTags) as string[];
          tags.forEach(t => { successTags[t] = (successTags[t] || 0) + 1; });
        } catch {}
      }
      if (partnerIndustry) {
        successIndustries[partnerIndustry] = (successIndustries[partnerIndustry] || 0) + 1;
      }
    }

    // Get friends not yet matched or with low match count
    const friendRows = await ctx.env.DB.prepare(
      `SELECT u.id as fId, u.name as fName, u.isNpc as fIsNpc,
        dt.id as twinId, dt.name as twinName, dt.description as twinDesc,
        dt.personality as twinPersonality, dt.tags as twinTags, dt.bigFiveTraits as twinBigFive,
        up.industry as fIndustry, up.company as fCompany, up.skills as fSkills
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END
      LEFT JOIN digital_twins dt ON dt.userId = u.id
      LEFT JOIN user_profiles up ON up.userId = u.id
      WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted' AND dt.id IS NOT NULL`
    ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();

    // Score each friend based on pattern matching
    const recs: Array<{
      friendId: number; friendName: string; twinName: string; twinDescription: string | null;
      score: number; reasons: string[]; industry: string | null; tags: string[];
      matchHistory: { count: number; bestScore: number | null; lastTheme: string | null };
    }> = [];

    for (const f of friendRows.results ?? []) {
      const matchHistory = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt, MAX(mr.compatibilityScore) as best, ms.theme as lastTheme
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         WHERE ms.initiatorUserId=? AND (ms.twin1Id=? OR ms.twin2Id=?)
         ORDER BY ms.createdAt DESC`
      ).bind(ctx.userId, f.twinId, f.twinId).first<any>();

      let recScore = 50;
      const reasons: string[] = [];
      const fTags: string[] = f.twinTags ? (JSON.parse(f.twinTags) as string[] ?? []) : [];

      // Tag overlap with successful patterns
      let tagOverlap = 0;
      for (const tag of fTags) {
        if (successTags[tag]) {
          tagOverlap += successTags[tag];
        }
      }
      if (tagOverlap > 0) {
        recScore += Math.min(tagOverlap * 5, 20);
        reasons.push("過去の成功マッチングと共通のタグがあります");
      }

      // Industry match with successful patterns
      if (f.fIndustry && successIndustries[f.fIndustry]) {
        recScore += Math.min(successIndustries[f.fIndustry] * 5, 15);
        reasons.push(`${f.fIndustry}業界との相性が高い傾向です`);
      }

      // Profile completeness bonus
      if (f.twinDesc) recScore += 3;
      if (f.twinPersonality) recScore += 3;
      if (fTags.length > 0) recScore += Math.min(fTags.length * 2, 6);
      if (f.twinBigFive) recScore += 3;
      if (f.fSkills) recScore += 2;

      // Prefer unmatched or less-matched friends
      const matchCount = matchHistory?.cnt ?? 0;
      if (matchCount === 0) {
        recScore += 10;
        reasons.push("まだマッチングしていない相手です");
      } else if (matchCount < 3) {
        recScore += 5;
        reasons.push("マッチング回数が少なく、新しいテーマで試す価値があります");
      }

      // If best previous score was high, boost
      if (matchHistory?.best && matchHistory.best >= 70) {
        recScore += 10;
        reasons.push(`過去のマッチングで${matchHistory.best}%の高スコアを記録しています`);
      }

      recScore = Math.min(recScore, 99);

      if (reasons.length === 0) reasons.push("プロフィール情報に基づく推薦です");

      recs.push({
        friendId: f.fId,
        friendName: f.fName,
        twinName: f.twinName,
        twinDescription: f.twinDesc,
        score: Math.round(recScore),
        reasons,
        industry: f.fIndustry,
        tags: fTags,
        matchHistory: {
          count: matchCount,
          bestScore: matchHistory?.best ?? null,
          lastTheme: matchHistory?.lastTheme ?? null,
        },
      });
    }

    recs.sort((a, b) => b.score - a.score);

    // Generate AI insights if enough data (3+ completed matchings)
    let insights: { summary: string; topPattern: string; suggestion: string } | null = null;
    if (results.length >= 3) {
      try {
        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
        if (llmConfig) {
          const topTags = Object.entries(successTags).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
          const topIndustries = Object.entries(successIndustries).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => i);
          const aiResult = await invokeLLM(llmConfig, [
            { role: "system", content: "あなたはビジネスマッチングアドバイザーです。ユーザーのマッチング傾向を分析して簡潔なインサイトを提供してください。" },
            { role: "user", content: `過去${results.length}回のマッチング結果:
平均スコア: ${avgScore}%
成功(60%+): ${successfulMatches.length}回
成功パターンのタグ: ${topTags.join(", ") || "なし"}
成功パターンの業界: ${topIndustries.join(", ") || "なし"}
最高スコア: ${Math.max(...allScores)}%

JSON形式で回答: {"summary": "傾向の要約(50文字)", "topPattern": "最も相性の良いパターン(30文字)", "suggestion": "次のマッチングへの提案(50文字)"}` },
          ], { maxTokens: 256, temperature: 0.3 });
          const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) insights = JSON.parse(jsonMatch[0]);
        }
      } catch {}
    }

    return {
      recommendations: recs.slice(0, 10),
      insights,
      stats: { totalMatchings: results.length, avgScore, successCount: successfulMatches.length },
    };
  }),

  // ============ Spectator: AI Commentary ============
  generateCommentary: protectedProcedure
    .input(z.object({ sessionId: z.number(), turnNumber: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      // Get dialogue up to this turn
      const dialogues = await ctx.env.DB.prepare(
        `SELECT md.*, dt.name as speakerName FROM matching_dialogues md
         LEFT JOIN digital_twins dt ON dt.id = md.speakerTwinId
         WHERE md.sessionId=? AND md.turnNumber<=? ORDER BY md.turnNumber ASC`
      ).bind(input.sessionId, input.turnNumber).all<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) return { commentary: "解説AI: LLM APIキーが未設定です" };

      const dialogueText = (dialogues.results ?? []).map((d: any) =>
        `[ターン${d.turnNumber}] ${d.speakerName || "Twin"}: ${(d.content || "").slice(0, 200)}`
      ).join("\n");

      const result = await invokeLLM(llmConfig, [
        {
          role: "system",
          content: `あなたはビジネスマッチング対話の解説者です。観戦者向けに、各ターンの注目ポイント、交渉テクニック、ビジネス戦略の見どころを簡潔に解説してください。\nフレンドリーなトーンで、3-4文で解説してください。日本語で回答。`,
        },
        { role: "user", content: `テーマ: ${session.theme}\n\n${dialogueText}\n\n最新ターン(${input.turnNumber})について解説してください。` },
      ], { maxTokens: 300, temperature: 0.7 });

      return { commentary: result.content, turnNumber: input.turnNumber };
    }),

  // Get spectator reaction summary for a session
  getSpectatorReactions: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT turnNumber, type, COUNT(*) as count
         FROM matching_reactions WHERE sessionId=?
         GROUP BY turnNumber, type ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      // Group by turn
      const byTurn: Record<number, Record<string, number>> = {};
      for (const r of rows.results ?? []) {
        if (!byTurn[r.turnNumber]) byTurn[r.turnNumber] = {};
        byTurn[r.turnNumber][r.type] = r.count;
      }
      return byTurn;
    }),

  // ============ AI Matching Prediction Engine ============
  predictScore: protectedProcedure.input(z.object({
    friendId: z.number(),
    theme: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    // Get both twins
    const myTwin = await db.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=?`).bind(ctx.userId).first<any>();
    const friendTwin = await db.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=?`).bind(input.friendId).first<any>();
    if (!myTwin || !friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // Gather historical matching data between these two users
    const pastMatchings = await db.prepare(
      `SELECT ms.theme, mr.compatibilityScore, mr.scoreBreakdown, mr.summary
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId = ? AND ms.twin2Id = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt DESC LIMIT 10`
    ).bind(ctx.userId, friendTwin.id).all<any>();

    // Also get matches where friend was initiator
    const pastMatchings2 = await db.prepare(
      `SELECT ms.theme, mr.compatibilityScore, mr.scoreBreakdown, mr.summary
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId = ? AND ms.twin2Id = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt DESC LIMIT 10`
    ).bind(input.friendId, myTwin.id).all<any>();

    const allPast = [...(pastMatchings.results ?? []), ...(pastMatchings2.results ?? [])];

    // Get profiles
    const myProfile = await db.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
    const friendProfile = await db.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(input.friendId).first<any>();

    // Get personality profiles
    const myPersonality = await db.prepare(`SELECT * FROM personality_profiles WHERE userId=? AND status='completed'`).bind(ctx.userId).first<any>();
    const friendPersonality = await db.prepare(`SELECT * FROM personality_profiles WHERE userId=? AND status='completed'`).bind(input.friendId).first<any>();

    // Get waveform data
    const myWaveform = await db.prepare(`SELECT * FROM cumulative_waveforms WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    const friendWaveform = await db.prepare(`SELECT * FROM cumulative_waveforms WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();

    // Get intimacy score
    const intimacy = await db.prepare(`SELECT * FROM intimacy_scores WHERE userId=? AND friendId=?`).bind(ctx.userId, input.friendId).first<any>();

    // Build prediction context
    const pastScores = allPast.map((p: any) => `テーマ「${p.theme}」: ${p.compatibilityScore}点`).join(", ");
    const avgPastScore = allPast.length > 0 ? Math.round(allPast.reduce((sum: number, p: any) => sum + (p.compatibilityScore || 0), 0) / allPast.length) : null;

    // Get user's overall average score
    const overallAvg = await db.prepare(
      `SELECT AVG(mr.compatibilityScore) as avg FROM matching_sessions ms JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.initiatorUserId=? AND ms.status='completed'`
    ).bind(ctx.userId).first<any>();

    const llmConfig = await getUserLLMConfig(db, ctx.userId, "matching", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM APIキーが未設定です" });

    const prompt = `あなたはビジネスマッチングの予測AIです。以下のデータに基づいて、マッチング実行前にスコアを予測してください。

## ユーザー1（自分）
- 名前: ${myTwin.name || "ユーザー1"}
- 人格: ${myTwin.personality || "未設定"}
- 説明: ${myTwin.description || "未設定"}
${myProfile ? `- 会社: ${myProfile.company || "?"}, 業界: ${myProfile.industry || "?"}, 役職: ${myProfile.position || "?"}` : ""}
${myProfile?.skills ? `- スキル: ${myProfile.skills}` : ""}
${myPersonality?.bigFive ? `- Big Five: ${myPersonality.bigFive}` : ""}
${myPersonality?.mbti ? `- MBTI: ${myPersonality.mbti}` : ""}
${myWaveform ? `- 波形データ: 美徳${myWaveform.totalVirtueCount} / 利己${myWaveform.totalMineCount} / 中立${myWaveform.totalNeutralCount}` : ""}

## ユーザー2（相手）
- 名前: ${friendTwin.name || "ユーザー2"}
- 人格: ${friendTwin.personality || "未設定"}
- 説明: ${friendTwin.description || "未設定"}
${friendProfile ? `- 会社: ${friendProfile.company || "?"}, 業界: ${friendProfile.industry || "?"}, 役職: ${friendProfile.position || "?"}` : ""}
${friendProfile?.skills ? `- スキル: ${friendProfile.skills}` : ""}
${friendPersonality?.bigFive ? `- Big Five: ${friendPersonality.bigFive}` : ""}
${friendPersonality?.mbti ? `- MBTI: ${friendPersonality.mbti}` : ""}
${friendWaveform ? `- 波形データ: 美徳${friendWaveform.totalVirtueCount} / 利己${friendWaveform.totalMineCount} / 中立${friendWaveform.totalNeutralCount}` : ""}

## 過去のマッチング履歴
${allPast.length > 0 ? `- 過去${allPast.length}回のマッチング: ${pastScores}` : "- 過去のマッチング履歴なし"}
${avgPastScore !== null ? `- 平均スコア: ${avgPastScore}点` : ""}
${overallAvg?.avg ? `- ユーザー1の全体平均: ${Math.round(overallAvg.avg)}点` : ""}
${intimacy ? `- 親密度スコア: ${intimacy.intimacyScore} (${intimacy.intimacyLevel})` : ""}

## 新しいマッチングのテーマ
「${input.theme}」

以下のJSON形式で予測結果を返してください:
{
  "predictedScore": (0-100の整数),
  "confidence": (0-100の整数、予測の確信度),
  "reasoning": "予測の根拠（200文字以内）",
  "breakdown": {
    "skillMatch": (0-20),
    "valueAlignment": (0-20),
    "communicationStyle": (0-20),
    "businessGoalFit": (0-20),
    "complementaryStrengths": (0-20)
  },
  "tips": ["スコアを上げるためのヒント1", "ヒント2"]
}
JSONのみ出力してください。`;

    let prediction: any = null;
    try {
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネスマッチングの予測AI専門家です。過去のデータと人格プロファイルに基づいて正確な予測を行います。" },
        { role: "user", content: prompt },
      ], { maxTokens: 1024, temperature: 0.4 });

      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) prediction = JSON.parse(jsonMatch[0]);
    } catch { /* LLM failed */ }

    if (!prediction || typeof prediction.predictedScore !== "number") {
      // Fallback: statistical prediction
      const baseScore = avgPastScore ?? (overallAvg?.avg ? Math.round(overallAvg.avg) : 65);
      prediction = {
        predictedScore: baseScore,
        confidence: allPast.length >= 3 ? 70 : 40,
        reasoning: allPast.length > 0
          ? `過去${allPast.length}回のマッチング平均(${avgPastScore}点)に基づく統計的予測です。`
          : "過去のマッチングデータが少ないため、統計的な推定値です。",
        breakdown: { skillMatch: Math.round(baseScore / 5), valueAlignment: Math.round(baseScore / 5), communicationStyle: Math.round(baseScore / 5), businessGoalFit: Math.round(baseScore / 5), complementaryStrengths: Math.round(baseScore / 5) },
        tips: ["プロフィールを充実させるとより正確な予測が可能になります", "過去のマッチングデータが増えると予測精度が向上します"],
      };
    }

    // Clamp score
    prediction.predictedScore = Math.max(0, Math.min(100, Math.round(prediction.predictedScore)));

    // Save prediction to DB
    const res = await db.prepare(
      `INSERT INTO matching_predictions (userId, friendId, theme, predictedScore, predictedBreakdown, reasoning) VALUES (?,?,?,?,?,?)`
    ).bind(ctx.userId, input.friendId, input.theme, prediction.predictedScore, toJson(prediction.breakdown), prediction.reasoning || "").run();

    return {
      id: Number(res.meta.last_row_id),
      predictedScore: prediction.predictedScore,
      confidence: prediction.confidence ?? 50,
      reasoning: prediction.reasoning || "",
      breakdown: prediction.breakdown || null,
      tips: prediction.tips || [],
      pastMatchCount: allPast.length,
      avgPastScore,
    };
  }),
  resolvePrediction: protectedProcedure.input(z.object({
    predictionId: z.number(),
    sessionId: z.number(),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    const pred = await db.prepare(`SELECT * FROM matching_predictions WHERE id=? AND userId=?`).bind(input.predictionId, ctx.userId).first<any>();
    if (!pred) throw new TRPCError({ code: "NOT_FOUND" });
    if (pred.resolvedAt) return { alreadyResolved: true, accuracy: pred.accuracy };

    const result = await db.prepare(`SELECT compatibilityScore FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "マッチング結果がまだありません" });

    const actualScore = result.compatibilityScore ?? 0;
    const diff = Math.abs(pred.predictedScore - actualScore);
    const accuracy = Math.max(0, 100 - diff);

    await db.prepare(
      `UPDATE matching_predictions SET actualScore=?, actualSessionId=?, accuracy=?, resolvedAt=datetime('now') WHERE id=?`
    ).bind(actualScore, input.sessionId, accuracy, input.predictionId).run();

    return { predictedScore: pred.predictedScore, actualScore, accuracy, diff };
  }),
  getPredictions: protectedProcedure.input(z.object({
    friendId: z.number().optional(),
    limit: z.number().optional(),
  })).query(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    let sql = `SELECT mp.*, u.name as friendName FROM matching_predictions mp LEFT JOIN users u ON u.id=mp.friendId WHERE mp.userId=?`;
    const params: any[] = [ctx.userId];
    if (input.friendId) { sql += ` AND mp.friendId=?`; params.push(input.friendId); }
    sql += ` ORDER BY mp.createdAt DESC LIMIT ?`;
    params.push(input.limit ?? 20);
    const rows = await ctx.env.DB.prepare(sql).bind(...params).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      predictedBreakdown: parseJson<any>(r.predictedBreakdown),
    }));
  }),
  getPredictionAccuracy: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    // Overall accuracy stats
    const stats = await db.prepare(
      `SELECT COUNT(*) as total, COUNT(resolvedAt) as resolved, AVG(CASE WHEN resolvedAt IS NOT NULL THEN accuracy END) as avgAccuracy, MIN(CASE WHEN resolvedAt IS NOT NULL THEN accuracy END) as minAccuracy, MAX(CASE WHEN resolvedAt IS NOT NULL THEN accuracy END) as maxAccuracy FROM matching_predictions WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    // Recent predictions with accuracy
    const recent = await db.prepare(
      `SELECT mp.id, mp.friendId, mp.theme, mp.predictedScore, mp.actualScore, mp.accuracy, mp.createdAt, mp.resolvedAt, u.name as friendName FROM matching_predictions mp LEFT JOIN users u ON u.id=mp.friendId WHERE mp.userId=? AND mp.resolvedAt IS NOT NULL ORDER BY mp.resolvedAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();

    // Accuracy trend (last 20 resolved predictions)
    const trend = await db.prepare(
      `SELECT accuracy, resolvedAt FROM matching_predictions WHERE userId=? AND resolvedAt IS NOT NULL ORDER BY resolvedAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    return {
      totalPredictions: stats?.total ?? 0,
      resolvedPredictions: stats?.resolved ?? 0,
      avgAccuracy: stats?.avgAccuracy ? Math.round(stats.avgAccuracy) : null,
      minAccuracy: stats?.minAccuracy ? Math.round(stats.minAccuracy) : null,
      maxAccuracy: stats?.maxAccuracy ? Math.round(stats.maxAccuracy) : null,
      recentResolved: recent.results ?? [],
      accuracyTrend: (trend.results ?? []).reverse(),
    };
  }),

  // ============ Matching Insights AI ============
  generateInsights: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    const llmConfig = await getUserLLMConfig(db, ctx.userId, "analysis", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM APIキーが必要です" });

    // Gather all matching data
    const matches = await db.prepare(
      `SELECT ms.id, ms.theme, ms.createdAt, mr.compatibilityScore, mr.summary, mr.scoreBreakdown,
        dt2.name as partnerTwinName, dt2.userId as partnerUserId, u2.name as partnerName
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       LEFT JOIN digital_twins dt2 ON dt2.id = ms.twin2Id
       LEFT JOIN users u2 ON u2.id = dt2.userId
       WHERE ms.initiatorUserId=? AND ms.status='completed'
       ORDER BY ms.createdAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();

    const matchData = matches.results ?? [];
    if (matchData.length < 2) {
      return { patterns: [], bestPartner: null, successFactors: [], summary: "インサイト生成には2件以上のマッチング結果が必要です" };
    }

    // Format for LLM
    const matchSummary = matchData.map((m: any) => {
      const bd = parseJson<any>(m.scoreBreakdown) || {};
      return `[${m.createdAt?.slice(0, 10)}] テーマ「${m.theme}」with ${m.partnerName || "?"}: ${m.compatibilityScore}% — ${Object.entries(bd).map(([k, v]) => `${k}:${(v as any)?.score ?? 0}`).join(", ")}`;
    }).join("\n");

    const result = await invokeLLM(llmConfig, [
      {
        role: "system",
        content: `あなたはビジネスマッチングの分析エキスパートです。
ユーザーの全マッチング履歴を横断分析し、以下をJSON形式で出力してください:
{
  "patterns": ["パターン1: 説明", "パターン2: 説明", "パターン3: 説明"],
  "bestPartner": {"name": "最適パートナー名", "reason": "理由"},
  "successFactors": ["成功要因1", "成功要因2", "成功要因3"],
  "weakAreas": ["改善領域1", "改善領域2"],
  "recommendation": "次のマッチングへのアドバイス（2-3文）",
  "summary": "全体サマリー（2-3文）"
}`,
      },
      { role: "user", content: `マッチング履歴 (${matchData.length}件):\n${matchSummary}` },
    ], { maxTokens: 1500, temperature: 0.4 });

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const insights = JSON.parse(jsonMatch[0]);
        // Save to DB
        await db.prepare(
          `INSERT OR REPLACE INTO matching_insights (userId, insightsData, generatedAt)
           VALUES (?,?,datetime('now'))`
        ).bind(ctx.userId, JSON.stringify(insights)).run();
        return insights;
      }
    } catch { /* parse error */ }
    return { patterns: [], bestPartner: null, successFactors: [], summary: result.content };
  }),
  getInsights: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(
      `SELECT * FROM matching_insights WHERE userId=? ORDER BY generatedAt DESC LIMIT 1`
    ).bind(ctx.userId).first<any>();
    if (!row) return null;
    return { ...parseJson<any>(row.insightsData), generatedAt: row.generatedAt };
  }),
  sendInsightsReport: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    if (!ctx.env.RESEND_API_KEY) return { sent: false, reason: "メール送信未設定" };

    const user = await ctx.env.DB.prepare(`SELECT email, name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.email) return { sent: false, reason: "メールアドレス未設定" };

    const row = await ctx.env.DB.prepare(
      `SELECT * FROM matching_insights WHERE userId=? ORDER BY generatedAt DESC LIMIT 1`
    ).bind(ctx.userId).first<any>();
    if (!row) return { sent: false, reason: "インサイトデータがありません" };

    const insights = parseJson<any>(row.insightsData) || {};
    const fromEmail = ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.pages.dev";
    const frontendUrl = ctx.env.FRONTEND_URL || "https://bunshin-ai.pages.dev";

    const emailHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px;border-radius:12px 12px 0 0;color:#fff;text-align:center">
  <h1 style="margin:0;font-size:24px">マッチングインサイトレポート</h1>
  <p style="margin:8px 0 0;opacity:0.9">${user.name || "ユーザー"}さんの分析結果</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e5e7eb;border-top:0">
  ${insights.summary ? `<p style="color:#374151;font-size:16px;margin-bottom:16px">${insights.summary}</p>` : ""}
  ${insights.patterns?.length ? `<h3 style="color:#6366f1;margin-top:20px">発見パターン</h3><ul>${insights.patterns.map((p: string) => `<li style="color:#4b5563;margin:4px 0">${p}</li>`).join("")}</ul>` : ""}
  ${insights.bestPartner ? `<h3 style="color:#6366f1;margin-top:20px">最適パートナー</h3><p style="color:#374151"><strong>${insights.bestPartner.name}</strong>: ${insights.bestPartner.reason}</p>` : ""}
  ${insights.successFactors?.length ? `<h3 style="color:#6366f1;margin-top:20px">成功要因</h3><ul>${insights.successFactors.map((f: string) => `<li style="color:#4b5563;margin:4px 0">${f}</li>`).join("")}</ul>` : ""}
  ${insights.recommendation ? `<div style="background:#eff6ff;border-left:4px solid #6366f1;padding:12px;margin-top:16px;border-radius:0 8px 8px 0"><p style="color:#374151;margin:0">${insights.recommendation}</p></div>` : ""}
  <div style="text-align:center;margin:24px 0">
    <a href="${frontendUrl}/matching" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">ダッシュボードを見る</a>
  </div>
</div>
<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">分身AI マッチングインサイト | <a href="${frontendUrl}" style="color:#6366f1">bunshin-ai.pages.dev</a></div>
</body></html>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `分身AI <${fromEmail}>`,
          to: [user.email],
          subject: `【分身AI】マッチングインサイトレポート`,
          html: emailHtml,
        }),
      });
      return { sent: res.ok };
    } catch { return { sent: false, reason: "メール送信に失敗しました" }; }
  }),


  // ============ Phase 16: マッチングAIコーチ ============
  getCoachAdvice: protectedProcedure
    .input(z.object({ sessionId: z.number(), turnNumber: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=? AND (userId=? OR targetUserId=?)`
      ).bind(input.sessionId, ctx.userId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber ASC`
      ).bind(input.sessionId).all<any>();
      const allTurns = dialogues.results ?? [];
      const targetTurn = allTurns.find((d: any) => d.turnNumber === input.turnNumber);
      if (!targetTurn) throw new TRPCError({ code: "NOT_FOUND", message: "指定されたターンが見つかりません" });

      // Get twin info for context
      const twin1 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();

      const dialogueContext = allTurns
        .filter((d: any) => d.turnNumber <= input.turnNumber)
        .map((d: any) => `ターン${d.turnNumber} [Twin${d.speakerTwinId}]: ${d.content}`)
        .join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "AI APIキーが未設定です" });
      const coachPrompt = `あなたはビジネスマッチングの交渉コーチです。以下の対話を分析し、コーチングアドバイスを提供してください。

## 参加者
- Twin1: ${twin1?.name ?? "不明"} (${twin1?.description ?? ""})
- Twin2: ${twin2?.name ?? "不明"} (${twin2?.description ?? ""})

## 対話履歴
${dialogueContext}

## 分析対象: ターン${input.turnNumber}

以下のJSON形式で回答してください:
{
  "techniques": ["使える交渉テクニック1", "交渉テクニック2"],
  "suggestedQuestions": ["より良い質問案1", "質問案2"],
  "improvementHints": ["発言改善ヒント1", "改善ヒント2"],
  "overallAdvice": "全体的なアドバイス"
}

JSONのみ出力してください。`;
      const llmResult = await invokeLLM(
        llmConfig,
        [{ role: "user", content: coachPrompt }],
        { temperature: 0.7, maxTokens: 1500 }
      );
      const rawResponse = llmResult.content;

      let advice: any;
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        advice = jsonMatch ? JSON.parse(jsonMatch[0]) : {
          techniques: ["分析できませんでした"],
          suggestedQuestions: [],
          improvementHints: [],
          overallAdvice: rawResponse,
        };
      } catch {
        advice = {
          techniques: ["分析できませんでした"],
          suggestedQuestions: [],
          improvementHints: [],
          overallAdvice: rawResponse,
        };
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_coach_advice (sessionId, turnNumber, userId, advice, createdAt)
         VALUES (?,?,?,?,datetime('now'))`
      ).bind(input.sessionId, input.turnNumber, ctx.userId, toJson(advice)).run();

      return {
        sessionId: input.sessionId,
        turnNumber: input.turnNumber,
        techniques: advice.techniques ?? [],
        suggestedQuestions: advice.suggestedQuestions ?? [],
        improvementHints: advice.improvementHints ?? [],
        overallAdvice: advice.overallAdvice ?? "",
      };
    }),
  toggleCoachMode: protectedProcedure
    .input(z.object({ sessionId: z.number(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=? AND (userId=? OR targetUserId=?)`
      ).bind(input.sessionId, ctx.userId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      const currentSettings = parseJson<any>(session.settings) ?? {};
      currentSettings.coachMode = input.enabled;

      await ctx.env.DB.prepare(
        `UPDATE matching_sessions SET settings=? WHERE id=?`
      ).bind(toJson(currentSettings), input.sessionId).run();

      return { enabled: input.enabled };
    }),
  getCoachHistory: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT id FROM matching_sessions WHERE id=? AND (userId=? OR targetUserId=?)`
      ).bind(input.sessionId, ctx.userId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM matching_coach_advice WHERE sessionId=? AND userId=? ORDER BY turnNumber ASC`
      ).bind(input.sessionId, ctx.userId).all<any>();

      return (rows.results ?? []).map((r: any) => {
        const advice = parseJson<any>(r.advice) ?? {};
        return {
          id: r.id,
          sessionId: r.sessionId,
          turnNumber: r.turnNumber,
          techniques: advice.techniques ?? [],
          suggestedQuestions: advice.suggestedQuestions ?? [],
          improvementHints: advice.improvementHints ?? [],
          overallAdvice: advice.overallAdvice ?? "",
          createdAt: r.createdAt,
        };
      });
    }),

  // ============ Phase 17: ツイン感情ダッシュボード ============
  analyzeEmotions: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const session = await ctx.env.DB.prepare(
        `SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=? AND initiatorUserId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "マッチングセッションが見つかりません" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT md.turnNumber, md.content, md.speakerTwinId, dt.name as speakerName
         FROM matching_dialogues md
         LEFT JOIN digital_twins dt ON dt.id = md.speakerTwinId
         WHERE md.sessionId=?
         ORDER BY md.turnNumber ASC`
      ).bind(input.sessionId).all<any>();

      if (!dialogues.results?.length) throw new TRPCError({ code: "NOT_FOUND", message: "対話データがありません" });

      const allTurns = (dialogues.results ?? []).map((d: any) => `ターン${d.turnNumber} [${d.speakerName || "Twin"}]: ${d.content}`).join("\n");

      let analyses: any[] = [];

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (llmConfig) {
        try {
          const result = await invokeLLM(llmConfig, [
            { role: "system", content: `あなたは感情分析の専門家です。以下のビジネス対話の各ターンの感情を分析してください。\n\n各ターンについて以下のJSON配列で回答してください（JSONのみ）:\n[\n  {\n    "turnNumber": <ターン番号>,\n    "speaker": "<発言者名>",\n    "sentiment": "positive" | "neutral" | "negative",\n    "emotion": "<具体的感情: confident, anxious, enthusiastic, cautious, frustrated, hopeful, assertive, defensive 等>",\n    "confidence": <0-100: 分析の確信度>,\n    "intensity": <0-100: 感情の強さ>\n  }\n]` },
            { role: "user", content: `以下の対話を分析してください:\n\n${allTurns}` },
          ], { maxTokens: 2048 });
          const jsonMatch = result.content.match(/\[[\s\S]*\]/);
          if (jsonMatch) analyses = JSON.parse(jsonMatch[0]);
        } catch { /* empty */ }
      }

      if (!analyses.length) {
        analyses = (dialogues.results ?? []).map((d: any) => ({
          turnNumber: d.turnNumber,
          speaker: d.speakerName || "Twin",
          sentiment: "neutral" as const,
          emotion: "neutral",
          confidence: 50,
          intensity: 50,
        }));
      }

      for (const a of analyses) {
        await ctx.env.DB.prepare(
          `INSERT OR REPLACE INTO matching_emotion_analysis (sessionId, turnNumber, speaker, sentiment, emotion, confidence, intensity)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(input.sessionId, a.turnNumber, a.speaker ?? null, a.sentiment ?? "neutral", a.emotion ?? "neutral", a.confidence ?? 50, a.intensity ?? 50).run();
      }

      return analyses;
    }),
  getEmotionAnalysis: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM matching_emotion_analysis WHERE sessionId=? ORDER BY turnNumber ASC`
      ).bind(input.sessionId).all<any>();

      const results = rows.results ?? [];
      const total = results.length || 1;
      const posCount = results.filter((r: any) => r.sentiment === "positive").length;
      const negCount = results.filter((r: any) => r.sentiment === "negative").length;
      const avgConfidence = Math.round(results.reduce((s: number, r: any) => s + (r.confidence || 0), 0) / total);
      const avgIntensity = Math.round(results.reduce((s: number, r: any) => s + (r.intensity || 0), 0) / total);

      return {
        turns: results.map((r: any) => ({
          turnNumber: r.turnNumber,
          speaker: r.speaker,
          sentiment: r.sentiment,
          emotion: r.emotion,
          confidence: r.confidence,
          intensity: r.intensity,
        })),
        summary: {
          totalTurns: results.length,
          positiveRatio: Math.round((posCount / total) * 100),
          negativeRatio: Math.round((negCount / total) * 100),
          neutralRatio: Math.round(((total - posCount - negCount) / total) * 100),
          avgConfidence,
          avgIntensity,
        },
      };
    }),
  getEmotionComparison: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const session = await ctx.env.DB.prepare(
        `SELECT ms.*, dt1.name as twin1Name, dt1.userId as twin1UserId, dt2.name as twin2Name, dt2.userId as twin2UserId
         FROM matching_sessions ms
         LEFT JOIN digital_twins dt1 ON dt1.id = ms.twin1Id
         LEFT JOIN digital_twins dt2 ON dt2.id = ms.twin2Id
         WHERE ms.id=?`
      ).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      const emotions = await ctx.env.DB.prepare(
        `SELECT ea.*, md.speakerTwinId
         FROM matching_emotion_analysis ea
         LEFT JOIN matching_dialogues md ON md.sessionId = ea.sessionId AND md.turnNumber = ea.turnNumber
         WHERE ea.sessionId=?
         ORDER BY ea.turnNumber ASC`
      ).bind(input.sessionId).all<any>();

      const allRows = emotions.results ?? [];
      const myTwinId = session.twin1UserId === ctx.userId ? session.twin1Id : session.twin2Id;

      const myTwinRows = allRows.filter((r: any) => r.speakerTwinId === myTwinId);
      const opponentRows = allRows.filter((r: any) => r.speakerTwinId !== myTwinId);

      const calcStats = (rows: any[]) => {
        const total = rows.length || 1;
        const avgConf = Math.round(rows.reduce((s: number, r: any) => s + (r.confidence || 0), 0) / total);
        const avgInt = Math.round(rows.reduce((s: number, r: any) => s + (r.intensity || 0), 0) / total);
        const emotionList = rows.map((r: any) => r.emotion as string).filter(Boolean);
        const emotionCounts: Record<string, number> = {};
        emotionList.forEach((e) => { emotionCounts[e] = (emotionCounts[e] || 0) + 1; });
        const dominant = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";
        const sentiments = rows.map((r: any) => r.sentiment as string);
        const trend = sentiments.length > 1
          ? (sentiments[sentiments.length - 1] === "positive" ? "improving" : sentiments[sentiments.length - 1] === "negative" ? "declining" : "stable")
          : "stable";
        return { avgConfidence: avgConf, avgIntensity: avgInt, dominantEmotion: dominant, sentimentTrend: trend };
      };

      const myStats = calcStats(myTwinRows);
      const opponentStats = calcStats(opponentRows);

      const comparison = myStats.avgConfidence > opponentStats.avgConfidence
        ? "あなたのツインはより自信を持って交渉に臨んでいました。"
        : myStats.avgConfidence < opponentStats.avgConfidence
        ? "相手のツインの方がより自信のある態度でした。"
        : "両ツインは同程度の自信を持って交渉していました。";

      return {
        myTwin: { name: session.twin1UserId === ctx.userId ? session.twin1Name : session.twin2Name, ...myStats },
        opponent: { name: session.twin1UserId === ctx.userId ? session.twin2Name : session.twin1Name, ...opponentStats },
        comparison,
      };
    }),

  // ============ Phase 17: スマートマッチングレコメンド ============
  getSmartRecommendations: protectedProcedure
    .input(z.object({ limit: z.number().default(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const matchHistory = await ctx.env.DB.prepare(
        `SELECT ms.id, ms.theme, ms.twin2Id, mr.overallScore, mr.scoreBreakdown, dt.name as opponentName, dt.userId as opponentUserId
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         LEFT JOIN digital_twins dt ON dt.id = ms.twin2Id
         WHERE ms.initiatorUserId=? AND ms.status='completed'
         ORDER BY ms.createdAt DESC LIMIT 20`
      ).bind(ctx.userId).all<any>();

      const profile = await ctx.env.DB.prepare(
        `SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`
      ).bind(ctx.userId).first<any>();

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);

      const skills = twin ? await ctx.env.DB.prepare(
        `SELECT * FROM twin_skill_levels WHERE twinId=?`
      ).bind(twin.id).all<any>() : { results: [] };

      const friends = await ctx.env.DB.prepare(
        `SELECT f.friendId, u.name as friendName, up.industry, up.expertise, up.position, up.skills
         FROM friendships f
         LEFT JOIN users u ON u.id = f.friendId
         LEFT JOIN user_profiles up ON up.userId = f.friendId
         WHERE f.userId=? AND f.status='accepted'`
      ).bind(ctx.userId).all<any>();

      const personas = await ctx.env.DB.prepare(
        `SELECT id, roleName, description FROM orchestration_roles WHERE userId=?`
      ).bind(ctx.userId).all<any>();

      const historyStr = (matchHistory.results ?? []).map((m: any) =>
        `相手: ${m.opponentName}, テーマ: ${m.theme}, スコア: ${m.overallScore ?? "N/A"}`
      ).join("\n");

      const friendsStr = (friends.results ?? []).map((f: any) =>
        `ID:${f.friendId} 名前:${f.friendName} 業界:${f.industry || "不明"} 専門:${f.expertise || "不明"} スキル:${f.skills || "不明"}`
      ).join("\n");

      const personaStr = (personas.results ?? []).map((p: any) =>
        `ID:${p.id} 名前:${p.roleName} 説明:${p.description || ""}`
      ).join("\n");

      const skillsStr = (skills.results ?? []).map((s: any) => `${s.skillType}: Lv${s.level}`).join(", ");

      let recommendations: any[] = [];

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (llmConfig) {
        try {
          const result = await invokeLLM(llmConfig, [
            { role: "system", content: `あなたはAIマッチングアドバイザーです。ユーザーの過去のマッチング履歴、プロフィール、スキル、友達リストを分析し、最適なマッチング相手を推薦してください。\n\n以下のJSON形式で回答してください（JSONのみ）:\n{\n  "recommendations": [\n    {\n      "friendId": <友達のID>,\n      "friendName": "<友達の名前>",\n      "reason": "<推薦理由>",\n      "suggestedTheme": "<おすすめの交渉/マッチングテーマ>",\n      "suggestedPersonaId": <ペルソナID or null>,\n      "suggestedPersonaName": "<ペルソナ名 or null>",\n      "predictedScore": <予測スコア 0-100>,\n      "confidence": <推薦の確信度 0-100>\n    }\n  ]\n}\n\n最大${input.limit}件の推薦を返してください。友達リストにいるユーザーのみ推薦できます。` },
            { role: "user", content: `## ユーザープロフィール\n名前: ${profile?.displayName || "不明"}\n業界: ${profile?.industry || "不明"}\nスキル: ${skillsStr || "なし"}\n\n## 過去のマッチング履歴\n${historyStr || "なし"}\n\n## 友達リスト\n${friendsStr || "なし"}\n\n## 利用可能なペルソナ\n${personaStr || "なし"}\n\n最適なマッチング相手を推薦してください。` },
          ], { maxTokens: 2048 });
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            recommendations = parsed.recommendations || [];
          }
        } catch { /* empty */ }
      }

      recommendations = recommendations.slice(0, input.limit);

      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM smart_matching_recommendations WHERE userId=?`
      ).bind(ctx.userId).first<any>();

      if (existing) {
        await ctx.env.DB.prepare(
          `UPDATE smart_matching_recommendations SET recommendations=?, generatedAt=datetime('now') WHERE userId=?`
        ).bind(toJson(recommendations), ctx.userId).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO smart_matching_recommendations (userId, recommendations) VALUES (?,?)`
        ).bind(ctx.userId, toJson(recommendations)).run();
      }

      return { recommendations };
    }),
  getRecommendations: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    const row = await ctx.env.DB.prepare(
      `SELECT * FROM smart_matching_recommendations WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    if (!row) return { recommendations: [], generatedAt: null };

    return {
      recommendations: parseJson<any[]>(row.recommendations) || [],
      generatedAt: row.generatedAt,
    };
  }),
  sendWeeklyRecommendations: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    if (!ctx.env.RESEND_API_KEY) return { sent: false, reason: "メール送信未設定" };

    const user = await ctx.env.DB.prepare(`SELECT email, name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.email) return { sent: false, reason: "メールアドレス未設定" };

    const row = await ctx.env.DB.prepare(
      `SELECT * FROM smart_matching_recommendations WHERE userId=?`
    ).bind(ctx.userId).first<any>();
    if (!row) return { sent: false, reason: "レコメンドデータがありません" };

    const recommendations = parseJson<any[]>(row.recommendations) || [];
    if (!recommendations.length) return { sent: false, reason: "推薦がありません" };

    const fromEmail = ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.pages.dev";
    const frontendUrl = ctx.env.FRONTEND_URL || "https://bunshin-ai.pages.dev";

    const recCards = recommendations.map((r: any) => `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="color:#374151;font-size:16px">${r.friendName || "ユーザー"}</strong>
          <span style="background:#eff6ff;color:#6366f1;padding:4px 8px;border-radius:12px;font-size:12px">予測スコア: ${r.predictedScore ?? "N/A"}</span>
        </div>
        <p style="color:#6b7280;margin:8px 0 4px;font-size:14px">${r.reason || ""}</p>
        <p style="color:#9ca3af;margin:0;font-size:12px">おすすめテーマ: ${r.suggestedTheme || "自由テーマ"}</p>
      </div>
    `).join("");

    const emailHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px;border-radius:12px 12px 0 0;color:#fff;text-align:center">
  <h1 style="margin:0;font-size:24px">週間マッチングレコメンド</h1>
  <p style="margin:8px 0 0;opacity:0.9">${user.name || "ユーザー"}さんへのおすすめ</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e5e7eb;border-top:0">
  <p style="color:#374151;margin-bottom:16px">AIがあなたに最適なマッチング相手を選びました：</p>
  ${recCards}
  <div style="text-align:center;margin:24px 0">
    <a href="${frontendUrl}/matching" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">マッチングを始める</a>
  </div>
</div>
<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">分身AI 週間レコメンド | <a href="${frontendUrl}" style="color:#6366f1">bunshin-ai.pages.dev</a></div>
</body></html>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `分身AI <${fromEmail}>`,
          to: [user.email],
          subject: `【分身AI】今週のマッチングレコメンド`,
          html: emailHtml,
        }),
      });
      return { sent: res.ok };
    } catch { return { sent: false, reason: "メール送信に失敗しました" }; }
  }),

  // ============ Phase 20: AIマッチング品質スコアカード ============
  evaluateQuality: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=? AND (userId=? OR targetUserId=?)`
      ).bind(input.sessionId, ctx.userId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber ASC`
      ).bind(input.sessionId).all<any>();
      const turns = dialogues.results ?? [];
      if (turns.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });

      const results = await ctx.env.DB.prepare(
        `SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`
      ).bind(input.sessionId).first<any>();

      const twin1 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();

      const dialogueText = turns.map((d: any) =>
        `ターン${d.turnNumber} [${d.speakerTwinId === session.twin1Id ? (twin1?.name ?? "Twin1") : (twin2?.name ?? "Twin2")}]: ${d.content}`
      ).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "AI APIキーが未設定です" });

      const systemPrompt = `あなたはビジネスマッチング対話の品質評価の専門家です。以下の対話を5つの軸で0-100のスコアで評価してください。必ず以下のJSON形式で返してください。

{
  "scores": {
    "logic": <0-100 論理性>,
    "creativity": <0-100 創造性>,
    "cooperation": <0-100 協調性>,
    "specificity": <0-100 具体性>,
    "feasibility": <0-100 実行可能性>
  },
  "overallQuality": <0-100 総合品質>,
  "strengths": ["強み1", "強み2", ...],
  "weaknesses": ["弱み1", "弱み2", ...],
  "improvements": ["改善提案1", "改善提案2", ...]
}`;

      const userPrompt = `## マッチングセッション
テーマ: ${session.theme || "ビジネスマッチング"}
参加者: ${twin1?.name ?? "Twin1"} × ${twin2?.name ?? "Twin2"}

## 対話内容
${dialogueText}

${results ? `## マッチング結果\nスコア: ${results.score || "N/A"}\n分析: ${results.analysis || "N/A"}` : ""}

上記の対話を5軸で評価し、JSON形式で回答してください。`;

      const llmResult = await invokeLLM(llmConfig, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], { maxTokens: 2048 });

      let evaluation: any;
      try {
        const cleaned = llmResult.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        evaluation = JSON.parse(cleaned);
      } catch {
        evaluation = {
          scores: { logic: 60, creativity: 60, cooperation: 60, specificity: 60, feasibility: 60 },
          overallQuality: 60,
          strengths: ["対話が成立している"],
          weaknesses: ["評価の解析に失敗しました"],
          improvements: ["再評価をお試しください"],
        };
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_quality_scores (sessionId, userId, scores, overallQuality, strengths, weaknesses, improvements, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        input.sessionId,
        ctx.userId,
        toJson(evaluation.scores),
        evaluation.overallQuality ?? 60,
        toJson(evaluation.strengths ?? []),
        toJson(evaluation.weaknesses ?? []),
        toJson(evaluation.improvements ?? []),
        now()
      ).run();

      return evaluation;
    }),
  getQualityScore: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM matching_quality_scores WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        id: row.id,
        sessionId: row.sessionId,
        scores: parseJson<any>(row.scores),
        overallQuality: row.overallQuality,
        strengths: parseJson<string[]>(row.strengths) ?? [],
        weaknesses: parseJson<string[]>(row.weaknesses) ?? [],
        improvements: parseJson<string[]>(row.improvements) ?? [],
        createdAt: row.createdAt,
      };
    }),
  getQualityTrend: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT q.sessionId, q.overallQuality, q.scores, q.createdAt, s.theme
       FROM matching_quality_scores q
       JOIN matching_sessions s ON s.id = q.sessionId
       WHERE q.userId=?
       ORDER BY q.createdAt ASC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      sessionId: r.sessionId,
      theme: r.theme,
      date: r.createdAt,
      overallQuality: r.overallQuality,
      scores: parseJson<any>(r.scores),
    }));
  }),

  // ============ Phase 20: マッチングダイジェスト ============
  generateDigest: protectedProcedure
    .input(z.object({ period: z.enum(["weekly", "monthly"]).default("weekly") }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const days = input.period === "monthly" ? 30 : 7;
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

      // Collect matching sessions in period
      const sessions = await ctx.env.DB.prepare(
        `SELECT s.*, r.score, r.analysis FROM matching_sessions s
         LEFT JOIN matching_results r ON r.sessionId = s.id
         WHERE (s.userId=? OR s.targetUserId=?) AND s.createdAt >= ?
         ORDER BY s.createdAt DESC`
      ).bind(ctx.userId, ctx.userId, sinceDate).all<any>();
      const sessionList = sessions.results ?? [];
      const matchCount = sessionList.length;
      const scores = sessionList.filter((s: any) => s.score != null).map((s: any) => Number(s.score));
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

      // Quality scores
      const qualityRows = await ctx.env.DB.prepare(
        `SELECT * FROM matching_quality_scores WHERE userId=? AND createdAt >= ?`
      ).bind(ctx.userId, sinceDate).all<any>();
      const qualityScores = qualityRows.results ?? [];

      // Action items
      const actionRows = await ctx.env.DB.prepare(
        `SELECT * FROM matching_action_items WHERE userId=? AND createdAt >= ?`
      ).bind(ctx.userId, sinceDate).all<any>();
      const actions = actionRows.results ?? [];
      const actionsCompleted = actions.filter((a: any) => a.status === "completed").length;
      const actionsPending = actions.filter((a: any) => a.status !== "completed").length;

      // Outcomes
      const outcomeRows = await ctx.env.DB.prepare(
        `SELECT * FROM matching_outcomes WHERE userId=? AND createdAt >= ?`
      ).bind(ctx.userId, sinceDate).all<any>();
      const outcomes = outcomeRows.results ?? [];
      const outcomeValue = outcomes.reduce((sum: number, o: any) => sum + (o.monetaryValue || 0), 0);

      // Build summary data for LLM
      const summaryData = {
        period: input.period === "monthly" ? "月間" : "週間",
        matchCount,
        avgScore,
        actionsCompleted,
        actionsPending,
        outcomeValue,
        topSessions: sessionList.slice(0, 5).map((s: any) => ({
          theme: s.theme,
          score: s.score,
          status: s.status,
        })),
        qualityAvg: qualityScores.length > 0
          ? Math.round(qualityScores.reduce((sum: number, q: any) => sum + (q.overallQuality || 0), 0) / qualityScores.length)
          : null,
      };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "AI APIキーが未設定です" });

      const systemPrompt = `あなたはビジネスマッチング活動の分析レポーターです。ユーザーの活動データを分析し、ダイジェストを生成してください。必ず以下のJSON形式で返してください。

{
  "summary": "活動の総括（2-3文）",
  "highlights": ["ハイライト1", "ハイライト2", ...],
  "topPerformance": { "sessionId": <number or 0>, "theme": "テーマ名", "score": <number> },
  "areaOfGrowth": "成長のための重点分野",
  "recommendation": "次のアクションの提案",
  "stats": { "matchCount": <number>, "avgScore": <number>, "outcomeValue": <number>, "actionsCompleted": <number> }
}`;

      const userPrompt = `## ${summaryData.period}ダイジェスト生成

### 活動データ
- マッチング数: ${matchCount}件
- 平均スコア: ${avgScore}点
- 完了アクション: ${actionsCompleted}件 / 保留: ${actionsPending}件
- 成果価値: ¥${outcomeValue.toLocaleString()}
${summaryData.qualityAvg != null ? `- 品質平均スコア: ${summaryData.qualityAvg}点` : ""}

### 直近セッション
${summaryData.topSessions.map((s: any) => `- ${s.theme || "未設定"} (スコア: ${s.score ?? "未評価"}, ステータス: ${s.status || "N/A"})`).join("\n")}

上記データを分析し、JSON形式でダイジェストを返してください。`;

      const llmResult = await invokeLLM(llmConfig, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], { maxTokens: 2048 });

      let digest: any;
      try {
        const cleaned = llmResult.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        digest = JSON.parse(cleaned);
      } catch {
        digest = {
          summary: `${input.period === "monthly" ? "月間" : "週間"}で${matchCount}件のマッチングを実施しました。平均スコアは${avgScore}点です。`,
          highlights: matchCount > 0 ? ["マッチング活動を継続しています"] : ["まだマッチング活動がありません"],
          topPerformance: { sessionId: 0, theme: "N/A", score: avgScore },
          areaOfGrowth: "継続的なマッチング参加",
          recommendation: "新しいマッチング相手との対話を試みてください",
          stats: { matchCount, avgScore, outcomeValue, actionsCompleted },
        };
      }

      // Ensure stats are populated
      digest.stats = digest.stats || { matchCount, avgScore, outcomeValue, actionsCompleted };

      const result = await ctx.env.DB.prepare(
        `INSERT INTO matching_digests (userId, period, digestData, generatedAt) VALUES (?, ?, ?, ?)`
      ).bind(ctx.userId, input.period, toJson(digest), now()).run();

      return { id: result.meta?.last_row_id ?? 0, ...digest, period: input.period, generatedAt: now() };
    }),
  getDigest: protectedProcedure
    .input(z.object({ period: z.enum(["weekly", "monthly"]).optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let row: any;
      if (input.period) {
        row = await ctx.env.DB.prepare(
          `SELECT * FROM matching_digests WHERE userId=? AND period=? ORDER BY generatedAt DESC LIMIT 1`
        ).bind(ctx.userId, input.period).first<any>();
      } else {
        row = await ctx.env.DB.prepare(
          `SELECT * FROM matching_digests WHERE userId=? ORDER BY generatedAt DESC LIMIT 1`
        ).bind(ctx.userId).first<any>();
      }
      if (!row) return null;
      const data = parseJson<any>(row.digestData) ?? {};
      return { id: row.id, period: row.period, ...data, generatedAt: row.generatedAt };
    }),
  sendDigestEmail: protectedProcedure
    .input(z.object({ digestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.env.RESEND_API_KEY) return { sent: false, reason: "メール送信未設定" };

      const user = await ctx.env.DB.prepare(`SELECT email, name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.email) return { sent: false, reason: "メールアドレス未設定" };

      const row = await ctx.env.DB.prepare(
        `SELECT * FROM matching_digests WHERE id=? AND userId=?`
      ).bind(input.digestId, ctx.userId).first<any>();
      if (!row) return { sent: false, reason: "ダイジェストが見つかりません" };

      const digest = parseJson<any>(row.digestData) ?? {};
      const fromEmail = ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.pages.dev";
      const frontendUrl = ctx.env.FRONTEND_URL || "https://bunshin-ai.pages.dev";
      const periodLabel = row.period === "monthly" ? "月間" : "週間";

      const emailHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px;border-radius:12px 12px 0 0;color:#fff;text-align:center">
  <h1 style="margin:0;font-size:24px">${periodLabel}マッチングダイジェスト</h1>
  <p style="margin:8px 0 0;opacity:0.9">${user.name || "ユーザー"}さんの活動レポート</p>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e5e7eb;border-top:0">
  ${digest.summary ? `<p style="color:#374151;font-size:16px;margin-bottom:16px">${digest.summary}</p>` : ""}
  ${digest.stats ? `<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;flex:1;min-width:120px;text-align:center">
      <div style="font-size:24px;font-weight:bold;color:#6366f1">${digest.stats.matchCount ?? 0}</div>
      <div style="font-size:12px;color:#6b7280">マッチング数</div>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;flex:1;min-width:120px;text-align:center">
      <div style="font-size:24px;font-weight:bold;color:#6366f1">${digest.stats.avgScore ?? 0}</div>
      <div style="font-size:12px;color:#6b7280">平均スコア</div>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;flex:1;min-width:120px;text-align:center">
      <div style="font-size:24px;font-weight:bold;color:#6366f1">${digest.stats.actionsCompleted ?? 0}</div>
      <div style="font-size:12px;color:#6b7280">完了アクション</div>
    </div>
  </div>` : ""}
  ${digest.highlights?.length ? `<h3 style="color:#6366f1;margin-top:20px">ハイライト</h3><ul>${digest.highlights.map((h: string) => `<li style="color:#4b5563;margin:4px 0">${h}</li>`).join("")}</ul>` : ""}
  ${digest.areaOfGrowth ? `<h3 style="color:#6366f1;margin-top:20px">成長ポイント</h3><p style="color:#374151">${digest.areaOfGrowth}</p>` : ""}
  ${digest.recommendation ? `<div style="background:#eff6ff;border-left:4px solid #6366f1;padding:12px;margin-top:16px;border-radius:0 8px 8px 0"><p style="color:#374151;margin:0"><strong>おすすめ:</strong> ${digest.recommendation}</p></div>` : ""}
  <div style="text-align:center;margin:24px 0">
    <a href="${frontendUrl}/matching" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">ダッシュボードを見る</a>
  </div>
</div>
<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">分身AI ${periodLabel}ダイジェスト | <a href="${frontendUrl}" style="color:#6366f1">bunshin-ai.pages.dev</a></div>
</body></html>`;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `分身AI <${fromEmail}>`,
            to: [user.email],
            subject: `【分身AI】${periodLabel}マッチングダイジェスト`,
            html: emailHtml,
          }),
        });
        return { sent: res.ok };
      } catch { return { sent: false, reason: "メール送信に失敗しました" }; }
    }),

  // ============ Feature 21-2: ツイン会話スタイル分析 ============
  analyzeConversationStyle: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id = ?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId = ? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });

      const settings = parseJson<any>(session.settings) || {};
      const twin1Id = session.twin1Id || settings.twin1Id;

      const dialogueText = (dialogues.results ?? []).map((d: any) => `Turn ${d.turnNumber} [${d.speaker}]: ${d.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM APIキーが未設定です" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは会話分析の専門家です。ビジネスマッチング対話から各参加者の会話スタイルを深層分析してください。` },
        { role: "user", content: `以下の対話を分析してください:\n\n${dialogueText}\n\n各参加者について以下のJSON形式で出力:
{
  "participants": [
    {
      "speaker": "speaker名",
      "vocabularyLevel": { "score": 0-100, "characteristics": ["特徴1", "特徴2"], "frequentWords": ["頻出語1", "語2"] },
      "topicDevelopment": { "score": 0-100, "pattern": "展開パターン", "strengths": ["強み"], "areas": ["改善点"] },
      "questionFrequency": { "score": 0-100, "count": 0, "types": ["質問タイプ"] },
      "agreementStyle": { "score": 0-100, "pattern": "合意形成パターン", "techniques": ["テクニック"] },
      "overallStyle": "総合スタイル名",
      "improvements": ["改善提案1", "提案2"]
    }
  ],
  "comparison": { "similarity": 0-100, "complementary": ["補完的な点"], "friction": ["摩擦点"] },
  "recommendations": ["全体的な推奨事項1", "推奨2"]
}` },
      ], { maxTokens: 2048, temperature: 0.5 });

      let analysis: any = {};
      try {
        const match = result.content.match(/\{[\s\S]*\}/);
        if (match) analysis = JSON.parse(match[0]);
      } catch { analysis = { participants: [], comparison: { similarity: 50, complementary: [], friction: [] }, recommendations: [] }; }

      // Save for each twin
      if (twin1Id) {
        await ctx.env.DB.prepare(
          `INSERT OR REPLACE INTO conversation_style_analysis (sessionId, twinId, userId, analysis, createdAt) VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(input.sessionId, twin1Id, ctx.userId, toJson(analysis)).run();
      }

      return analysis;
    }),
  getConversationStyle: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM conversation_style_analysis WHERE sessionId = ? AND userId = ?`
      ).bind(input.sessionId, ctx.userId).all<any>();
      return (rows.results ?? []).map((r: any) => ({ ...r, analysis: parseJson<any>(r.analysis) }));
    }),
  getStyleComparison: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    // Get all style analyses for the user
    const rows = await ctx.env.DB.prepare(
      `SELECT csa.*, ms.theme, dt.name as twinName
       FROM conversation_style_analysis csa
       JOIN matching_sessions ms ON ms.id = csa.sessionId
       LEFT JOIN digital_twins dt ON dt.id = csa.twinId
       WHERE csa.userId = ?
       ORDER BY csa.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    const analyses = (rows.results ?? []).map((r: any) => ({
      sessionId: r.sessionId,
      theme: r.theme,
      twinName: r.twinName,
      analysis: parseJson<any>(r.analysis),
      createdAt: r.createdAt,
    }));

    // Aggregate style scores across sessions
    const styleScores: Record<string, number[]> = { vocabularyLevel: [], topicDevelopment: [], questionFrequency: [], agreementStyle: [] };
    for (const a of analyses) {
      const participants = a.analysis?.participants || [];
      for (const p of participants) {
        if (p.vocabularyLevel?.score != null) styleScores.vocabularyLevel.push(p.vocabularyLevel.score);
        if (p.topicDevelopment?.score != null) styleScores.topicDevelopment.push(p.topicDevelopment.score);
        if (p.questionFrequency?.score != null) styleScores.questionFrequency.push(p.questionFrequency.score);
        if (p.agreementStyle?.score != null) styleScores.agreementStyle.push(p.agreementStyle.score);
      }
    }

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    return {
      analyses,
      averages: {
        vocabularyLevel: avg(styleScores.vocabularyLevel),
        topicDevelopment: avg(styleScores.topicDevelopment),
        questionFrequency: avg(styleScores.questionFrequency),
        agreementStyle: avg(styleScores.agreementStyle),
      },
      totalAnalyzed: analyses.length,
    };
  }),

  // ============ Matching Heatmap Analysis ============
  generateHeatmap: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    // Gather all matching results with score breakdowns
    const results = await ctx.env.DB.prepare(
      `SELECT mr.sessionId, mr.compatibilityScore, mr.scoreBreakdown, ms.theme,
              COALESCE(u.name, 'Unknown') as friendName,
              CASE WHEN ms.initiatorUserId = ? THEN json_extract(ms.settings, '$.friendId') ELSE ms.initiatorUserId END as friendId
       FROM matching_results mr
       JOIN matching_sessions ms ON ms.id = mr.sessionId
       LEFT JOIN users u ON u.id = CASE WHEN ms.initiatorUserId = ? THEN json_extract(ms.settings, '$.friendId') ELSE ms.initiatorUserId END
       WHERE (ms.initiatorUserId = ? OR json_extract(ms.settings, '$.friendId') = ?)
       AND mr.scoreBreakdown IS NOT NULL
       ORDER BY mr.id DESC LIMIT 50`
    ).bind(ctx.userId, ctx.userId, ctx.userId, ctx.userId).all<any>();

    const heatmapData: any[] = [];
    const dimensions = ["skillMatch", "valueAlignment", "communicationStyle", "innovationPotential", "trustFactor", "personalityCompatibility"];

    for (const r of results.results ?? []) {
      const breakdown = parseJson<any>(r.scoreBreakdown) || {};
      const row: any = {
        sessionId: r.sessionId,
        friendName: r.friendName,
        friendId: r.friendId,
        theme: r.theme,
        overallScore: r.compatibilityScore,
      };
      for (const dim of dimensions) {
        row[dim] = breakdown[dim] || 0;
      }
      heatmapData.push(row);
    }

    // LLM clustering + weakness analysis
    const prompt = `以下のマッチングヒートマップデータを分析してください。

データ (友達×6次元スコア):
${JSON.stringify(heatmapData.slice(0, 20))}

6次元: skillMatch(スキル), valueAlignment(価値観), communicationStyle(コミュニケーション), innovationPotential(革新性), trustFactor(信頼), personalityCompatibility(人格互換性)

JSON形式で返してください:
{"clusters":[{"name":"クラスタ名","members":["友達名"],"characteristic":"特徴"}],"weaknesses":[{"dimension":"弱い次元","avgScore":数値,"affectedFriends":["友達名"],"reason":"原因"}],"suggestions":[{"title":"改善提案","description":"詳細","targetDimension":"対象次元","priority":"high|medium|low"}],"summary":"総合分析"}`;

    const analysisResp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let analysis: any = {};
    try { analysis = JSON.parse(analysisResp.content); } catch { analysis = { clusters: [], weaknesses: [], suggestions: [], summary: "分析中" }; }

    await ctx.env.DB.prepare(
      `INSERT INTO matching_heatmap_analyses (userId, heatmapData, clusters, weaknesses, suggestions) VALUES (?, ?, ?, ?, ?)`
    ).bind(ctx.userId, toJson(heatmapData), toJson(analysis.clusters), toJson(analysis.weaknesses), toJson(analysis.suggestions)).run();

    return { heatmapData, ...analysis };
  }),
  getHeatmap: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(
      `SELECT * FROM matching_heatmap_analyses WHERE userId=? ORDER BY createdAt DESC LIMIT 1`
    ).bind(ctx.userId).first<any>();
    if (!row) return null;
    return {
      ...row,
      heatmapData: parseJson<any[]>(row.heatmapData),
      clusters: parseJson<any[]>(row.clusters),
      weaknesses: parseJson<any[]>(row.weaknesses),
      suggestions: parseJson<any[]>(row.suggestions),
    };
  }),

  // ============ Emotion Flow Analysis ============
  analyzeEmotionFlow: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });

      const dialogueText = dialogues.results.map((d: any) =>
        `ターン${d.turnNumber} [${d.speaker}]: ${d.content}`
      ).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "emotion_flow", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM APIキーが未設定です" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたは対話感情分析の専門家です。マッチング対話の各ターンについて、2人の話者それぞれの感情を6次元（喜び/怒り/悲しみ/楽しさ/不安/自信）で0-100スコアで分析してください。また感情の転換ポイント（大きな変化があったターン）を検出し、話者間の感情同期度を算出してください。" },
        { role: "user", content: `以下の対話を分析してください:\n\n${dialogueText}\n\nJSON形式で回答:\n{\n  "turns": [{"turnNumber":1,"speaker":"...","emotions":{"joy":0,"anger":0,"sadness":0,"fun":0,"anxiety":0,"confidence":0}},...],"transitionPoints":[{"turnNumber":3,"description":"...","fromEmotion":"...","toEmotion":"...","trigger":"..."}],"syncScore":75,"summary":"..."}` }
      ], { maxTokens: 3000, temperature: 0.3 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed = { turns: [], transitionPoints: [], syncScore: 50, summary: result.content }; }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO emotion_flow_analyses (sessionId, userId, emotionData, transitionPoints, syncScore, summary) VALUES (?,?,?,?,?,?)`
      ).bind(
        input.sessionId, ctx.userId,
        toJson(parsed.turns || []),
        toJson(parsed.transitionPoints || []),
        parsed.syncScore ?? 50,
        parsed.summary || ""
      ).run();

      return { emotionData: parsed.turns || [], transitionPoints: parsed.transitionPoints || [], syncScore: parsed.syncScore ?? 50, summary: parsed.summary || "" };
    }),
  getEmotionFlow: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM emotion_flow_analyses WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        emotionData: parseJson<any[]>(row.emotionData) || [],
        transitionPoints: parseJson<any[]>(row.transitionPoints) || [],
      };
    }),
  getEmotionFlowHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT efa.id, efa.sessionId, efa.syncScore, efa.createdAt, ms.theme
       FROM emotion_flow_analyses efa
       JOIN matching_sessions ms ON ms.id = efa.sessionId
       WHERE efa.userId=?
       ORDER BY efa.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // ============ Multi-Perspective Replay ============
  generateMultiPerspective: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });

      const settings = parseJson<any>(session.settings) || {};
      const initiatorTwin = await ctx.env.DB.prepare(`SELECT name, personality FROM digital_twins WHERE userId=?`).bind(session.initiatorUserId).first<any>();
      const friendTwin = settings.friendId ? await ctx.env.DB.prepare(`SELECT name, personality FROM digital_twins WHERE userId=?`).bind(settings.friendId).first<any>() : null;

      const dialogueText = dialogues.results.map((d: any) => `ターン${d.turnNumber} [${d.speaker}]: ${d.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "multi_perspective", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたは対話分析の専門家です。マッチング対話を3つの異なる視点から再解釈してください。各視点で、各ターンの内心モノローグ（心の中で何を考えていたか）、戦略意図（何を狙っていたか）、感情変化（どう感じたか）を生成してください。" },
        { role: "user", content: `対話:\n${dialogueText}\n\n話者A: ${initiatorTwin?.name || "ツインA"}（性格: ${initiatorTwin?.personality || "不明"}）\n話者B: ${friendTwin?.name || "ツインB"}（性格: ${friendTwin?.personality || "不明"}）\n\nJSON:\n{"perspectives":{"myTwin":{"name":"${initiatorTwin?.name || "ツインA"}","turns":[{"turnNumber":1,"innerMonologue":"...","strategicIntent":"...","emotionChange":"..."}]},"opponentTwin":{"name":"${friendTwin?.name || "ツインB"}","turns":[{"turnNumber":1,"innerMonologue":"...","strategicIntent":"...","emotionChange":"..."}]},"observer":{"turns":[{"turnNumber":1,"analysis":"...","technique":"...","suggestion":"..."}]}},"perspectiveGap":{"summary":"3視点のギャップ要約","keyDifferences":["..."],"insights":["..."]}}` }
      ], { maxTokens: 4000, temperature: 0.5 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = {
          perspectives: {
            myTwin: { name: initiatorTwin?.name || "ツインA", turns: [] },
            opponentTwin: { name: friendTwin?.name || "ツインB", turns: [] },
            observer: { turns: [] }
          },
          perspectiveGap: { summary: result.content, keyDifferences: [], insights: [] }
        };
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO multi_perspective_replays (sessionId, userId, perspectives, perspectiveGap) VALUES (?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, toJson(parsed.perspectives || {}), toJson(parsed.perspectiveGap || {})).run();

      return parsed;
    }),
  getMultiPerspective: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM multi_perspective_replays WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        perspectives: parseJson<any>(row.perspectives) || {},
        perspectiveGap: parseJson<any>(row.perspectiveGap) || {},
      };
    }),

  // ============ AI Moderator Auto-Summary ============
  generateMatchingSummary: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT speaker, content, turnNumber FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();

      const result = await ctx.env.DB.prepare(
        `SELECT compatibilityScore, scoreBreakdown FROM matching_results WHERE sessionId=?`
      ).bind(input.sessionId).first<any>();

      const prompt = `あなたは中立的な第三者モデレーターです。以下のビジネスマッチング対話を要約してください。

テーマ: ${session.theme}
スコア: ${result?.compatibilityScore || 'N/A'}

対話:
${(dialogues.results ?? []).map((d: any) => `${d.speaker}: ${d.content}`).join('\n')}

JSON形式で返してください:
{
  "summary": "全体要約（3-5文）",
  "agreements": [{"item": "合意事項", "detail": "詳細"}],
  "openIssues": [{"item": "未解決課題", "detail": "詳細", "priority": "high|medium|low"}],
  "nextSteps": [{"step": "次ステップ", "owner": "担当者", "deadline": "推奨期限"}],
  "risks": [{"risk": "リスク", "impact": "影響", "mitigation": "軽減策"}]
}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let parsed: any = {};
      try { parsed = JSON.parse(resp.content); } catch {
        parsed = { summary: "要約生成中にエラーが発生しました", agreements: [], openIssues: [], nextSteps: [], risks: [] };
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_summaries (sessionId, userId, summary, agreements, openIssues, nextSteps, risks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        input.sessionId, ctx.userId, parsed.summary || "",
        toJson(parsed.agreements || []), toJson(parsed.openIssues || []),
        toJson(parsed.nextSteps || []), toJson(parsed.risks || [])
      ).run();

      return parsed;
    }),
  getMatchingSummary: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM matching_summaries WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        agreements: parseJson<any[]>(row.agreements),
        openIssues: parseJson<any[]>(row.openIssues),
        nextSteps: parseJson<any[]>(row.nextSteps),
        risks: parseJson<any[]>(row.risks),
        distributedTo: parseJson<string[]>(row.distributedTo),
      };
    }),
  distributeSummary: protectedProcedure
    .input(z.object({ sessionId: z.number(), channels: z.array(z.enum(["email", "slack", "line", "app"])) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const summary = await ctx.env.DB.prepare(
        `SELECT * FROM matching_summaries WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!summary) throw new TRPCError({ code: "NOT_FOUND", message: "要約がありません" });

      const user = await ctx.env.DB.prepare(`SELECT email, name FROM users WHERE id=?`).bind(ctx.userId).first<any>();

      for (const ch of input.channels) {
        if (ch === "email" && user?.email && (ctx.env as any).RESEND_API_KEY) {
          const agreements = parseJson<any[]>(summary.agreements) || [];
          const nextSteps = parseJson<any[]>(summary.nextSteps) || [];
          const html = `<h2>マッチング要約</h2><p>${summary.summary}</p>
            ${agreements.length ? '<h3>合意事項</h3><ul>' + agreements.map((a: any) => `<li><strong>${a.item}</strong>: ${a.detail}</li>`).join('') + '</ul>' : ''}
            ${nextSteps.length ? '<h3>次ステップ</h3><ul>' + nextSteps.map((s: any) => `<li><strong>${s.step}</strong> (${s.owner || '未定'})</li>`).join('') + '</ul>' : ''}`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${(ctx.env as any).RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: (ctx.env as any).RESEND_FROM_EMAIL || 'noreply@bunshin-ai.com', to: user.email, subject: '【分身AI】マッチング要約', html }),
          });
        }
        if (ch === "app") {
          await createNotification(ctx.env.DB, ctx.userId, 'matching_summary', 'マッチング要約', summary.summary?.slice(0, 100) || '', { link: `/matching/${input.sessionId}` });
        }
      }

      await ctx.env.DB.prepare(
        `UPDATE matching_summaries SET distributedTo=? WHERE sessionId=? AND userId=?`
      ).bind(toJson(input.channels), input.sessionId, ctx.userId).run();

      return { distributed: input.channels };
    }),
  rateSummary: protectedProcedure
    .input(z.object({ sessionId: z.number(), rating: z.enum(["up", "down"]) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE matching_summaries SET feedbackRating=? WHERE sessionId=? AND userId=?`
      ).bind(input.rating, input.sessionId, ctx.userId).run();
      return { rated: true };
    }),

  // === Phase 38: Cross-Culture Adapter ===
  analyzeCrossCulture: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const settings = parseJson<any>(session.settings) || {};
      const friendId = settings.friendId;

      let friendProfile: any = null;
      if (friendId) {
        friendProfile = await ctx.env.DB.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(friendId).first<any>();
      }

      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "cross_culture", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const turns = (dialogues.results ?? []).map((d: any) => `T${d.turnNumber}(${d.speakerRole}): ${d.message}`).join("\n");
      const profileInfo = friendProfile ? `相手プロフィール: ${friendProfile.industry || ""} ${friendProfile.company || ""} ${friendProfile.position || ""}` : "相手プロフィール: 不明";

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたは異文化ビジネスコミュニケーションの専門家です。対話と相手プロフィールから文化圏を推定し、文化的配慮ポイントとギャップを分析してください。JSON形式: { \"estimatedCulture\": \"日本/アメリカ/中国/韓国/欧州/その他\", \"culturePoints\": [{ \"category\": \"挨拶|敬語|直接性|交渉スタイル|時間感覚|意思決定\", \"advice\": \"具体的アドバイス\", \"importance\": \"high|medium|low\" }], \"gapAlerts\": [{ \"turnNumber\": 3, \"gap\": \"ギャップの内容\", \"suggestion\": \"改善提案\" }], \"crossCultureScore\": 0-100の異文化対応スコア }" },
        { role: "user", content: `${profileInfo}\n\n対話:\n${turns}` }
      ], { maxTokens: 2000 });

      let parsed: any = { estimatedCulture: "不明", culturePoints: [], gapAlerts: [], crossCultureScore: 50 };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed.culturePoints = [{ category: "全般", advice: result.content, importance: "medium" }]; }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO cross_culture_analyses (sessionId, userId, friendCulture, culturePoints, gapAlerts, crossCultureScore) VALUES (?,?,?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, parsed.estimatedCulture || "不明", toJson(parsed.culturePoints || []), toJson(parsed.gapAlerts || []), parsed.crossCultureScore || 0).run();

      return parsed;
    }),
  getCrossCulture: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM cross_culture_analyses WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, culturePoints: parseJson<any[]>(row.culturePoints) || [], gapAlerts: parseJson<any[]>(row.gapAlerts) || [] };
    }),
  getCrossCultureHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT cca.sessionId, cca.friendCulture, cca.crossCultureScore, cca.createdAt, ms.theme
      FROM cross_culture_analyses cca
      JOIN matching_sessions ms ON ms.id = cca.sessionId
      WHERE cca.userId=?
      ORDER BY cca.createdAt DESC LIMIT 20
    `).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // === Phase 36: Dialogue Quality Meter ===
  scoreDialogueQuality: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "NOT_FOUND", message: "対話データがありません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "quality_scoring", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const turns = (dialogues.results).map((d: any) => `ターン${d.turnNumber} (${d.speakerRole}): ${d.message}`).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネス対話の品質評価エキスパートです。各ターンを4軸（論理性logic/具体性specificity/創造性creativity/協調性cooperation、各0-100）で採点してください。品質が低いターンには改善ヒントを付けてください。JSON形式: { \"turnScores\": [{ \"turnNumber\": 1, \"logic\": 80, \"specificity\": 70, \"creativity\": 60, \"cooperation\": 90, \"hint\": \"改善ヒントあれば\" }], \"overall\": { \"logic\": 75, \"specificity\": 72, \"creativity\": 65, \"cooperation\": 85 }, \"improvementHints\": [\"全体的なヒント1\", \"ヒント2\"] }" },
        { role: "user", content: `対話:\n${turns}` }
      ], { maxTokens: 2000 });

      let parsed: any = { turnScores: [], overall: {}, improvementHints: [] };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed = { turnScores: [], overall: {}, improvementHints: [result.content] }; }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO dialogue_quality_scores (sessionId, userId, turnScores, overallScores, improvementHints) VALUES (?,?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, toJson(parsed.turnScores || []), toJson(parsed.overall || {}), toJson(parsed.improvementHints || [])).run();

      return parsed;
    }),
  getDialogueQuality: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM dialogue_quality_scores WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, turnScores: parseJson<any[]>(row.turnScores) || [], overallScores: parseJson<any>(row.overallScores) || {}, improvementHints: parseJson<any[]>(row.improvementHints) || [] };
    }),
  getQualityHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT dqs.sessionId, dqs.overallScores, dqs.createdAt, ms.theme
      FROM dialogue_quality_scores dqs
      JOIN matching_sessions ms ON ms.id = dqs.sessionId
      WHERE dqs.userId=?
      ORDER BY dqs.createdAt DESC LIMIT 20
    `).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, overallScores: parseJson<any>(r.overallScores) || {} }));
  }),

  // === Phase 37: Consensus Tracking ===
  trackConsensus: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "NOT_FOUND", message: "対話データがありません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "consensus_tracking", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const turns = (dialogues.results).map((d: any) => `ターン${d.turnNumber} (${d.speakerRole}): ${d.message}`).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネス対話の合意形成分析エキスパートです。以下の対話から合意事項と未合意事項を抽出してください。JSON形式: { \"agreements\": [{ \"topic\": \"合意した内容\", \"level\": \"full|partial\", \"turnNumber\": 3 }], \"disagreements\": [{ \"topic\": \"未合意の内容\", \"level\": \"unresolved|conflict\", \"turnNumber\": 5, \"followUp\": \"フォローアップ提案\" }], \"consensusRate\": 0-100の合意率, \"followUpTasks\": [{ \"task\": \"タスク内容\", \"priority\": \"high|medium|low\", \"relatedTopic\": \"関連トピック\" }] }" },
        { role: "user", content: `対話:\n${turns}` }
      ], { maxTokens: 2000 });

      let parsed: any = { agreements: [], disagreements: [], consensusRate: 0, followUpTasks: [] };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed = { agreements: [], disagreements: [], consensusRate: 0, followUpTasks: [{ task: result.content, priority: "medium", relatedTopic: "全般" }] }; }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO consensus_tracking (sessionId, userId, agreements, disagreements, consensusRate, followUpTasks) VALUES (?,?,?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, toJson(parsed.agreements || []), toJson(parsed.disagreements || []), parsed.consensusRate || 0, toJson(parsed.followUpTasks || [])).run();

      return parsed;
    }),
  getConsensus: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM consensus_tracking WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        agreements: parseJson<any[]>(row.agreements) || [],
        disagreements: parseJson<any[]>(row.disagreements) || [],
        followUpTasks: parseJson<any[]>(row.followUpTasks) || [],
      };
    }),
  getConsensusHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT ct.sessionId, ct.consensusRate, ct.createdAt, ms.theme
      FROM consensus_tracking ct
      JOIN matching_sessions ms ON ms.id = ct.sessionId
      WHERE ct.userId=?
      ORDER BY ct.createdAt DESC LIMIT 20
    `).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  getConsensusFollowUps: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT ct.sessionId, ct.followUpTasks, ms.theme
      FROM consensus_tracking ct
      JOIN matching_sessions ms ON ms.id = ct.sessionId
      WHERE ct.userId=?
      ORDER BY ct.createdAt DESC LIMIT 10
    `).bind(ctx.userId).all<any>();
    const allTasks: any[] = [];
    for (const r of (rows.results ?? []) as any[]) {
      const tasks = parseJson<any[]>(r.followUpTasks) || [];
      for (const t of tasks) {
        allTasks.push({ ...t, sessionId: r.sessionId, theme: r.theme });
      }
    }
    return allTasks;
  }),

  // === Phase 38: Second Opinion AI ===
  getSecondOpinion: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const matchResult = await ctx.env.DB.prepare(
        `SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`
      ).bind(input.sessionId).first<any>();
      if (!matchResult) throw new TRPCError({ code: "NOT_FOUND", message: "マッチング結果がありません" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      const turns = (dialogues.results ?? []).map((d: any) => `T${d.turnNumber}(${d.speakerRole}): ${d.message}`).join("\n");
      const originalScore = matchResult.compatibilityScore;
      const breakdown = parseJson<any>(matchResult.scoreBreakdown) || {};

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "second_opinion", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const perspectives = ["optimistic", "pessimistic", "practical"] as const;
      const labels = { optimistic: "楽観的", pessimistic: "悲観的", practical: "実務的" };
      const results: Record<string, any> = {};

      for (const p of perspectives) {
        const instruction = p === "optimistic"
          ? "最も楽観的な視点で、ポジティブな可能性やシナジーを強調して分析"
          : p === "pessimistic"
          ? "最も悲観的な視点で、リスクや課題を厳しく指摘して分析"
          : "実務的な視点で、実行可能性とROIを重視して分析";

        const r = await invokeLLM(llmConfig, [
          { role: "system", content: `あなたはビジネスマッチングの${labels[p]}アナリストです。${instruction}してください。JSON形式: { "score": 0-100, "summary": "要約", "keyPoints": ["ポイント1","ポイント2","ポイント3"], "risks": ["リスク"], "opportunities": ["チャンス"] }` },
          { role: "user", content: `元のスコア: ${originalScore}\nスコア内訳: ${JSON.stringify(breakdown)}\n\n対話:\n${turns}` }
        ], { maxTokens: 1000 });

        let parsed: any = { score: originalScore, summary: r.content, keyPoints: [], risks: [], opportunities: [] };
        try {
          const jsonMatch = r.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}
        results[p] = parsed;
      }

      const scores = perspectives.map(p => results[p]?.score || 0);
      const avgScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / 3);
      const maxDiff = Math.max(...scores) - Math.min(...scores);
      const divergenceScore = Math.round(maxDiff);

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO second_opinions (sessionId, userId, optimistic, pessimistic, practical, divergenceScore, consensusScore) VALUES (?,?,?,?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, toJson(results.optimistic), toJson(results.pessimistic), toJson(results.practical), divergenceScore, avgScore).run();

      return { optimistic: results.optimistic, pessimistic: results.pessimistic, practical: results.practical, divergenceScore, consensusScore: avgScore, originalScore };
    }),
  getSecondOpinionData: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM second_opinions WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        optimistic: parseJson<any>(row.optimistic) || {},
        pessimistic: parseJson<any>(row.pessimistic) || {},
        practical: parseJson<any>(row.practical) || {},
      };
    }),
  deepDiveSecondOpinion: protectedProcedure
    .input(z.object({ sessionId: z.number(), perspective: z.enum(["optimistic", "pessimistic", "practical"]), question: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const opinion = await ctx.env.DB.prepare(
        `SELECT * FROM second_opinions WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!opinion) throw new TRPCError({ code: "NOT_FOUND" });

      const perspectiveData = parseJson<any>(opinion[input.perspective]) || {};
      const labels: Record<string, string> = { optimistic: "楽観的", pessimistic: "悲観的", practical: "実務的" };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "second_opinion_dive", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは${labels[input.perspective]}視点のビジネスアナリストです。以下の分析に基づいてユーザーの質問に答えてください。` },
        { role: "user", content: `前回の分析: ${JSON.stringify(perspectiveData)}\n\n質問: ${input.question}` }
      ], { maxTokens: 1000 });

      return { answer: result.content, perspective: input.perspective };
    }),
  listSecondOpinions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT so.sessionId, so.divergenceScore, so.consensusScore, so.createdAt, ms.theme
      FROM second_opinions so
      JOIN matching_sessions ms ON ms.id = so.sessionId
      WHERE so.userId=?
      ORDER BY so.createdAt DESC LIMIT 20
    `).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  autoScoreQuality: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Check if already scored
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM dialogue_quality_scores WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (existing) return { alreadyScored: true, id: existing.id };

      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) return { alreadyScored: false, skipped: true };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "auto_quality_scoring", ctx.env);
      if (!llmConfig) return { alreadyScored: false, skipped: true };

      const turns = (dialogues.results).map((d: any) => `ターン${d.turnNumber} (${d.speakerRole}): ${d.message}`).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネス対話の品質評価エキスパートです。全体を4軸（論理性logic/具体性specificity/創造性creativity/協調性cooperation、各0-100）で採点してください。品質が低い場合は改善ヒントも。JSON形式: { \"overall\": { \"logic\": 75, \"specificity\": 72, \"creativity\": 65, \"cooperation\": 85 }, \"improvementHints\": [\"ヒント1\"] }" },
        { role: "user", content: `対話:\n${turns}` }
      ], { maxTokens: 800 });

      let parsed: any = { overall: {}, improvementHints: [] };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed.improvementHints = [result.content]; }

      const overall = parsed.overall || {};
      const avg = Math.round(((overall.logic || 0) + (overall.specificity || 0) + (overall.creativity || 0) + (overall.cooperation || 0)) / 4);

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO dialogue_quality_scores (sessionId, userId, turnScores, overallScores, improvementHints) VALUES (?,?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, toJson([]), toJson(overall), toJson(parsed.improvementHints || [])).run();

      // If quality is low (avg < 50), create notification
      if (avg < 50) {
        await createNotification(ctx.env.DB, ctx.userId, "quality_alert", "対話品質アラート",
          `セッション #${input.sessionId} の品質スコアが ${avg}点 です。改善提案を確認してください。`,
          { link: `/quality-meter` });
      }

      return { alreadyScored: false, scored: true, avg, overall, improvementHints: parsed.improvementHints || [] };
    }),

  // ============ Auto Quality Scoring + Trend ============
  getQualityTrendForDashboard: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT dqs.sessionId, dqs.overallScores, dqs.createdAt, ms.theme
      FROM dialogue_quality_scores dqs
      JOIN matching_sessions ms ON ms.id = dqs.sessionId
      WHERE dqs.userId=?
      ORDER BY dqs.createdAt DESC LIMIT 10
    `).bind(ctx.userId).all<any>();

    const items = (rows.results ?? []).map((r: any) => {
      const scores = parseJson<any>(r.overallScores) || {};
      const avg = Math.round(((scores.logic || 0) + (scores.specificity || 0) + (scores.creativity || 0) + (scores.cooperation || 0)) / 4);
      return { sessionId: r.sessionId, theme: r.theme, date: r.createdAt?.split("T")[0], avg, ...scores };
    });

    return items;
  }),
  getDashboardQualityTrend: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT dqs.sessionId, dqs.overallScores, ms.theme, ms.createdAt
       FROM dialogue_quality_scores dqs
       JOIN matching_sessions ms ON ms.id = dqs.sessionId
       WHERE dqs.userId=?
       ORDER BY ms.createdAt DESC LIMIT 5`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => {
      const scores = parseJson<any>(r.overallScores) || {};
      const avg = Math.round(((scores.logic || 0) + (scores.specificity || 0) + (scores.creativity || 0) + (scores.cooperation || 0)) / 4);
      return { sessionId: r.sessionId, theme: r.theme, avg, createdAt: r.createdAt };
    });
  }),


  // ============ Session Comparison Report ============
  compareSessions: protectedProcedure
    .input(z.object({ sessionIdA: z.number(), sessionIdB: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const [sessionA, sessionB] = await Promise.all([
        ctx.env.DB.prepare(`SELECT ms.*, mr.compatibilityScore, mr.scoreBreakdown, mr.recommendations FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.id=?`).bind(input.sessionIdA).first<any>(),
        ctx.env.DB.prepare(`SELECT ms.*, mr.compatibilityScore, mr.scoreBreakdown, mr.recommendations FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.id=?`).bind(input.sessionIdB).first<any>(),
      ]);
      if (!sessionA || !sessionB) throw new TRPCError({ code: 'NOT_FOUND', message: 'セッションが見つかりません' });
      const dialoguesA = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionIdA).all<any>();
      const dialoguesB = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionIdB).all<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, 'matching_compare', ctx.env);
      if (!llmConfig) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'LLM設定が見つかりません' });

      const breakdownA = parseJson<any>(sessionA.scoreBreakdown) || {};
      const breakdownB = parseJson<any>(sessionB.scoreBreakdown) || {};

      const result = await invokeLLM(llmConfig, [
        { role: 'system', content: 'あなたはビジネスマッチング分析の専門家です。2つのマッチングセッションを比較分析してください。JSONで回答してください。' },
        { role: 'user', content: `セッションA (テーマ: ${sessionA.theme}, スコア: ${sessionA.compatibilityScore || 0}):
スコア内訳: ${JSON.stringify(breakdownA)}
対話: ${(dialoguesA.results || []).map((d: any) => `${d.speaker}: ${(d.content || '').substring(0, 200)}`).join('\n')}

セッションB (テーマ: ${sessionB.theme}, スコア: ${sessionB.compatibilityScore || 0}):
スコア内訳: ${JSON.stringify(breakdownB)}
対話: ${(dialoguesB.results || []).map((d: any) => `${d.speaker}: ${(d.content || '').substring(0, 200)}`).join('\n')}

以下のJSON形式で比較分析してください:
{"scoreDiff": number, "improvements": ["改善点1", ...], "regressions": ["退化点1", ...], "highlights": ["ハイライト1", ...], "overallVerdict": "AとBの総合比較所見", "growthAreas": ["成長エリア1", ...]}
JSONのみ出力:` },
      ], { maxTokens: 800 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed = { overallVerdict: result.content }; }

      return {
        sessionA: { id: sessionA.id, theme: sessionA.theme, score: sessionA.compatibilityScore || 0, breakdown: breakdownA, createdAt: sessionA.createdAt },
        sessionB: { id: sessionB.id, theme: sessionB.theme, score: sessionB.compatibilityScore || 0, breakdown: breakdownB, createdAt: sessionB.createdAt },
        scoreDiff: parsed.scoreDiff ?? ((sessionA.compatibilityScore || 0) - (sessionB.compatibilityScore || 0)),
        improvements: parsed.improvements || [],
        regressions: parsed.regressions || [],
        highlights: parsed.highlights || [],
        overallVerdict: parsed.overallVerdict || '',
        growthAreas: parsed.growthAreas || [],
      };
    }),

  // ============ Action Plan Auto-generation ============
  generateActionPlan: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT ms.*, mr.compatibilityScore, mr.scoreBreakdown, mr.recommendations FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
      const dialogues = await ctx.env.DB.prepare(`SELECT speaker, content FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, 'action_plan', ctx.env);
      if (!llmConfig) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'LLM設定が見つかりません' });

      const result = await invokeLLM(llmConfig, [
        { role: 'system', content: 'あなたはビジネスアクションプラン作成の専門家です。マッチング対話の結果から具体的なアクションプランを生成してください。JSONで回答してください。' },
        { role: 'user', content: `テーマ: ${session.theme}
スコア: ${session.compatibilityScore || 0}
推奨: ${session.recommendations || 'なし'}
対話:
${(dialogues.results || []).map((d: any) => `${d.speaker}: ${(d.content || '').substring(0, 150)}`).join('\n')}

以下のJSON形式でアクションプランを生成:
{"title": "プランタイトル", "items": [{"text": "アクション内容", "priority": "high|medium|low", "dueOffset": 7, "done": false}, ...]}
5-8個のアクションアイテムを生成。dueOffsetは今日からの日数。JSONのみ出力:` },
      ], { maxTokens: 600 });

      let parsed: any = { title: `${session.theme} アクションプラン`, items: [] };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { /* use default */ }

      const items = (parsed.items || []).map((item: any, i: number) => ({
        id: i + 1,
        text: item.text || `アクション ${i + 1}`,
        priority: item.priority || 'medium',
        dueDate: new Date(Date.now() + (item.dueOffset || 7) * 86400000).toISOString().split('T')[0],
        done: false,
      }));

      const stmt = await ctx.env.DB.prepare(
        `INSERT INTO action_plans (sessionId, userId, title, items) VALUES (?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, parsed.title || `${session.theme} アクションプラン`, toJson(items)).run();

      return { id: (stmt.meta as any)?.last_row_id, title: parsed.title, items };
    }),
  getActionPlans: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ap.*, ms.theme FROM action_plans ap LEFT JOIN matching_sessions ms ON ms.id=ap.sessionId WHERE ap.userId=? ORDER BY ap.createdAt DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, items: parseJson<any[]>(r.items) || [] }));
  }),
  updatePlanItem: protectedProcedure
    .input(z.object({ planId: z.number(), itemId: z.number(), done: z.boolean().optional(), text: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const plan = await ctx.env.DB.prepare(`SELECT * FROM action_plans WHERE id=? AND userId=?`).bind(input.planId, ctx.userId).first<any>();
      if (!plan) throw new TRPCError({ code: 'NOT_FOUND' });
      const items = parseJson<any[]>(plan.items) || [];
      const item = items.find((i: any) => i.id === input.itemId);
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'アイテムが見つかりません' });
      if (input.done !== undefined) item.done = input.done;
      if (input.text !== undefined) item.text = input.text;
      await ctx.env.DB.prepare(`UPDATE action_plans SET items=?, updatedAt=datetime('now') WHERE id=?`).bind(toJson(items), input.planId).run();
      return { updated: true, items };
    }),
  deleteActionPlan: protectedProcedure
    .input(z.object({ planId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM action_plans WHERE id=? AND userId=?`).bind(input.planId, ctx.userId).run();
      return { deleted: true };
    }),

  // === Phase 39: Brainstorm Mode ===
  startBrainstorm: protectedProcedure
    .input(z.object({ theme: z.string().min(1), friendId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      let friendTwin: any = null;
      if (input.friendId) {
        friendTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
      }

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "brainstorm_diverge", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const twinA = twin.name || "ツインA";
      const twinB = friendTwin?.name || "ツインB";

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは2人のビジネスパーソン（${twinA}と${twinB}）のブレインストーミングをシミュレーションしてください。テーマ「${input.theme}」について、アイデア発散フェーズとして、お互いに自由にアイデアを出し合ってください。各アイデアには発案者を明記してください。最低8個のアイデアを出してください。JSON形式: { \"ideas\": [{ \"id\": 1, \"author\": \"${twinA}\", \"idea\": \"アイデア内容\", \"category\": \"カテゴリ名\" }] }` },
        { role: "user", content: `テーマ: ${input.theme}\n${twinA}の特徴: ${twin.description?.substring(0, 200) || "ビジネスプロフェッショナル"}\n${twinB}の特徴: ${friendTwin?.description?.substring(0, 200) || "ビジネスパートナー"}` }
      ], { maxTokens: 2000 });

      let ideas: any[] = [];
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) { const parsed = JSON.parse(jsonMatch[0]); ideas = parsed.ideas || []; }
      } catch { ideas = [{ id: 1, author: twinA, idea: result.content, category: "全般" }]; }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO brainstorm_sessions (userId, friendId, theme, phase, ideas) VALUES (?,?,?,?,?)`
      ).bind(ctx.userId, input.friendId || null, input.theme, "diverge", toJson(ideas)).run();

      return { sessionId: res.meta?.last_row_id, ideas, phase: "diverge" as const };
    }),
  convergeBrainstorm: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM brainstorm_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const ideas = parseJson<any[]>(session.ideas) || [];
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "brainstorm_converge", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const ideasText = ideas.map((i: any) => `#${i.id} [${i.author}] ${i.idea} (${i.category})`).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはアイデア収束の専門家です。以下のアイデアをクラスタリングし、上位3案の実行プランを生成してください。各アイデアの独自性/実現性/インパクトを評価してください。JSON形式: { \"clusters\": [{ \"name\": \"クラスタ名\", \"ideaIds\": [1,2], \"summary\": \"要約\" }], \"topPlans\": [{ \"rank\": 1, \"title\": \"プランタイトル\", \"description\": \"実行プラン\", \"basedOnIds\": [1,3], \"originality\": 0-100, \"feasibility\": 0-100, \"impact\": 0-100 }], \"evaluation\": { \"totalIdeas\": 8, \"uniqueCategories\": 4, \"bestIdea\": \"最も革新的なアイデア\", \"overallQuality\": \"全体評価\" } }" },
        { role: "user", content: `テーマ: ${session.theme}\n\nアイデア一覧:\n${ideasText}` }
      ], { maxTokens: 2000 });

      let parsed: any = { clusters: [], topPlans: [], evaluation: {} };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed.evaluation = { overallQuality: result.content }; }

      await ctx.env.DB.prepare(
        `UPDATE brainstorm_sessions SET phase='complete', clusters=?, topPlans=?, evaluation=? WHERE id=?`
      ).bind(toJson(parsed.clusters || []), toJson(parsed.topPlans || []), toJson(parsed.evaluation || {}), input.sessionId).run();

      return { clusters: parsed.clusters, topPlans: parsed.topPlans, evaluation: parsed.evaluation };
    }),
  getBrainstorm: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM brainstorm_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, ideas: parseJson<any[]>(row.ideas) || [], clusters: parseJson<any[]>(row.clusters) || [], topPlans: parseJson<any[]>(row.topPlans) || [], evaluation: parseJson<any>(row.evaluation) || null };
    }),
  listBrainstorms: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, theme, phase, friendId, createdAt FROM brainstorm_sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  summarizeVoiceNotes: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const notes = await ctx.env.DB.prepare(
        `SELECT * FROM matching_voice_notes WHERE sessionId=? AND userId=? ORDER BY createdAt ASC`
      ).bind(input.sessionId, ctx.userId).all<any>();
      if (!notes.results?.length) throw new TRPCError({ code: "NOT_FOUND", message: "音声ノートがありません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "voice_note_summary", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const allTranscripts = (notes.results ?? []).map((n: any) => `[ターン${n.turnNumber || "全体"}] ${n.transcript}`).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネスミーティングのノート分析専門家です。音声メモを分析し、要約とアクションアイテムを抽出してください。JSON形式: { \"summary\": \"全体要約\", \"actionItems\": [\"アクション1\", \"アクション2\"], \"keyInsights\": [\"洞察1\"] }" },
        { role: "user", content: `以下の音声メモを分析してください:\n${allTranscripts}` }
      ], { maxTokens: 1000 });

      let parsed: any = { summary: result.content, actionItems: [], keyInsights: [] };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {}

      // Update all notes with summary
      for (const note of notes.results ?? []) {
        await ctx.env.DB.prepare(
          `UPDATE matching_voice_notes SET summary=?, actionItems=? WHERE id=?`
        ).bind(parsed.summary, toJson(parsed.actionItems || []), (note as any).id).run();
      }

      return { summary: parsed.summary, actionItems: parsed.actionItems || [], keyInsights: parsed.keyInsights || [] };
    }),

  // ============ Daily Briefing ============
  generateBriefing: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const today = new Date().toISOString().split("T")[0];

    // Check if already generated today
    const existing = await ctx.env.DB.prepare(
      `SELECT * FROM daily_briefings WHERE userId=? AND briefingDate=?`
    ).bind(ctx.userId, today).first<any>();
    if (existing && !existing.isDismissed) {
      return {
        id: existing.id,
        content: existing.content,
        recommendations: parseJson<any[]>(existing.recommendations) || [],
        followUps: parseJson<any[]>(existing.followUps) || [],
        briefingDate: existing.briefingDate,
      };
    }

    // Gather context data
    const recentMatchings = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, ms.status, mr.compatibilityScore, ms.createdAt
       FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id
       WHERE ms.initiatorUserId=? ORDER BY ms.createdAt DESC LIMIT 5`
    ).bind(ctx.userId).all<any>();

    const pendingActions = await ctx.env.DB.prepare(
      `SELECT * FROM matching_action_items WHERE userId=? AND status IN ('pending','in_progress') ORDER BY dueDate ASC LIMIT 5`
    ).bind(ctx.userId).all<any>();

    const friendCount = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM friendships WHERE (userId1=? OR userId2=?) AND status='accepted'`
    ).bind(ctx.userId, ctx.userId).first<any>();

    const goals = await ctx.env.DB.prepare(
      `SELECT * FROM twin_goals WHERE userId=? AND status='active' LIMIT 3`
    ).bind(ctx.userId).all<any>();

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "daily_briefing", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

    const contextText = [
      `最近のマッチング: ${(recentMatchings.results ?? []).map((m: any) => `${m.theme}(${m.compatibilityScore || "未"}%)`).join(", ") || "なし"}`,
      `未完了アクション: ${(pendingActions.results ?? []).length}件`,
      `友達数: ${friendCount?.cnt || 0}`,
      `アクティブ目標: ${(goals.results ?? []).map((g: any) => g.title || g.goalType).join(", ") || "なし"}`,
    ].join("\n");

    const result = await invokeLLM(llmConfig, [
      { role: "system", content: "あなたはビジネスマッチングプラットフォームのAIアシスタントです。ユーザーの活動データから今日の推奨アクションをパーソナライズして提案してください。JSON形式: { \"greeting\": \"おはようございます...\", \"summary\": \"今日のサマリー\", \"recommendations\": [{ \"type\": \"matching|followup|goal|social\", \"title\": \"推奨タイトル\", \"description\": \"詳細\", \"priority\": \"high|medium|low\" }], \"followUps\": [{ \"friendName\": \"友達名\", \"reason\": \"フォローアップ理由\", \"suggestedAction\": \"提案アクション\" }] }" },
      { role: "user", content: `今日は${today}です。以下のデータに基づいて今日のブリーフィングを生成してください:\n${contextText}` }
    ], { maxTokens: 1500 });

    let parsed: any = { greeting: "", summary: result.content, recommendations: [], followUps: [] };
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}

    const content = parsed.greeting ? `${parsed.greeting}\n\n${parsed.summary}` : parsed.summary;

    const res = await ctx.env.DB.prepare(
      `INSERT OR REPLACE INTO daily_briefings (userId, briefingDate, content, recommendations, followUps) VALUES (?,?,?,?,?)`
    ).bind(ctx.userId, today, content, toJson(parsed.recommendations || []), toJson(parsed.followUps || [])).run();

    return {
      id: res.meta?.last_row_id,
      content,
      recommendations: parsed.recommendations || [],
      followUps: parsed.followUps || [],
      briefingDate: today,
    };
  }),
  getBriefing: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const today = new Date().toISOString().split("T")[0];
    const row = await ctx.env.DB.prepare(
      `SELECT * FROM daily_briefings WHERE userId=? AND briefingDate=? AND isDismissed=0`
    ).bind(ctx.userId, today).first<any>();
    if (!row) return null;
    return {
      id: row.id,
      content: row.content,
      recommendations: parseJson<any[]>(row.recommendations) || [],
      followUps: parseJson<any[]>(row.followUps) || [],
      briefingDate: row.briefingDate,
    };
  }),


  // ============ Dashboard Widget Data ============
  getDashboardBriefing: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const today = new Date().toISOString().split('T')[0];
    const briefing = await ctx.env.DB.prepare(
      `SELECT * FROM daily_briefings WHERE userId=? AND briefingDate=? AND isDismissed=0`
    ).bind(ctx.userId, today).first<any>();
    if (!briefing) return null;
    return {
      content: briefing.content,
      recommendations: parseJson<string[]>(briefing.recommendations) || [],
      followUps: parseJson<string[]>(briefing.followUps) || [],
    };
  }),
  dismissBriefing: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE daily_briefings SET isDismissed=1 WHERE id=? AND userId=?`
      ).bind(input.id, ctx.userId).run();
      return { dismissed: true };
    }),

});
