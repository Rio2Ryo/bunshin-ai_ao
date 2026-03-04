import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin, recordFriendActivity } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { updateMatchingStreakForUser } from "./matching-shared";

export const matchingSocialRouter = router({

  // ============ Feature 2: Matching Analytics Dashboard ============
  getScoreHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ms.id as sessionId, ms.theme, ms.createdAt, mr.compatibilityScore
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt ASC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      sessionId: r.sessionId,
      theme: r.theme,
      score: r.compatibilityScore ? parseFloat(r.compatibilityScore) : 0,
      date: r.createdAt?.slice(0, 10) || "",
    }));
  }),
  getPersonalityHeatmap: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    // Get latest scoreBreakdown per friend
    const rows = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.twin2Id, mr.scoreBreakdown, mr.compatibilityScore,
        dt.name as friendTwinName, dt.userId as friendUserId, u.name as friendName
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       LEFT JOIN digital_twins dt ON dt.id = ms.twin2Id
       LEFT JOIN users u ON u.id = dt.userId
       WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt DESC`
    ).bind(ctx.userId).all<any>();

    // Deduplicate: keep latest per friend
    const seen = new Set<number>();
    const heatmapData: any[] = [];
    for (const r of rows.results ?? []) {
      const fId = r.friendUserId;
      if (!fId || seen.has(fId)) continue;
      seen.add(fId);
      const breakdown = parseJson<any>(r.scoreBreakdown) || {};
      heatmapData.push({
        friendId: fId,
        friendName: r.friendName || r.friendTwinName || `User #${fId}`,
        dimensions: {
          skillMatch: breakdown.skillMatch?.score ?? 0,
          valueAlignment: breakdown.valueAlignment?.score ?? 0,
          communicationStyle: breakdown.communicationStyle?.score ?? 0,
          businessGoalFit: breakdown.businessGoalFit?.score ?? 0,
          complementaryStrengths: breakdown.complementaryStrengths?.score ?? 0,
          personalityCompatibility: breakdown.personalityCompatibility?.score ?? 0,
        },
        totalScore: r.compatibilityScore ? parseFloat(r.compatibilityScore) : 0,
      });
    }
    return heatmapData;
  }),
  getFriendCompatibilitySummary: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT dt.userId as friendUserId, u.name as friendName,
        up.avatarUrl,
        COUNT(ms.id) as matchCount,
        AVG(mr.compatibilityScore) as avgScore,
        MAX(mr.compatibilityScore) as maxScore,
        ms.theme as latestTheme
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       LEFT JOIN digital_twins dt ON dt.id = ms.twin2Id
       LEFT JOIN users u ON u.id = dt.userId
       LEFT JOIN user_profiles up ON up.userId = dt.userId
       WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
       GROUP BY dt.userId
       ORDER BY avgScore DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      friendId: r.friendUserId,
      friendName: r.friendName || `User #${r.friendUserId}`,
      avatarUrl: r.avatarUrl || null,
      avgScore: r.avgScore ? Math.round(parseFloat(r.avgScore)) : 0,
      maxScore: r.maxScore ? Math.round(parseFloat(r.maxScore)) : 0,
      matchCount: r.matchCount ?? 0,
      latestTheme: r.latestTheme || "",
    }));
  }),

  // ============ Feature 3: Twin Learning Feedback ============
  rateTurn: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      turnNumber: z.number(),
      rating: z.enum(["up", "down"]),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Verify session exists
      const session = await ctx.env.DB.prepare(`SELECT id FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO dialogue_feedback (sessionId, turnNumber, userId, rating, comment, createdAt)
         VALUES (?,?,?,?,?,datetime('now'))`
      ).bind(input.sessionId, input.turnNumber, ctx.userId, input.rating, input.comment || null).run();

      return { success: true };
    }),
  getFeedback: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM dialogue_feedback WHERE sessionId=? AND userId=? ORDER BY turnNumber`
      ).bind(input.sessionId, ctx.userId).all<any>();
      return rows.results ?? [];
    }),
  applyFeedback: protectedProcedure
    .input(z.object({ twinId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Verify twin ownership
      const twin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=? AND userId=?`).bind(input.twinId, ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      // Collect all feedback for sessions involving this twin
      const feedbackRows = await ctx.env.DB.prepare(
        `SELECT df.*, md.content as dialogueContent, md.speakerTwinId,
          ms.theme
         FROM dialogue_feedback df
         JOIN matching_dialogues md ON md.sessionId = df.sessionId AND md.turnNumber = df.turnNumber
         JOIN matching_sessions ms ON ms.id = df.sessionId
         WHERE df.userId = ? AND (ms.twin1Id = ? OR ms.twin2Id = ?)
         ORDER BY df.createdAt DESC
         LIMIT 50`
      ).bind(ctx.userId, input.twinId, input.twinId).all<any>();

      const feedback = feedbackRows.results ?? [];
      if (feedback.length === 0) {
        return { adjusted: false, message: "フィードバックデータがありません" };
      }

      // Format feedback for LLM analysis
      const upTurns = feedback.filter((f: any) => f.rating === "up");
      const downTurns = feedback.filter((f: any) => f.rating === "down");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) {
        return { adjusted: false, message: "LLM APIキーが未設定です" };
      }

      const feedbackSummary = `## フィードバック分析
### 高評価 (${upTurns.length}件):
${upTurns.slice(0, 10).map((f: any) => `- [${f.theme}] "${(f.dialogueContent || "").slice(0, 100)}"${f.comment ? ` (コメント: ${f.comment})` : ""}`).join("\n")}

### 低評価 (${downTurns.length}件):
${downTurns.slice(0, 10).map((f: any) => `- [${f.theme}] "${(f.dialogueContent || "").slice(0, 100)}"${f.comment ? ` (コメント: ${f.comment})` : ""}`).join("\n")}

### 現在のツイン設定:
- 名前: ${twin.name}
- 性格: ${twin.personality || "未設定"}
- 説明: ${twin.description || "未設定"}`;

      const result = await invokeLLM(llmConfig, [
        {
          role: "system",
          content: `あなたはデジタルツインの人格パラメータを最適化する専門家です。
ユーザーのフィードバック（高評価/低評価）パターンを分析し、ツインの性格設定の調整を提案してください。
JSON形式で出力: {"personalityUpdate": "新しい性格設定テキスト", "descriptionUpdate": "新しい説明テキスト(変更不要ならnull)", "reasoning": "調整理由の説明"}`,
        },
        { role: "user", content: feedbackSummary },
      ], { maxTokens: 1024, temperature: 0.4 });

      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const adjustments = JSON.parse(jsonMatch[0]);
          const updates: string[] = [];
          const params: any[] = [];

          if (adjustments.personalityUpdate) {
            updates.push("personality=?");
            params.push(adjustments.personalityUpdate);
          }
          if (adjustments.descriptionUpdate) {
            updates.push("description=?");
            params.push(adjustments.descriptionUpdate);
          }
          if (updates.length > 0) {
            updates.push("updatedAt=datetime('now')");
            params.push(input.twinId);
            await ctx.env.DB.prepare(
              `UPDATE digital_twins SET ${updates.join(",")} WHERE id=?`
            ).bind(...params).run();
          }

          return {
            adjusted: true,
            reasoning: adjustments.reasoning || "フィードバックに基づいてパラメータを調整しました",
            feedbackCount: { up: upTurns.length, down: downTurns.length },
          };
        }
      } catch { /* parse error */ }

      return { adjusted: false, message: "LLM分析の結果を解析できませんでした" };
    }),

  // ============ Phase 18: マッチングリプレイ・ハイライト ============
  generateHighlights: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB
        .prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id = ?`)
        .bind(input.sessionId)
        .first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      if (session.initiatorUserId !== ctx.userId) {
        // Check if user is twin2 owner
        const twin2 = await ctx.env.DB.prepare(`SELECT userId FROM digital_twins WHERE id = ?`).bind(session.twin2Id).first<any>();
        if (!twin2 || twin2.userId !== ctx.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "このセッションへのアクセス権がありません" });
        }
      }

      const dialogues = await ctx.env.DB
        .prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId = ? ORDER BY turnNumber ASC`)
        .bind(input.sessionId)
        .all<any>();
      if (!dialogues.results || dialogues.results.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "対話が見つかりません" });
      }

      const results = await ctx.env.DB
        .prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId = ?`)
        .bind(input.sessionId)
        .first<any>();

      const dialogueText = dialogues.results.map((d: any) =>
        `Turn ${d.turnNumber} (Twin ${d.speakerTwinId}): ${d.content}`
      ).join("\n");

      const resultSummary = results ? `\nマッチング結果: スコア ${results.compatibilityScore}, サマリー: ${results.summary || "N/A"}` : "";

      const systemPrompt = `あなたはマッチング対話の分析エキスパートです。対話のターンを分析し、最も重要な3〜5つのモーメントを特定してください。
