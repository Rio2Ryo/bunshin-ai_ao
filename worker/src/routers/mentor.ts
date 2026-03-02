import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson, getMyTwin } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const mentorRouter = router({
  getAdvice: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!myTwin) return { advice: null, stats: null };

    // Gather all data for comprehensive analysis
    const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
    
    // Matching history
    const matchings = await ctx.env.DB.prepare(
      `SELECT ms.theme, mr.compatibilityScore, mr.summary, mr.strengths, mr.challenges, mr.recommendations,
        dt.name as partnerName
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       LEFT JOIN digital_twins dt ON dt.id = CASE WHEN ms.twin1Id = ? THEN ms.twin2Id ELSE ms.twin1Id END
       WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt DESC LIMIT 20`
    ).bind(myTwin.id, ctx.userId).all<any>();

    // Chat activity
    const chatStats = await ctx.env.DB.prepare(
      `SELECT COUNT(DISTINCT cs.id) as sessionCount, COUNT(cm.id) as messageCount
       FROM chat_sessions cs
       LEFT JOIN chat_messages cm ON cm.sessionId = cs.id
       WHERE cs.userId = ?`
    ).bind(ctx.userId).first<any>();

    // Personality profile
    const personality = await ctx.env.DB.prepare(
      `SELECT bigFive, mbti, valueProfile FROM personality_profiles WHERE userId=? AND status='completed'`
    ).bind(ctx.userId).first<any>();

    // Feedback summary
    const feedback = await ctx.env.DB.prepare(
      `SELECT rating, COUNT(*) as cnt FROM dialogue_feedback WHERE userId=? GROUP BY rating`
    ).bind(ctx.userId).all<any>();
    const feedbackStats = { up: 0, down: 0 };
    for (const f of (feedback.results ?? []) as any[]) {
      if (f.rating === "up") feedbackStats.up = f.cnt;
      if (f.rating === "down") feedbackStats.down = f.cnt;
    }

    // Trust score
    const trustRow = await ctx.env.DB.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();

    // Friends count
    const friendsCount = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
    ).bind(ctx.userId, ctx.userId).first<any>();

    const matchResults = (matchings.results ?? []) as any[];
    const scores = matchResults.map((m: any) => parseFloat(m.compatibilityScore) || 0);
    const avgScore = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
    const highScoreMatches = matchResults.filter((m: any) => parseFloat(m.compatibilityScore) >= 70);
    
    const stats = {
      totalMatchings: matchResults.length,
      avgScore,
      highScoreCount: highScoreMatches.length,
      chatSessions: chatStats?.sessionCount ?? 0,
      chatMessages: chatStats?.messageCount ?? 0,
      trustScore: trustRow?.score ?? 0,
      friendsCount: friendsCount?.cnt ?? 0,
      feedbackUp: feedbackStats.up,
      feedbackDown: feedbackStats.down,
      hasMbti: !!personality?.mbti,
      hasBigFive: !!personality?.bigFive,
    };

    // Generate AI mentor advice
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
    if (!llmConfig) {
      return {
        advice: {
          summary: "AIメンターを利用するにはLLM APIキーを設定してください。",
          strengths: [] as string[],
          improvements: [] as string[],
          actionItems: [] as string[],
          weeklyGoal: null as string | null,
        },
        stats,
      };
    }

    const personalityCtx = personality
      ? `MBTI: ${personality.mbti || "未診断"}, Big Five: ${personality.bigFive ? "診断済み" : "未診断"}`
      : "人格診断: 未実施";

    const matchingSummary = matchResults.slice(0, 10).map((m: any) => {
      const s = parseJson<string[]>(m.strengths) || [];
      const c = parseJson<string[]>(m.challenges) || [];
      return `- ${m.partnerName}: ${m.theme} → ${m.compatibilityScore}%${s.length ? ` 強み:${s[0]}` : ""}${c.length ? ` 課題:${c[0]}` : ""}`;
    }).join("\n");

    const result = await invokeLLM(llmConfig, [
      {
        role: "system",
        content: `あなたはパーソナルAIビジネスメンターです。ユーザーの全データを分析し、具体的で実行可能なアドバイスを提供してください。
JSON形式で回答:
{
  "summary": "50-100文字の総合評価",
  "strengths": ["強み1", "強み2", "強み3"],
  "improvements": ["改善点1: 具体的アドバイス", "改善点2: 具体的アドバイス"],
  "actionItems": ["今週やるべきこと1", "今週やるべきこと2", "今週やるべきこと3"],
  "weeklyGoal": "今週の具体的なゴール",
  "insight": "データから読み取れるユニークな洞察（100文字程度）"
}`,
      },
      {
        role: "user",
        content: `## ユーザーデータ
ツイン名: ${myTwin.name}
プロフィール: ${profile?.displayName || ""} / ${profile?.company || ""} / ${profile?.industry || ""} / ${profile?.position || ""}
${personalityCtx}
信頼スコア: ${stats.trustScore}
友達数: ${stats.friendsCount}
チャットセッション: ${stats.chatSessions}（メッセージ数: ${stats.chatMessages}）
フィードバック: 高評価${stats.feedbackUp}件 / 低評価${stats.feedbackDown}件

## マッチング履歴（${stats.totalMatchings}件、平均スコア: ${stats.avgScore}%）
${matchingSummary || "マッチング実績なし"}

## 分析依頼
上記データに基づいて、ビジネス成長のための具体的なアドバイスを生成してください。`,
      },
    ], { maxTokens: 1024, temperature: 0.5 });

    let advice: any = {
      summary: "データを分析しました。",
      strengths: [],
      improvements: [],
      actionItems: [],
      weeklyGoal: null,
    };

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) advice = JSON.parse(jsonMatch[0]);
    } catch {
      // Keep default advice if parsing fails
    }

    return { advice, stats };
  }),

  getGrowthHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    // Get matching score trend over time
    const rows = await ctx.env.DB.prepare(
      `SELECT ms.createdAt, mr.compatibilityScore, ms.theme
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt ASC`
    ).bind(ctx.userId).all<any>();

    const dataPoints = ((rows.results ?? []) as any[]).map((r: any, i: number) => ({
      index: i + 1,
      date: r.createdAt?.slice(0, 10) || "",
      score: parseFloat(r.compatibilityScore) || 0,
      theme: r.theme,
    }));

    // Calculate growth metrics
    if (dataPoints.length >= 2) {
      const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
      const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));
      const firstAvg = firstHalf.reduce((a: number, b: any) => a + b.score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a: number, b: any) => a + b.score, 0) / secondHalf.length;
      return {
        dataPoints,
        growth: Math.round(secondAvg - firstAvg),
        trend: secondAvg > firstAvg ? "improving" : secondAvg < firstAvg ? "declining" : "stable",
      };
    }

    return { dataPoints, growth: 0, trend: "stable" as const };
  }),
});