返答は必ず以下のJSON形式のみで返してください。説明文は不要です。
{
  "highlights": [
    {
      "turnNumber": <number>,
      "title": "<短いタイトル>",
      "reason": "<なぜ重要か>",
      "impact": "high" | "medium" | "low",
      "category": "turning_point" | "agreement" | "insight" | "conflict" | "breakthrough"
    }
  ]
}`;

      const userPrompt = `以下のマッチング対話を分析し、最も重要なモーメントを特定してください:\n\n${dialogueText}${resultSummary}`;

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) { return { highlights: [{ turnNumber: 1, title: "API未設定", reason: "LLM APIキーが設定されていません", impact: "low" as const, category: "insight" as const }] }; }
      const llmResult = await invokeLLM(llmConfig, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], { maxTokens: 2048, temperature: 0.5 });
      const raw = llmResult.content;

      let highlights: any[] = [];
      try {
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        highlights = parsed.highlights || [];
      } catch {
        highlights = [{ turnNumber: 1, title: "対話開始", reason: "解析に失敗しました", impact: "low" as const, category: "insight" as const }];
      }

      await ctx.env.DB
        .prepare(`INSERT OR REPLACE INTO matching_highlights (sessionId, highlights, createdAt) VALUES (?, ?, datetime('now'))`)
        .bind(input.sessionId, toJson(highlights))
        .run();

      return { highlights };
    }),
  getHighlights: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB
        .prepare(`SELECT * FROM matching_highlights WHERE sessionId = ?`)
        .bind(input.sessionId)
        .first<any>();
      if (!row) return { highlights: [] };
      return { highlights: parseJson<any[]>(row.highlights) || [] };
    }),
  shareHighlights: protectedProcedure
    .input(z.object({ sessionId: z.number(), postToFeed: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB
        .prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id = ? AND initiatorUserId = ?`)
        .bind(input.sessionId, ctx.userId)
        .first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      // Generate share token
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const shareToken = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

      // Save share token to session settings
      const currentSettings = parseJson<any>(session.settings) || {};
      currentSettings.highlightShareToken = shareToken;
      await ctx.env.DB
        .prepare(`UPDATE matching_sessions SET settings = ? WHERE id = ?`)
        .bind(toJson(currentSettings), input.sessionId)
        .run();

      let feedPosted = false;
      if (input.postToFeed) {
        const highlightRow = await ctx.env.DB
          .prepare(`SELECT highlights FROM matching_highlights WHERE sessionId = ?`)
          .bind(input.sessionId)
          .first<any>();
        const highlights = highlightRow ? parseJson<any[]>(highlightRow.highlights) || [] : [];
        const summary = highlights.slice(0, 3).map((h: any) => h.title).join(", ");
        const feedData = toJson({ sessionId: input.sessionId, shareToken, highlightsSummary: summary, theme: session.theme });
        await ctx.env.DB
          .prepare(`INSERT INTO feed_items (userId, type, data, visibility, createdAt) VALUES (?, 'highlight', ?, 'friends', datetime('now'))`)
          .bind(ctx.userId, feedData)
          .run();
        feedPosted = true;
      }

      return { shareToken, feedPosted };
    }),

  // ============ Phase 18: マッチングチャレンジモード ============
  createChallenge: protectedProcedure
    .input(z.object({
      theme: z.string(),
      description: z.string().optional(),
      endsAt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const endsAt = input.endsAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
      const result = await ctx.env.DB
        .prepare(`INSERT INTO matching_challenges (creatorId, theme, description, status, startsAt, endsAt, createdAt) VALUES (?, ?, ?, 'active', datetime('now'), ?, datetime('now'))`)
        .bind(ctx.userId, input.theme, input.description || null, endsAt)
        .run();
      return { challengeId: result.meta.last_row_id };
    }),
  joinChallenge: protectedProcedure
    .input(z.object({ challengeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const challenge = await ctx.env.DB
        .prepare(`SELECT * FROM matching_challenges WHERE id = ?`)
        .bind(input.challengeId)
        .first<any>();
      if (!challenge) throw new TRPCError({ code: "NOT_FOUND", message: "チャレンジが見つかりません" });
      if (challenge.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "このチャレンジは終了しています" });

      // Check if already joined
      const existing = await ctx.env.DB
        .prepare(`SELECT id FROM challenge_participants WHERE challengeId = ? AND userId = ?`)
        .bind(input.challengeId, ctx.userId)
        .first<any>();
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "すでに参加しています" });

      await ctx.env.DB
        .prepare(`INSERT INTO challenge_participants (challengeId, userId, joinedAt) VALUES (?, ?, datetime('now'))`)
        .bind(input.challengeId, ctx.userId)
        .run();
      return { joined: true };
    }),
  submitChallengeResult: protectedProcedure
    .input(z.object({ challengeId: z.number(), sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Verify participant
      const participant = await ctx.env.DB
        .prepare(`SELECT * FROM challenge_participants WHERE challengeId = ? AND userId = ?`)
        .bind(input.challengeId, ctx.userId)
        .first<any>();
      if (!participant) throw new TRPCError({ code: "BAD_REQUEST", message: "チャレンジに参加していません" });

      // Verify session belongs to user
      const session = await ctx.env.DB
        .prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id = ? AND initiatorUserId = ?`)
        .bind(input.sessionId, ctx.userId)
        .first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "マッチングセッションが見つかりません" });

      // Get score from results
      const result = await ctx.env.DB
        .prepare(`SELECT compatibilityScore FROM matching_results WHERE sessionId = ?`)
        .bind(input.sessionId)
        .first<any>();
      if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "マッチング結果がまだありません" });

      const score = Math.round(result.compatibilityScore || 0);

      // Update participant with result
      await ctx.env.DB
        .prepare(`UPDATE challenge_participants SET sessionId = ?, score = ?, submittedAt = datetime('now') WHERE challengeId = ? AND userId = ?`)
        .bind(input.sessionId, score, input.challengeId, ctx.userId)
        .run();

      // Calculate rank
      const allParticipants = await ctx.env.DB
        .prepare(`SELECT userId, score FROM challenge_participants WHERE challengeId = ? AND score IS NOT NULL ORDER BY score DESC`)
        .bind(input.challengeId)
        .all<any>();
      const rank = (allParticipants.results || []).findIndex((p: any) => p.userId === ctx.userId) + 1;

      // Award points: 10 for participation
      let pointsToAward = 10;
      // Extra 50 if top score
      if (rank === 1) pointsToAward += 50;

      // Ensure user_points row exists
      await ctx.env.DB
        .prepare(`INSERT OR IGNORE INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired) VALUES (?, 0, 0, 0, 0)`)
        .bind(ctx.userId)
        .run();

      // Get current balance for balanceAfter calculation
      const currentPoints = await ctx.env.DB
        .prepare(`SELECT balance FROM user_points WHERE userId = ?`)
        .bind(ctx.userId)
        .first<any>();
      const newBalance = (currentPoints?.balance || 0) + pointsToAward;

      await ctx.env.DB
        .prepare(`UPDATE user_points SET balance = balance + ?, totalEarned = totalEarned + ?, lastActivityAt = datetime('now'), updatedAt = datetime('now') WHERE userId = ?`)
        .bind(pointsToAward, pointsToAward, ctx.userId)
        .run();

      await ctx.env.DB
        .prepare(`INSERT INTO point_transactions (userId, amount, type, balanceAfter, actionType, description, createdAt) VALUES (?, ?, 'earned', ?, 'challenge', ?, datetime('now'))`)
        .bind(ctx.userId, pointsToAward, newBalance, `チャレンジ参加${rank === 1 ? " + トップスコアボーナス" : ""}`)
        .run();

      // Update pointsAwarded on participant
      await ctx.env.DB
        .prepare(`UPDATE challenge_participants SET pointsAwarded = ? WHERE challengeId = ? AND userId = ?`)
        .bind(pointsToAward, input.challengeId, ctx.userId)
        .run();

      return { score, rank };
    }),
  getChallengeLeaderboard: protectedProcedure
    .input(z.object({ challengeId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const challenge = await ctx.env.DB
        .prepare(`SELECT * FROM matching_challenges WHERE id = ?`)
        .bind(input.challengeId)
        .first<any>();
      if (!challenge) throw new TRPCError({ code: "NOT_FOUND", message: "チャレンジが見つかりません" });

      const participants = await ctx.env.DB
        .prepare(`
          SELECT cp.userId, cp.score, cp.sessionId, cp.joinedAt, cp.submittedAt, cp.pointsAwarded,
                 u.email, up.displayName, up.avatarUrl
          FROM challenge_participants cp
          LEFT JOIN users u ON u.id = cp.userId
          LEFT JOIN user_profiles up ON up.userId = cp.userId
          WHERE cp.challengeId = ?
          ORDER BY cp.score DESC NULLS LAST, cp.joinedAt ASC
        `)
        .bind(input.challengeId)
        .all<any>();

      const leaderboard = (participants.results || []).map((p: any, idx: number) => ({
        rank: p.score != null ? idx + 1 : null,
        userId: p.userId,
        name: p.displayName || p.email || "Unknown",
        avatarUrl: p.avatarUrl || null,
        score: p.score,
        sessionId: p.sessionId,
        joinedAt: p.joinedAt,
        submittedAt: p.submittedAt,
        pointsAwarded: p.pointsAwarded,
      }));

      return {
        challenge: {
          id: challenge.id,
          theme: challenge.theme,
          description: challenge.description,
          status: challenge.status,
          startsAt: challenge.startsAt,
          endsAt: challenge.endsAt,
          creatorId: challenge.creatorId,
        },
        leaderboard,
      };
    }),
  listChallenges: protectedProcedure
    .query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const challenges = await ctx.env.DB
        .prepare(`SELECT * FROM matching_challenges WHERE status = 'active' OR createdAt > datetime('now', '-30 days') ORDER BY createdAt DESC LIMIT 50`)
        .all<any>();

      const result = [];
      for (const c of (challenges.results || [])) {
        const stats = await ctx.env.DB
          .prepare(`SELECT COUNT(*) as participantCount, MAX(score) as topScore FROM challenge_participants WHERE challengeId = ?`)
          .bind(c.id)
          .first<any>();

        const myParticipation = await ctx.env.DB
          .prepare(`SELECT * FROM challenge_participants WHERE challengeId = ? AND userId = ?`)
          .bind(c.id, ctx.userId)
          .first<any>();

        result.push({
          id: c.id,
          theme: c.theme,
          description: c.description,
          status: c.status,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          creatorId: c.creatorId,
          createdAt: c.createdAt,
          participantCount: stats?.participantCount || 0,
          topScore: stats?.topScore || null,
          myParticipation: myParticipation ? {
            joined: true,
            score: myParticipation.score,
            sessionId: myParticipation.sessionId,
            submittedAt: myParticipation.submittedAt,
          } : null,
        });
      }

      return result;

    }),

  // ============ Peer Review (360-degree feedback) ============
  submitPeerReview: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      targetUserId: z.number(),
      persuasion: z.number().min(1).max(5),
      sincerity: z.number().min(1).max(5),
      expertise: z.number().min(1).max(5),
      flexibility: z.number().min(1).max(5),
      originality: z.number().min(1).max(5),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (ctx.userId === input.targetUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分自身を評価できません" });
      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_peer_reviews (sessionId, reviewerId, targetUserId, persuasion, sincerity, expertise, flexibility, originality, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(input.sessionId, ctx.userId, input.targetUserId, input.persuasion, input.sincerity, input.expertise, input.flexibility, input.originality, input.comment || null).run();
      return { submitted: true };
    }),
  getPeerReviews: protectedProcedure
    .input(z.object({ sessionId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let query = `SELECT mpr.*, u.name as reviewerName FROM matching_peer_reviews mpr LEFT JOIN users u ON u.id = mpr.reviewerId WHERE mpr.targetUserId = ?`;
      const binds: any[] = [ctx.userId];
      if (input.sessionId) { query += ` AND mpr.sessionId = ?`; binds.push(input.sessionId); }
      query += ` ORDER BY mpr.createdAt DESC`;
      const rows = await ctx.env.DB.prepare(query).bind(...binds).all<any>();
      return rows.results ?? [];
    }),
  getSelfVsPeerGap: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    // Peer averages (received reviews)
    const peerAvg = await ctx.env.DB.prepare(
      `SELECT AVG(persuasion) as avgPersuasion, AVG(sincerity) as avgSincerity, AVG(expertise) as avgExpertise, AVG(flexibility) as avgFlexibility, AVG(originality) as avgOriginality, COUNT(*) as reviewCount FROM matching_peer_reviews WHERE targetUserId=?`
    ).bind(ctx.userId).first<any>();

    // Self reviews (reviews I gave to myself — actually we'll use matching scores as self-assessment proxy)
    const selfAvg = await ctx.env.DB.prepare(
      `SELECT AVG(persuasion) as avgPersuasion, AVG(sincerity) as avgSincerity, AVG(expertise) as avgExpertise, AVG(flexibility) as avgFlexibility, AVG(originality) as avgOriginality, COUNT(*) as reviewCount FROM matching_peer_reviews WHERE reviewerId=? AND targetUserId != ?`
    ).bind(ctx.userId, ctx.userId).first<any>();

    return {
      peer: {
        persuasion: Math.round((peerAvg?.avgPersuasion || 0) * 10) / 10,
        sincerity: Math.round((peerAvg?.avgSincerity || 0) * 10) / 10,
        expertise: Math.round((peerAvg?.avgExpertise || 0) * 10) / 10,
        flexibility: Math.round((peerAvg?.avgFlexibility || 0) * 10) / 10,
        originality: Math.round((peerAvg?.avgOriginality || 0) * 10) / 10,
        reviewCount: peerAvg?.reviewCount || 0,
      },
      selfGiven: {
        persuasion: Math.round((selfAvg?.avgPersuasion || 0) * 10) / 10,
        sincerity: Math.round((selfAvg?.avgSincerity || 0) * 10) / 10,
        expertise: Math.round((selfAvg?.avgExpertise || 0) * 10) / 10,
        flexibility: Math.round((selfAvg?.avgFlexibility || 0) * 10) / 10,
        originality: Math.round((selfAvg?.avgOriginality || 0) * 10) / 10,
        reviewCount: selfAvg?.reviewCount || 0,
      },
    };
  }),
  getPeerReviewAISuggestions: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    const reviews = await ctx.env.DB.prepare(
      `SELECT persuasion, sincerity, expertise, flexibility, originality, comment FROM matching_peer_reviews WHERE targetUserId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    const prompt = `以下は私のツインに対する相手からの360度評価データです。改善優先度を分析し、JSON配列で返してください。

評価データ:
${JSON.stringify(reviews.results ?? [])}

5軸: 説得力(persuasion), 誠実さ(sincerity), 専門性(expertise), 柔軟性(flexibility), 独自性(originality) (各1-5)

JSON形式: [{"dimension":"軸名","currentAvg":数値,"priority":"high|medium|low","suggestion":"具体的改善提案"}]`;

    const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let suggestions: any[] = [];
    try { const p = JSON.parse(result.content); suggestions = Array.isArray(p) ? p : p.suggestions || []; } catch { suggestions = [{ dimension: "総合", currentAvg: 0, priority: "medium", suggestion: "評価データを増やしてください" }]; }
    return { suggestions };
  }),

  // ============ Twin Performance Benchmark ============
  generateBenchmark: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    // Gather my twin's stats
    const myScores = await ctx.env.DB.prepare(
      `SELECT mr.compatibilityScore, mr.scoreBreakdown FROM matching_results mr JOIN matching_sessions ms ON ms.id = mr.sessionId WHERE ms.initiatorUserId = ? AND mr.compatibilityScore IS NOT NULL ORDER BY mr.id DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();

    // Gather anonymous global stats
    const globalStats = await ctx.env.DB.prepare(
      `SELECT AVG(mr.compatibilityScore) as globalAvg, COUNT(mr.id) as globalCount, MIN(mr.compatibilityScore) as globalMin, MAX(mr.compatibilityScore) as globalMax FROM matching_results mr WHERE mr.compatibilityScore IS NOT NULL`
    ).first<any>();

    // Skill levels
    const skills = await ctx.env.DB.prepare(
      `SELECT * FROM twin_skill_levels WHERE twinId=?`
    ).bind(twin.id).all<any>();

    // Profile info
    const profile = await ctx.env.DB.prepare(
      `SELECT industry, position FROM user_profiles WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const myAvg = (myScores.results ?? []).length > 0
      ? Math.round((myScores.results ?? []).reduce((s: number, r: any) => s + (r.compatibilityScore || 0), 0) / (myScores.results ?? []).length)
      : 0;

    const prompt = `以下のデータを分析し、ツインのパフォーマンスベンチマークをJSON形式で返してください。

自分のツイン:
- 名前: ${twin.name}
- 人格: ${twin.personality || '未設定'}
- 業界: ${profile?.industry || '不明'}
- 平均スコア: ${myAvg}
- マッチング数: ${(myScores.results ?? []).length}
- スキル: ${JSON.stringify(skills.results ?? [])}

グローバル統計:
- 全体平均: ${Math.round(globalStats?.globalAvg || 0)}
- 全体件数: ${globalStats?.globalCount || 0}
- 最低: ${globalStats?.globalMin || 0}
- 最高: ${globalStats?.globalMax || 0}

JSON形式:
{"percentile":0-100,"industryPercentile":0-100,"skillPercentiles":{"skillName":数値},"weaknesses":[{"area":"弱点","score":数値,"suggestion":"改善案"}],"topPatterns":["トップ10%の特徴1","特徴2"],"improvements":[{"action":"具体的アクション","impact":"high|medium|low","description":"詳細"}],"summary":"総合評価"}`;

    const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let benchmark: any = {};
    try { benchmark = JSON.parse(result.content); } catch { benchmark = { percentile: 50, summary: "ベンチマーク分析中", weaknesses: [], topPatterns: [], improvements: [] }; }

    const percentiles = toJson({ overall: benchmark.percentile, industry: benchmark.industryPercentile, skills: benchmark.skillPercentiles });

    await ctx.env.DB.prepare(
      `INSERT INTO twin_benchmarks (userId, twinId, benchmarkData, percentiles, weaknesses, topPatterns, improvements) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(ctx.userId, twin.id, toJson(benchmark), percentiles, toJson(benchmark.weaknesses), toJson(benchmark.topPatterns), toJson(benchmark.improvements)).run();

    return benchmark;
  }),
  getBenchmark: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(
      `SELECT * FROM twin_benchmarks WHERE userId=? ORDER BY createdAt DESC LIMIT 1`
    ).bind(ctx.userId).first<any>();
    if (!row) return null;
    return {
      ...row,
      benchmarkData: parseJson<any>(row.benchmarkData),
      percentiles: parseJson<any>(row.percentiles),
      weaknesses: parseJson<any[]>(row.weaknesses),
      topPatterns: parseJson<string[]>(row.topPatterns),
      improvements: parseJson<any[]>(row.improvements),
    };
  }),
  getBenchmarkHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, percentiles, createdAt FROM twin_benchmarks WHERE userId=? ORDER BY createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, percentiles: parseJson<any>(r.percentiles) }));
  }),

  // ============ Debate Mode ============
  createDebate: protectedProcedure
    .input(z.object({
      topic: z.string().min(1),
      stance: z.enum(["pro", "con"]),
      opponentUserId: z.number().optional(),
      turnCount: z.number().min(2).max(8).default(4),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      let opponentTwin: any = null;
      if (input.opponentUserId) {
        opponentTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? AND status='active' LIMIT 1`).bind(input.opponentUserId).first<any>();
      }

      const proLabel = input.stance === "pro" ? twin.name : (opponentTwin?.name || "反対側AI");
      const conLabel = input.stance === "con" ? twin.name : (opponentTwin?.name || "賛成側AI");

      const proPrompt = `あなたは「${input.topic}」に賛成の立場で討論します。名前: ${proLabel}。${input.stance === "pro" ? (twin.personality || "") : (opponentTwin?.personality || "論理的で鋭い議論をする")}。根拠を示し、説得力のある主張をしてください。`;
      const conPrompt = `あなたは「${input.topic}」に反対の立場で討論します。名前: ${conLabel}。${input.stance === "con" ? (twin.personality || "") : (opponentTwin?.personality || "論理的で鋭い議論をする")}。根拠を示し、説得力のある反論をしてください。`;

      const dialogues: { turn: number; speaker: string; stance: string; content: string }[] = [];
      const history: string[] = [];

      for (let i = 0; i < input.turnCount; i++) {
        // Pro speaks
        const proMessages = [
          { role: "system" as const, content: proPrompt },
          { role: "user" as const, content: i === 0 ? `ディベートを開始してください。テーマ: 「${input.topic}」。あなたは賛成側です。` : `これまでの議論:\n${history.join('\n')}\n\n反対側の主張に反論し、自分の立場を強化してください。` },
        ];
        const proResp = await invokeLLM(llmConfig, proMessages, { maxTokens: 400 });
        dialogues.push({ turn: i * 2 + 1, speaker: proLabel, stance: "pro", content: proResp.content });
        history.push(`[賛成・${proLabel}] ${proResp.content}`);

        // Con speaks
        const conMessages = [
          { role: "system" as const, content: conPrompt },
          { role: "user" as const, content: `これまでの議論:\n${history.join('\n')}\n\n賛成側の主張に反論し、反対の立場を主張してください。` },
        ];
        const conResp = await invokeLLM(llmConfig, conMessages, { maxTokens: 400 });
        dialogues.push({ turn: i * 2 + 2, speaker: conLabel, stance: "con", content: conResp.content });
        history.push(`[反対・${conLabel}] ${conResp.content}`);
      }

      // Judge
      const judgePrompt = `あなたは公平なディベートジャッジです。以下の討論を採点してください。

テーマ: 「${input.topic}」
${dialogues.map(d => `[${d.stance === "pro" ? "賛成" : "反対"}・${d.speaker}] ${d.content}`).join('\n\n')}

JSON形式で返してください:
{"winner":"pro|con|draw","proScore":{"logic":0-25,"persuasion":0-25,"rebuttal":0-25,"originality":0-25,"total":0-100},"conScore":{"logic":0-25,"persuasion":0-25,"rebuttal":0-25,"originality":0-25,"total":0-100},"keyPoints":[{"side":"pro|con","point":"要約"}],"summary":"総評"}`;

      const judgeResp = await invokeLLM(llmConfig, [{ role: "user", content: judgePrompt }]);
      let judgeResult: any = {};
      try { judgeResult = JSON.parse(judgeResp.content); } catch { judgeResult = { winner: "draw", proScore: { total: 50 }, conScore: { total: 50 }, keyPoints: [], summary: "判定不能" }; }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO debate_sessions (userId, topic, stance, opponentUserId, dialogues, judgeResult) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, input.topic, input.stance, input.opponentUserId || null, toJson(dialogues), toJson(judgeResult)).run();

      // Update rankings
      const myStance = input.stance;
      const won = judgeResult.winner === myStance;
      const lost = judgeResult.winner !== "draw" && judgeResult.winner !== myStance;
      const myScore = myStance === "pro" ? (judgeResult.proScore?.total || 0) : (judgeResult.conScore?.total || 0);

      await ctx.env.DB.prepare(
        `INSERT INTO debate_rankings (userId, wins, losses, draws, totalScore) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET wins=wins+?, losses=losses+?, draws=draws+?, totalScore=totalScore+?, updatedAt=datetime('now')`
      ).bind(ctx.userId, won ? 1 : 0, lost ? 1 : 0, (!won && !lost) ? 1 : 0, myScore, won ? 1 : 0, lost ? 1 : 0, (!won && !lost) ? 1 : 0, myScore).run();

      return { id: Number(res.meta.last_row_id), dialogues, judgeResult };
    }),
  listDebates: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, topic, stance, status, createdAt, judgeResult FROM debate_sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, judgeResult: parseJson<any>(r.judgeResult) }));
  }),
  getDebate: protectedProcedure
    .input(z.object({ debateId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM debate_sessions WHERE id=? AND userId=?`).bind(input.debateId, ctx.userId).first<any>();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...row, dialogues: parseJson<any[]>(row.dialogues), judgeResult: parseJson<any>(row.judgeResult) };
    }),
  getDebateRankings: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT dr.*, u.name as userName FROM debate_rankings dr LEFT JOIN users u ON u.id = dr.userId ORDER BY dr.totalScore DESC LIMIT 20`
    ).all<any>();
    const myRank = await ctx.env.DB.prepare(`SELECT * FROM debate_rankings WHERE userId=?`).bind(ctx.userId).first<any>();
    return {
      rankings: (rows.results ?? []).map((r: any) => ({ ...r, bestArguments: parseJson<string[]>(r.bestArguments) })),
      myRank: myRank ? { ...myRank, bestArguments: parseJson<string[]>(myRank.bestArguments) } : null,
    };
  }),

  // ============ Community Matching Events ============
  createCommunityEvent: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      theme: z.string().optional(),
      maxParticipants: z.number().min(2).max(50).default(10),
      scheduledAt: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO community_events (organizerId, title, description, theme, maxParticipants, scheduledAt) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, input.title, input.description || null, input.theme || null, input.maxParticipants, input.scheduledAt).run();
      const eventId = Number(res.meta.last_row_id);
      // Auto-join organizer
      await ctx.env.DB.prepare(
        `INSERT INTO community_event_participants (eventId, userId, status) VALUES (?, ?, 'approved')`
      ).bind(eventId, ctx.userId).run();
      return { id: eventId };
    }),
  listCommunityEvents: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ce.*, u.name as organizerName,
              (SELECT COUNT(*) FROM community_event_participants cep WHERE cep.eventId = ce.id AND cep.status='approved') as participantCount,
              (SELECT cep2.status FROM community_event_participants cep2 WHERE cep2.eventId = ce.id AND cep2.userId = ?) as myStatus
       FROM community_events ce
       LEFT JOIN users u ON u.id = ce.organizerId
       ORDER BY ce.scheduledAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, settings: parseJson<any>(r.settings) }));
  }),
  getCommunityEvent: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const event = await ctx.env.DB.prepare(
        `SELECT ce.*, u.name as organizerName FROM community_events ce LEFT JOIN users u ON u.id = ce.organizerId WHERE ce.id=?`
      ).bind(input.eventId).first<any>();
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      const participants = await ctx.env.DB.prepare(
        `SELECT cep.*, u.name as userName FROM community_event_participants cep LEFT JOIN users u ON u.id = cep.userId WHERE cep.eventId=? ORDER BY cep.rank ASC NULLS LAST, cep.matchingScore DESC NULLS LAST`
      ).bind(input.eventId).all<any>();
      return { ...event, settings: parseJson<any>(event.settings), reportData: parseJson<any>(event.reportData), participants: participants.results ?? [] };
    }),
  joinCommunityEvent: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const event = await ctx.env.DB.prepare(`SELECT * FROM community_events WHERE id=?`).bind(input.eventId).first<any>();
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      if (event.status !== "upcoming") throw new TRPCError({ code: "BAD_REQUEST", message: "このイベントは参加受付終了です" });
      const count = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM community_event_participants WHERE eventId=? AND status='approved'`).bind(input.eventId).first<any>();
      if ((count?.c || 0) >= event.maxParticipants) throw new TRPCError({ code: "BAD_REQUEST", message: "定員に達しています" });
      const needsApproval = event.organizerId !== ctx.userId;
      await ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO community_event_participants (eventId, userId, status) VALUES (?, ?, ?)`
      ).bind(input.eventId, ctx.userId, needsApproval ? "pending" : "approved").run();
      return { joined: true, status: needsApproval ? "pending" : "approved" };
    }),
  approveParticipant: protectedProcedure
    .input(z.object({ eventId: z.number(), userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const event = await ctx.env.DB.prepare(`SELECT organizerId FROM community_events WHERE id=?`).bind(input.eventId).first<any>();
      if (!event || event.organizerId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.env.DB.prepare(
        `UPDATE community_event_participants SET status='approved' WHERE eventId=? AND userId=?`
      ).bind(input.eventId, input.userId).run();
      return { approved: true };
    }),
  runCommunityEvent: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const event = await ctx.env.DB.prepare(`SELECT * FROM community_events WHERE id=?`).bind(input.eventId).first<any>();
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      if (event.organizerId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN" });

      const participants = await ctx.env.DB.prepare(
        `SELECT cep.userId, dt.name as twinName, dt.personality, dt.description
         FROM community_event_participants cep
         LEFT JOIN digital_twins dt ON dt.userId = cep.userId AND dt.status='active'
         WHERE cep.eventId=? AND cep.status='approved'`
      ).bind(input.eventId).all<any>();

      const pList = participants.results ?? [];
      if (pList.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "参加者が2人以上必要です" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      // Random pairing
      const shuffled = [...pList];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const randBuf = new Uint32Array(1);
        crypto.getRandomValues(randBuf);
        const j = randBuf[0] % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const pairs: { user1: any; user2: any; score: number }[] = [];
      for (let i = 0; i < shuffled.length - 1; i += 2) {
        const u1 = shuffled[i];
        const u2 = shuffled[i + 1];
        // Simple LLM scoring
        const scorePrompt = `2人のビジネスパーソンの相性を0-100で採点してください。
人物1: ${u1.twinName || 'ユーザー'} - ${u1.personality || '不明'}
人物2: ${u2.twinName || 'ユーザー'} - ${u2.personality || '不明'}
テーマ: ${event.theme || '一般ビジネス'}
数値のみ返してください。`;
        const scoreResp = await invokeLLM(llmConfig, [{ role: "user", content: scorePrompt }], { maxTokens: 10 });
        const score = parseInt(scoreResp.content.replace(/\D/g, '')) || 50;
        pairs.push({ user1: u1, user2: u2, score });

        // Update participant scores
        await ctx.env.DB.prepare(`UPDATE community_event_participants SET matchingScore=? WHERE eventId=? AND userId=?`).bind(score, input.eventId, u1.userId).run();
        await ctx.env.DB.prepare(`UPDATE community_event_participants SET matchingScore=? WHERE eventId=? AND userId=?`).bind(score, input.eventId, u2.userId).run();
      }

      // Rank by score
      const ranked = [...pList].sort((a: any, b: any) => {
        const pa = pairs.find(p => p.user1.userId === a.userId || p.user2.userId === a.userId);
        const pb = pairs.find(p => p.user1.userId === b.userId || p.user2.userId === b.userId);
        return (pb?.score || 0) - (pa?.score || 0);
      });
      for (let i = 0; i < ranked.length; i++) {
        await ctx.env.DB.prepare(`UPDATE community_event_participants SET rank=? WHERE eventId=? AND userId=?`).bind(i + 1, input.eventId, ranked[i].userId).run();
      }

      // Generate report
      const reportPrompt = `以下のマッチングイベントのレポートをJSON形式で作成してください。
テーマ: ${event.theme || event.title}
参加者数: ${pList.length}
ペアリング結果: ${JSON.stringify(pairs.map(p => ({ pair: `${p.user1.twinName} & ${p.user2.twinName}`, score: p.score })))}

JSON形式: {"summary":"要約","highlights":["ハイライト1"],"bestPair":{"names":"名前","score":数値},"avgScore":数値,"recommendations":["次回への提案"]}`;

      const reportResp = await invokeLLM(llmConfig, [{ role: "user", content: reportPrompt }]);
      let reportData: any = {};
      try { reportData = JSON.parse(reportResp.content); } catch { reportData = { summary: "レポート生成中", highlights: [], avgScore: 0, recommendations: [] }; }

      await ctx.env.DB.prepare(
        `UPDATE community_events SET status='completed', reportData=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(toJson(reportData), input.eventId).run();

      return { pairs: pairs.map(p => ({ user1: p.user1.twinName, user2: p.user2.twinName, score: p.score })), reportData };
    }),

  // ============ Team Battle ============
  createTeamBattle: protectedProcedure
    .input(z.object({
      theme: z.string().min(1),
      teamAUserIds: z.array(z.number()).min(1).max(3),
      teamBUserIds: z.array(z.number()).min(1).max(3),
      teamAStrategy: z.object({ approach: z.string().optional() }).optional(),
      teamBStrategy: z.object({ approach: z.string().optional() }).optional(),
      roles: z.record(z.string(), z.enum(["leader", "supporter", "specialist"])).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Verify creator is in one of the teams
      const allUserIds = [...input.teamAUserIds, ...input.teamBUserIds];
      if (!allUserIds.includes(ctx.userId)) throw new TRPCError({ code: "BAD_REQUEST", message: "作成者はチームに含まれている必要があります" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO team_battles (theme, creatorUserId, teamAMembers, teamBMembers, teamAStrategy, teamBStrategy, status) VALUES (?,?,?,?,?,?,'pending')`
      ).bind(
        input.theme, ctx.userId,
        toJson(input.teamAUserIds), toJson(input.teamBUserIds),
        toJson(input.teamAStrategy || {}), toJson(input.teamBStrategy || {})
      ).run();

      const battleId = res.meta?.last_row_id;
      if (battleId) {
        const stmts = allUserIds.map(uid => {
          const team = input.teamAUserIds.includes(uid) ? "A" : "B";
          const role = input.roles?.[String(uid)] || "supporter";
          return ctx.env.DB.prepare(
            `INSERT OR IGNORE INTO team_battle_members (battleId, userId, team, role) VALUES (?,?,?,?)`
          ).bind(battleId, uid, team, role);
        });
        await ctx.env.DB.batch(stmts);
      }

      return { id: battleId, theme: input.theme, status: "pending" };
    }),
  runTeamBattle: protectedProcedure
    .input(z.object({ battleId: z.number(), turns: z.number().min(2).max(10).default(6) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const battle = await ctx.env.DB.prepare(`SELECT * FROM team_battles WHERE id=?`).bind(input.battleId).first<any>();
      if (!battle) throw new TRPCError({ code: "NOT_FOUND" });
      if (battle.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "この対抗戦は既に完了しています" });

      const teamAIds = parseJson<number[]>(battle.teamAMembers) || [];
      const teamBIds = parseJson<number[]>(battle.teamBMembers) || [];

      // Get twin data for all members
      const getTwins = async (ids: number[]) => {
        const results = [];
        for (const uid of ids) {
          const twin = await ctx.env.DB.prepare(`SELECT name, personality, description FROM digital_twins WHERE userId=?`).bind(uid).first<any>();
          if (twin) results.push({ userId: uid, ...twin });
        }
        return results;
      };

      const teamATwins = await getTwins(teamAIds);
      const teamBTwins = await getTwins(teamBIds);
      const teamAStrategy = parseJson<any>(battle.teamAStrategy) || {};
      const teamBStrategy = parseJson<any>(battle.teamBStrategy) || {};

      // Get member roles
      const members = await ctx.env.DB.prepare(`SELECT * FROM team_battle_members WHERE battleId=?`).bind(input.battleId).all<any>();
      const roleMap: Record<number, string> = {};
      (members.results || []).forEach((m: any) => { roleMap[m.userId] = m.role; });

      const teamADesc = teamATwins.map(t => `${t.name}(${roleMap[t.userId] || "supporter"}: ${t.personality || ""})`).join(", ");
      const teamBDesc = teamBTwins.map(t => `${t.name}(${roleMap[t.userId] || "supporter"}: ${t.personality || ""})`).join(", ");

      await ctx.env.DB.prepare(`UPDATE team_battles SET status='in_progress' WHERE id=?`).bind(input.battleId).run();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "team_battle", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはチーム対抗ディスカッションのファシリテーターです。2チームがテーマについて議論します。各チームのメンバーの性格・役割を考慮し、リアルな対話を生成してください。チーム内では協力し、チーム間では競争的な対話を生成してください。" },
        { role: "user", content: `テーマ: ${battle.theme}\n\nチームA: ${teamADesc}\n戦略: ${teamAStrategy.approach || "自由"}\n\nチームB: ${teamBDesc}\n戦略: ${teamBStrategy.approach || "自由"}\n\n${input.turns}ターンの対話を生成してください。各ターンでチームAとチームBが交互に発言します。\n\nJSON:\n{"dialogue":[{"turn":1,"team":"A","speaker":"名前","content":"..."},...],"result":{"teamAScore":{"cooperation":80,"argumentation":75,"creativity":70,"overall":75},"teamBScore":{"cooperation":80,"argumentation":75,"creativity":70,"overall":75},"mvp":{"name":"...","team":"A","reason":"..."},"summary":"..."}}` }
      ], { maxTokens: 4000, temperature: 0.7 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = {
          dialogue: [{ turn: 1, team: "A", speaker: teamATwins[0]?.name || "チームA", content: "議論を開始します。" }],
          result: {
            teamAScore: { cooperation: 70, argumentation: 70, creativity: 70, overall: 70 },
            teamBScore: { cooperation: 70, argumentation: 70, creativity: 70, overall: 70 },
            mvp: { name: teamATwins[0]?.name || "不明", team: "A", reason: "積極的な参加" },
            summary: result.content
          }
        };
      }

      await ctx.env.DB.prepare(
        `UPDATE team_battles SET dialogue=?, result=?, status='completed' WHERE id=?`
      ).bind(toJson(parsed.dialogue || []), toJson(parsed.result || {}), input.battleId).run();

      return { dialogue: parsed.dialogue || [], result: parsed.result || {} };
    }),
  getTeamBattle: protectedProcedure
    .input(z.object({ battleId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const battle = await ctx.env.DB.prepare(`SELECT * FROM team_battles WHERE id=?`).bind(input.battleId).first<any>();
      if (!battle) return null;
      const members = await ctx.env.DB.prepare(`SELECT tbm.*, u.name as userName FROM team_battle_members tbm JOIN users u ON u.id=tbm.userId WHERE tbm.battleId=?`).bind(input.battleId).all<any>();
      return {
        ...battle,
        teamAMembers: parseJson<number[]>(battle.teamAMembers) || [],
        teamBMembers: parseJson<number[]>(battle.teamBMembers) || [],
        teamAStrategy: parseJson<any>(battle.teamAStrategy) || {},
        teamBStrategy: parseJson<any>(battle.teamBStrategy) || {},
        dialogue: parseJson<any[]>(battle.dialogue) || [],
        result: parseJson<any>(battle.result) || {},
        members: members.results ?? [],
      };
    }),
  listTeamBattles: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT tb.* FROM team_battles tb
       JOIN team_battle_members tbm ON tbm.battleId=tb.id
       WHERE tbm.userId=?
       GROUP BY tb.id
       ORDER BY tb.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      teamAMembers: parseJson<number[]>(r.teamAMembers) || [],
      teamBMembers: parseJson<number[]>(r.teamBMembers) || [],
      result: parseJson<any>(r.result) || {},
    }));
  }),

  // ============ Feature 21-3: マッチングネットワーク可視化 ============
  generateNetworkGraph: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    // Gather all friendships
    const friendships = await ctx.env.DB.prepare(
      `SELECT f.*, u1.name as user1Name, u2.name as user2Name
       FROM friendships f
       JOIN users u1 ON u1.id = f.userId
       JOIN users u2 ON u2.id = f.friendId
       WHERE (f.userId = ? OR f.friendId = ?) AND f.status = 'accepted'`
    ).bind(ctx.userId, ctx.userId).all<any>();

    // Gather all matching sessions with scores
    const matchings = await ctx.env.DB.prepare(
      `SELECT ms.initiatorUserId, ms.settings, mr.compatibilityScore, ms.theme,
              u1.name as initiatorName, u2.name as friendName
       FROM matching_sessions ms
       LEFT JOIN matching_results mr ON mr.sessionId = ms.id
       LEFT JOIN users u1 ON u1.id = ms.initiatorUserId
       LEFT JOIN users u2 ON u2.id = CAST(json_extract(ms.settings, '$.friendId') AS INTEGER)
       WHERE (ms.initiatorUserId = ? OR CAST(json_extract(ms.settings, '$.friendId') AS INTEGER) = ?)
       AND mr.id IS NOT NULL`
    ).bind(ctx.userId, ctx.userId).all<any>();

    // Build nodes and edges
    const nodeMap = new Map<number, any>();
    const edges: any[] = [];

    // Add self node
    const selfUser = await ctx.env.DB.prepare(`SELECT id, name FROM users WHERE id = ?`).bind(ctx.userId).first<any>();
    nodeMap.set(ctx.userId, { id: ctx.userId, name: selfUser?.name || "自分", type: "self", connections: 0, matchCount: 0 });

    for (const f of (friendships.results ?? [])) {
      const otherId = f.userId === ctx.userId ? f.friendId : f.userId;
      const otherName = f.userId === ctx.userId ? f.user2Name : f.user1Name;
      if (!nodeMap.has(otherId)) {
        nodeMap.set(otherId, { id: otherId, name: otherName, type: "friend", connections: 0, matchCount: 0 });
      }
      nodeMap.get(otherId)!.connections++;
      nodeMap.get(ctx.userId)!.connections++;
      edges.push({ source: ctx.userId, target: otherId, type: "friendship", weight: 1 });
    }

    for (const m of (matchings.results ?? [])) {
      const settings = parseJson<any>(m.settings) || {};
      const friendId = settings.friendId;
      if (!friendId) continue;
      if (!nodeMap.has(friendId)) {
        nodeMap.set(friendId, { id: friendId, name: m.friendName || `User${friendId}`, type: "match_only", connections: 0, matchCount: 0 });
      }
      nodeMap.get(friendId)!.matchCount++;
      edges.push({ source: m.initiatorUserId, target: friendId, type: "matching", weight: m.compatibilityScore || 50, theme: m.theme });
    }

    const nodes = Array.from(nodeMap.values());

    // Simple community detection (connected components with matching threshold)
    const communities: any[] = [];
    const highScoreEdges = edges.filter(e => e.type === "matching" && e.weight >= 70);
    const visited = new Set<number>();
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const community: number[] = [];
      const queue = [node.id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        community.push(current);
        for (const e of highScoreEdges) {
          if (e.source === current && !visited.has(e.target)) queue.push(e.target);
          if (e.target === current && !visited.has(e.source)) queue.push(e.source);
        }
      }
      if (community.length > 1) {
        communities.push({ members: community, size: community.length, label: `コミュニティ ${communities.length + 1}` });
      }
    }

    // Bridge users (connected to multiple communities)
    const bridgeUsers = nodes.filter(n => {
      const connectedCommunities = communities.filter(c => c.members.includes(n.id));
      return connectedCommunities.length > 1;
    }).map(n => ({ id: n.id, name: n.name, communitiesCount: communities.filter(c => c.members.includes(n.id)).length }));

    // Suggestions
    const suggestions: string[] = [];
    if (nodes.length < 5) suggestions.push("ネットワークを広げるため、Discoverページで新しいユーザーを探してみましょう");
    if (communities.length === 0) suggestions.push("高スコアのマッチングを増やすことで、コミュニティが形成されます");
    if (bridgeUsers.length > 0) suggestions.push(`${bridgeUsers[0].name}さんは複数のコミュニティを繋ぐブリッジユーザーです`);
    const lowMatchNodes = nodes.filter(n => n.matchCount === 0 && n.type === "friend");
    if (lowMatchNodes.length > 0) suggestions.push(`${lowMatchNodes[0].name}さんとはまだマッチングしていません。試してみましょう`);

    const graphData = { nodes, edges, communities, bridgeUsers, suggestions, stats: { totalNodes: nodes.length, totalEdges: edges.length, communityCount: communities.length, bridgeCount: bridgeUsers.length } };

    await ctx.env.DB.prepare(
      `INSERT OR REPLACE INTO matching_network_graphs (userId, graphData, communities, bridgeUsers, suggestions, generatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(ctx.userId, toJson(graphData), toJson(communities), toJson(bridgeUsers), toJson(suggestions)).run();

    return graphData;
  }),
  getNetworkGraph: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(`SELECT * FROM matching_network_graphs WHERE userId = ?`).bind(ctx.userId).first<any>();
    if (!row) return null;
    return {
      graphData: parseJson<any>(row.graphData),
      communities: parseJson<any>(row.communities),
      bridgeUsers: parseJson<any>(row.bridgeUsers),
      suggestions: parseJson<any>(row.suggestions),
      generatedAt: row.generatedAt,
    };
  }),



  // === Phase 39: Trust Progress ===
  getTrustProgress: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let row = await ctx.env.DB.prepare(`SELECT * FROM trust_progress WHERE userId=? AND friendId=?`).bind(ctx.userId, input.friendId).first<any>();
      if (!row) {
        const matchCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND settings LIKE ?`).bind(ctx.userId, `%"friendId":${input.friendId}%`).first<any>();
        const cnt = matchCount?.cnt || 0;
        const level = cnt >= 20 ? 5 : cnt >= 12 ? 4 : cnt >= 6 ? 3 : cnt >= 3 ? 2 : 1;
        await ctx.env.DB.prepare(
          `INSERT OR IGNORE INTO trust_progress (userId, friendId, trustLevel, matchCount) VALUES (?,?,?,?)`
        ).bind(ctx.userId, input.friendId, level, cnt).run();
        row = await ctx.env.DB.prepare(`SELECT * FROM trust_progress WHERE userId=? AND friendId=?`).bind(ctx.userId, input.friendId).first<any>();
      }
      return { ...row, unlockedThemes: parseJson<string[]>(row?.unlockedThemes) || [], achievements: parseJson<any[]>(row?.achievements) || [] };
    }),
  updateTrustProgress: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const matchCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND settings LIKE ?`).bind(ctx.userId, `%"friendId":${input.friendId}%`).first<any>();
      const cnt = matchCount?.cnt || 0;
      const oldRow = await ctx.env.DB.prepare(`SELECT * FROM trust_progress WHERE userId=? AND friendId=?`).bind(ctx.userId, input.friendId).first<any>();
      const oldLevel = oldRow?.trustLevel || 1;
      const newLevel = cnt >= 20 ? 5 : cnt >= 12 ? 4 : cnt >= 6 ? 3 : cnt >= 3 ? 2 : 1;

      const LEVEL_NAMES = ["", "表層", "本音", "秘密共有", "共同プロジェクト", "パートナー"];
      const LEVEL_THEMES: Record<number, string[]> = {
        1: ["自己紹介", "趣味・関心"],
        2: ["本音の意見交換", "失敗談の共有", "価値観の深掘り"],
        3: ["秘密のビジネスアイデア", "非公開プロジェクト相談"],
        4: ["共同事業計画", "投資判断"],
        5: ["長期パートナーシップ戦略", "M&A検討"],
      };

      const unlockedThemes: string[] = [];
      for (let i = 1; i <= newLevel; i++) unlockedThemes.push(...(LEVEL_THEMES[i] || []));

      const achievements = parseJson<any[]>(oldRow?.achievements) || [];
      let pointsAwarded = 0;
      if (newLevel > oldLevel) {
        achievements.push({ level: newLevel, name: LEVEL_NAMES[newLevel], achievedAt: new Date().toISOString() });
        pointsAwarded = newLevel * 20;
        // Award points
        await ctx.env.DB.prepare(`UPDATE user_points SET balance = balance + ? WHERE userId=?`).bind(pointsAwarded, ctx.userId).run();
        await ctx.env.DB.prepare(
          `INSERT INTO point_transactions (userId, amount, type, description) VALUES (?,?,?,?)`
        ).bind(ctx.userId, pointsAwarded, "earn", `信頼レベル${newLevel}「${LEVEL_NAMES[newLevel]}」達成`).run();
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO trust_progress (userId, friendId, trustLevel, matchCount, unlockedThemes, achievements, updatedAt) VALUES (?,?,?,?,?,?,datetime('now'))`
      ).bind(ctx.userId, input.friendId, newLevel, cnt, toJson(unlockedThemes), toJson(achievements)).run();

      return { trustLevel: newLevel, matchCount: cnt, unlockedThemes, achievements, levelUp: newLevel > oldLevel, pointsAwarded, levelName: LEVEL_NAMES[newLevel] };
    }),
  getAllTrustProgress: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT tp.*, u.name as friendName FROM trust_progress tp
      LEFT JOIN users u ON u.id = tp.friendId
      WHERE tp.userId=? ORDER BY tp.trustLevel DESC, tp.matchCount DESC
    `).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, unlockedThemes: parseJson<string[]>(r.unlockedThemes) || [], achievements: parseJson<any[]>(r.achievements) || [] }));
  }),
  getTrustThemes: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT unlockedThemes, trustLevel FROM trust_progress WHERE userId=? AND friendId=?`).bind(ctx.userId, input.friendId).first<any>();
      if (!row) return { themes: ["自己紹介", "趣味・関心"], trustLevel: 1 };
      return { themes: parseJson<string[]>(row.unlockedThemes) || [], trustLevel: row.trustLevel };
    }),
  getTrustLeaderboard: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT tp.friendId, tp.trustLevel, tp.matchCount, u.name as friendName
      FROM trust_progress tp LEFT JOIN users u ON u.id = tp.friendId
      WHERE tp.userId=? ORDER BY tp.trustLevel DESC, tp.matchCount DESC LIMIT 10
    `).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),


  // ============ Matching Streaks & Achievements ============
  getStreak: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    let streak = await ctx.env.DB.prepare(
      `SELECT * FROM matching_streaks WHERE userId=?`
    ).bind(ctx.userId).first<any>();
    if (!streak) {
      await ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO matching_streaks (userId, currentStreak, longestStreak, totalBonusEarned) VALUES (?, 0, 0, 0)`
      ).bind(ctx.userId).run();
      streak = { currentStreak: 0, longestStreak: 0, lastMatchDate: null, totalBonusEarned: 0 };
    }
    // Count total matchings
    const countResult = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as total FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`
    ).bind(ctx.userId).first<any>();
    const totalMatchings = countResult?.total ?? 0;
    // Define achievements
    const ACHIEVEMENTS = [
      { key: "first_matching", label: "初めてのマッチング", description: "初回マッチングを完了", threshold: 1, points: 10, icon: "🎯" },
      { key: "matching_10", label: "マッチング10回達成", description: "10回のマッチングを完了", threshold: 10, points: 30, icon: "⭐" },
      { key: "matching_50", label: "マッチング50回達成", description: "50回のマッチングを完了", threshold: 50, points: 80, icon: "🏆" },
      { key: "matching_100", label: "マッチングマスター", description: "100回のマッチングを完了", threshold: 100, points: 150, icon: "👑" },
      { key: "streak_3", label: "3日連続マッチング", description: "3日連続でマッチングを実行", threshold: 3, points: 10, icon: "🔥" },
      { key: "streak_7", label: "7日連続マッチング", description: "7日連続でマッチングを実行", threshold: 7, points: 30, icon: "💪" },
      { key: "streak_30", label: "30日連続マッチング", description: "30日間毎日マッチングを実行", threshold: 30, points: 100, icon: "🌟" },
    ];
    // Get unlocked achievements
    const unlockedRows = await ctx.env.DB.prepare(
      `SELECT achievementKey, claimed, claimedAt FROM matching_achievements WHERE userId=?`
    ).bind(ctx.userId).all<any>();
    const unlockedMap = new Map<string, { claimed: boolean; claimedAt: string | null }>();
    for (const row of (unlockedRows.results ?? [])) {
      unlockedMap.set(row.achievementKey, { claimed: !!row.claimed, claimedAt: row.claimedAt });
    }
    const achievements = ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: unlockedMap.has(a.key),
      claimed: unlockedMap.get(a.key)?.claimed ?? false,
      claimedAt: unlockedMap.get(a.key)?.claimedAt ?? null,
      progress: a.key.startsWith("streak_") ? Math.min(streak.currentStreak, a.threshold) : Math.min(totalMatchings, a.threshold),
    }));
    // Streak bonus thresholds
    const STREAK_BONUSES = [
      { days: 3, bonus: 10 },
      { days: 7, bonus: 30 },
      { days: 30, bonus: 100 },
    ];
    const nextBonus = STREAK_BONUSES.find(b => streak.currentStreak < b.days) || null;
    return {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastMatchDate: streak.lastMatchDate,
      totalBonusEarned: streak.totalBonusEarned,
      totalMatchings,
      achievements,
      nextBonus,
      streakBonuses: STREAK_BONUSES,
    };
  }),
  updateStreak: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    return updateMatchingStreakForUser(ctx.env.DB, ctx.userId);
  }),
  checkAchievements: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM matching_achievements WHERE userId=? ORDER BY unlockedAt DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  claimAchievement: protectedProcedure
    .input(z.object({ achievementKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const ACHIEVEMENT_POINTS: Record<string, number> = {
        first_matching: 10, matching_10: 30, matching_50: 80, matching_100: 150,
        streak_3: 10, streak_7: 30, streak_30: 100,
      };
      const achievement = await ctx.env.DB.prepare(
        `SELECT * FROM matching_achievements WHERE userId=? AND achievementKey=?`
      ).bind(ctx.userId, input.achievementKey).first<any>();
      if (!achievement) throw new TRPCError({ code: "NOT_FOUND", message: "アチーブメントが見つかりません" });
      if (achievement.claimed) throw new TRPCError({ code: "BAD_REQUEST", message: "既に報酬を受け取っています" });
      const points = ACHIEVEMENT_POINTS[input.achievementKey] || 0;
      await ctx.env.DB.prepare(
        `UPDATE matching_achievements SET claimed=1, claimedAt=datetime('now') WHERE userId=? AND achievementKey=?`
      ).bind(ctx.userId, input.achievementKey).run();
      if (points > 0) {
        try {
          await ctx.env.DB.prepare(
            `UPDATE user_points SET balance = balance + ?, totalEarned = totalEarned + ? WHERE userId=?`
          ).bind(points, points, ctx.userId).run();
          await ctx.env.DB.prepare(
            `INSERT INTO point_transactions (userId, type, amount, description, balanceAfter, createdAt) VALUES (?, 'earn', ?, ?, (SELECT balance FROM user_points WHERE userId=?), datetime('now'))`
          ).bind(ctx.userId, points, `アチーブメント報酬: ${input.achievementKey}`, ctx.userId).run();
        } catch {}
      }

      // Record achievement unlock activity
      await recordFriendActivity(ctx.env.DB, ctx.userId, "achievement_unlock", `アチーブメント達成: ${input.achievementKey}`, undefined, { achievementKey: input.achievementKey, points });

      return { claimed: true, pointsAwarded: points };
    }),

});
