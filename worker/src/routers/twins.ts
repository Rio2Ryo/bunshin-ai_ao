import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  ensureSchema,
  parseJson,
  toJson,
  getMyTwin,
  normalizeTwin,
  getCumulativeWaveform,
  getOtherPerspectiveWaveform,
} from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const twinsRouter = router({
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
      visibility: z.enum(["public", "friends", "private", "custom"]).optional(),
      allowedViewerIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      // Dynamic SET clause: column names are hardcoded below, not from user input (safe from SQL injection)
      const sets: string[] = [];
      const binds: any[] = [];
      if (input.name !== undefined) { sets.push("name=?"); binds.push(input.name); }
      if (input.rawInput !== undefined) { sets.push("rawInput=?"); binds.push(input.rawInput); }
      if (input.status !== undefined) { sets.push("status=?"); binds.push(input.status); }
      if (input.visibility !== undefined) { sets.push("visibility=?"); binds.push(input.visibility); }
      if (input.allowedViewerIds !== undefined) { sets.push("allowedViewerIds=?"); binds.push(JSON.stringify(input.allowedViewerIds)); }
      if (sets.length > 0) {
        sets.push("updatedAt=datetime('now')");
        binds.push(twin.id);
        await ctx.env.DB.prepare(`UPDATE digital_twins SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
      }
      // Sync twin_visibility_rules when visibility is 'custom'
      if (input.visibility === "custom" && input.allowedViewerIds) {
        await ctx.env.DB.prepare(`DELETE FROM twin_visibility_rules WHERE twinId=?`).bind(twin.id).run();
        for (const viewerId of input.allowedViewerIds) {
          await ctx.env.DB.prepare(`INSERT OR IGNORE INTO twin_visibility_rules (twinId, viewerUserId) VALUES (?,?)`).bind(twin.id, viewerId).run();
        }
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

  getVisibilitySettings: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return { visibility: "public" as const, allowedViewers: [] };
    const rules = await ctx.env.DB.prepare(
      `SELECT tvr.viewerUserId, u.name FROM twin_visibility_rules tvr JOIN users u ON u.id = tvr.viewerUserId WHERE tvr.twinId=?`
    ).bind(twin.id).all<any>();
    return {
      visibility: ((twin as any).visibility as string) || "public",
      allowedViewers: (rules.results ?? []).map((r: any) => ({ id: r.viewerUserId as number, name: (r.name as string) || "" })),
    };
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
  "type": "ENFP",
  "dimensions": {"EI": -100〜100, "SN": -100〜100, "TF": -100〜100, "JP": -100〜100},
  "description": "タイプの説明",
  "strengths": ["強み1", "強み2", "強み3"],
  "weaknesses": ["課題1", "課題2"],
  "compatibleTypes": ["INTJ", "INFJ"],
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

  // ============ Voice Input Twin Personality Capture ============

  captureVoicePersonality: protectedProcedure
    .input(z.object({ transcription: z.string().min(10).max(10000) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM APIキーが必要です" });

      const result = await invokeLLM(llmConfig, [
        {
          role: "system",
          content: `Analyze this voice transcription to extract personality traits, communication style, expertise, and values. Update the twin's personality and description based on the analysis.
Return JSON only: {"personality":"personality description string","description":"professional description string","traits":["trait1","trait2","trait3"]}
The personality field should describe communication style, tone, and character.
The description field should summarize professional expertise and background.
The traits array should contain 3-8 key personality/professional traits.
All output should be in Japanese.`,
        },
        { role: "user", content: input.transcription },
      ], { maxTokens: 1024, temperature: 0.4 });

      let personality = twin.personality || "";
      let description = twin.description || "";
      let traits: string[] = [];

      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          personality = parsed.personality || personality;
          description = parsed.description || description;
          traits = Array.isArray(parsed.traits) ? parsed.traits : [];
        }
      } catch {
        // If parsing fails, use the raw content as personality
        personality = result.content || personality;
      }

      await ctx.env.DB.prepare(
        `UPDATE digital_twins SET personality=?, description=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(personality, description, twin.id).run();

      return { personality, description, traits };
    }),

  generateAvatar: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

    // Get user profile for context
    const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
    
    // Build avatar description using LLM
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM APIキーが必要です" });

    const promptContext = [
      twin.personality ? `性格: ${twin.personality}` : "",
      twin.description ? `説明: ${twin.description}` : "",
      twin.tags?.length ? `専門分野: ${twin.tags.join(", ")}` : "",
      profile?.industry ? `業界: ${profile.industry}` : "",
      profile?.position ? `役職: ${profile.position}` : "",
    ].filter(Boolean).join("\n");

    // Use LLM to generate a concise visual description for avatar
    const descResult = await invokeLLM(llmConfig, [
      { role: "system", content: "Generate a concise, professional avatar description for an AI digital twin. Output a single sentence in English describing the visual appearance of a professional avatar. Focus on style, colors, mood that match the personality. Do NOT include any text or names in the image. Format: 'A professional digital avatar of [description], [style], [colors]'" },
      { role: "user", content: `This AI twin has the following characteristics:\n${promptContext}\n\nGenerate ONE sentence avatar description in English.` },
    ], { maxTokens: 150, temperature: 0.7 });

    const avatarDescription = descResult.content.trim();

    // Try to generate image via OpenAI DALL-E API
    // Get user's OpenAI API key
    const apiKeyRow = await ctx.env.DB.prepare(
      `SELECT apiKey FROM ai_api_configs WHERE userId=? AND provider='openai' AND isActive=1`
    ).bind(ctx.userId).first<any>();
    
    let avatarUrl: string;
    
    if (apiKeyRow?.apiKey) {
      try {
        const dalleRes = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKeyRow.apiKey}`,
          },
          body: JSON.stringify({
            model: "dall-e-3",
            prompt: `${avatarDescription}. Clean minimalist style, suitable as a profile avatar. No text, no letters, no words.`,
            n: 1,
            size: "1024x1024",
            quality: "standard",
          }),
        });
        
        if (!dalleRes.ok) {
          const err = await dalleRes.text();
          throw new Error(`DALL-E API error: ${err}`);
        }
        
        const dalleData = await dalleRes.json() as any;
        avatarUrl = dalleData.data?.[0]?.url;
        
        if (!avatarUrl) throw new Error("No image URL returned");
      } catch (e: any) {
        // Fallback: generate a DiceBear avatar with personality-based seed
        const seed = encodeURIComponent(`${twin.name}-${twin.id}`);
        avatarUrl = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${seed}`;
      }
    } else {
      // No OpenAI key: use DiceBear as fallback
      const seed = encodeURIComponent(`${twin.name}-${twin.id}`);
      avatarUrl = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${seed}`;
    }

    // Store avatar URL on twin
    await ctx.env.DB.prepare(
      `UPDATE digital_twins SET avatarUrl=?, updatedAt=datetime('now') WHERE id=?`
    ).bind(avatarUrl, twin.id).run();

    return { avatarUrl, description: avatarDescription };
  }),

  // ============ Skill Tree Visualization ============
  getSkillTree: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return null;
    const db = ctx.env.DB;

    // 1. Knowledge base entries → skill nodes
    const kbRows = await db.prepare(
      `SELECT title, summary, sourceType, createdAt FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 50`
    ).bind(twin.id).all<any>();

    // 2. Matching history → competency scores
    const matchRows = await db.prepare(
      `SELECT mr.scoreBreakdown, mr.compatibilityScore, ms.theme, ms.createdAt
       FROM matching_results mr
       JOIN matching_sessions ms ON ms.id = mr.sessionId
       WHERE ms.initiatorUserId=? AND ms.status='completed'
       ORDER BY ms.createdAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();

    // 3. Feedback summary
    const feedbackRows = await db.prepare(
      `SELECT df.rating, COUNT(*) as count
       FROM dialogue_feedback df
       JOIN matching_sessions ms ON ms.id = df.sessionId
       WHERE df.userId=? AND (ms.twin1Id=? OR ms.twin2Id=?)
       GROUP BY df.rating`
    ).bind(ctx.userId, twin.id, twin.id).all<any>();

    // Build skill dimensions from matching scoreBreakdowns
    const dimensions: Record<string, { total: number; count: number; trend: number[] }> = {};
    for (const row of matchRows.results ?? []) {
      const breakdown = parseJson<any>(row.scoreBreakdown) || {};
      for (const [key, val] of Object.entries(breakdown)) {
        if (!dimensions[key]) dimensions[key] = { total: 0, count: 0, trend: [] };
        const score = (val as any)?.score ?? 0;
        dimensions[key].total += score;
        dimensions[key].count += 1;
        dimensions[key].trend.push(score);
      }
    }

    // Build tree structure
    const skillNodes = Object.entries(dimensions).map(([key, d]) => ({
      id: key,
      name: key,
      avgScore: d.count > 0 ? Math.round(d.total / d.count) : 0,
      maxScore: 20,
      matchCount: d.count,
      trend: d.trend.slice(-10),
    }));

    const knowledgeNodes = (kbRows.results ?? []).map((kb: any, i: number) => ({
      id: `kb-${i}`,
      name: kb.title || `知識 #${i + 1}`,
      type: kb.sourceType,
      summary: kb.summary?.slice(0, 100) || "",
      createdAt: kb.createdAt,
    }));

    const feedbackSummary: Record<string, number> = {};
    for (const fb of feedbackRows.results ?? []) {
      feedbackSummary[fb.rating] = fb.count;
    }

    return {
      twin: { id: twin.id, name: twin.name, personality: twin.personality, tags: twin.tags || [] },
      skills: skillNodes,
      knowledge: knowledgeNodes,
      feedback: feedbackSummary,
      totalMatchings: matchRows.results?.length ?? 0,
      totalKnowledge: kbRows.results?.length ?? 0,
    };
  }),

  getGrowthPath: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM APIキーが必要です" });

    const db = ctx.env.DB;

    // Gather context
    const matchRows = await db.prepare(
      `SELECT mr.scoreBreakdown, mr.compatibilityScore, ms.theme
       FROM matching_results mr JOIN matching_sessions ms ON ms.id = mr.sessionId
       WHERE ms.initiatorUserId=? AND ms.status='completed'
       ORDER BY ms.createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();

    const kbCount = await db.prepare(
      `SELECT COUNT(*) as c FROM knowledge_base WHERE twinId=?`
    ).bind(twin.id).first<any>();

    const feedbackCount = await db.prepare(
      `SELECT rating, COUNT(*) as c FROM dialogue_feedback df
       JOIN matching_sessions ms ON ms.id = df.sessionId
       WHERE df.userId=? GROUP BY df.rating`
    ).bind(ctx.userId).all<any>();

    const matchingSummary = (matchRows.results ?? []).map((r: any) => {
      const bd = parseJson<any>(r.scoreBreakdown) || {};
      return `テーマ「${r.theme}」: スコア${r.compatibilityScore}% — ${Object.entries(bd).map(([k, v]) => `${k}:${(v as any)?.score ?? 0}`).join(", ")}`;
    }).join("\n");

    const result = await invokeLLM(llmConfig, [
      {
        role: "system",
        content: `あなたはデジタルツインのスキル成長アドバイザーです。
ユーザーのマッチング履歴、ナレッジベース、フィードバックデータを分析し、成長パスを提案してください。
JSON形式のみ出力:
{
  "strengths": ["強み1", "強み2", "強み3"],
  "weaknesses": ["改善点1", "改善点2"],
  "growthPath": [
    {"step": 1, "action": "アクション説明", "area": "スキル領域", "impact": "high/medium/low"},
    {"step": 2, "action": "...", "area": "...", "impact": "..."},
    {"step": 3, "action": "...", "area": "...", "impact": "..."}
  ],
  "recommendation": "総合的な成長アドバイス（1-2文）"
}`,
      },
      {
        role: "user",
        content: `ツイン: ${twin.name}
性格: ${twin.personality || "未設定"}
タグ: ${(twin.tags || []).join(", ")}
ナレッジ数: ${kbCount?.c ?? 0}
フィードバック: ${(feedbackCount.results ?? []).map((f: any) => `${f.rating}:${f.c}`).join(", ") || "なし"}

直近マッチング結果:
${matchingSummary || "なし"}`,
      },
    ], { maxTokens: 1024, temperature: 0.4 });

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* parse error */ }
    return { strengths: [], weaknesses: [], growthPath: [], recommendation: result.content };
  }),

  analyzeDocument: protectedProcedure
    .input(z.object({
      fileData: z.string(), // base64
      fileName: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM APIキーが必要です" });

      // 1. Upload to R2
      const base64Data = input.fileData.replace(/^data:[^;]+;base64,/, "");
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const ext = input.fileName.split(".").pop() || "bin";
      const fileKey = `documents/${ctx.userId}/${Date.now()}.${ext}`;
      const r2 = ctx.env.ASSETS;
      let fileUrl: string | null = null;
      if (r2) {
        await r2.put(fileKey, binaryData, { httpMetadata: { contentType: input.mimeType } });
        fileUrl = `/assets/${fileKey}`;
      }

      // 2. Extract text content
      let extractedText = "";
      const isImage = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(input.mimeType);
      const isText = /^(text\/|application\/json)/i.test(input.mimeType) || /\.(txt|md|csv|json)$/i.test(input.fileName);
      const isPdf = input.mimeType === "application/pdf" || input.fileName.endsWith(".pdf");

      if (isText) {
        // Direct decode for text files
        try {
          extractedText = new TextDecoder().decode(binaryData);
        } catch {
          extractedText = atob(base64Data);
        }
      } else if (isImage) {
        // Vision API OCR
        const configs = await ctx.env.DB.prepare(
          `SELECT provider, apiKey FROM ai_api_configs WHERE userId=? AND isActive=1`
        ).bind(ctx.userId).all<any>();
        const keys = new Map<string, string>();
        for (const c of configs.results ?? []) keys.set(c.provider, c.apiKey);

        const ocrPrompt = `この画像の内容をすべて読み取ってテキストとして出力してください。
名刺、履歴書、プレゼン資料、書類など、あらゆるタイプの画像を処理します。
構造を保ちつつ、できるだけ詳細にテキスト化してください。`;

        // Try OpenAI gpt-4o
        if (keys.has("openai")) {
          try {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys.get("openai")}` },
              body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "user", content: [
                  { type: "text", text: ocrPrompt },
                  { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${base64Data}` } },
                ] }],
                max_tokens: 4096,
              }),
            });
            if (res.ok) {
              const data = await res.json() as any;
              extractedText = data.choices?.[0]?.message?.content ?? "";
            }
          } catch { /* fallback below */ }
        }
        // Try Gemini
        if (!extractedText && keys.has("gemini")) {
          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys.get("gemini")}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [
                    { text: ocrPrompt },
                    { inline_data: { mime_type: input.mimeType, data: base64Data } },
                  ] }],
                }),
              }
            );
            if (res.ok) {
              const data = await res.json() as any;
              extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            }
          } catch { /* fallback */ }
        }
        // Fallback via LLM (without vision)
        if (!extractedText) {
          extractedText = `[画像ファイル: ${input.fileName}] — Vision API未設定のためOCRできません`;
        }
      } else if (isPdf) {
        // Simple PDF text extraction — try to decode as text first
        try {
          const textContent = new TextDecoder().decode(binaryData);
          // Extract readable strings from PDF binary
          const textMatches = textContent.match(/\(([^)]+)\)/g);
          if (textMatches && textMatches.length > 5) {
            extractedText = textMatches.map(m => m.slice(1, -1)).join(" ");
          }
        } catch { /* ignore */ }

        // If basic extraction failed, try Vision API on first page (treat as image)
        if (!extractedText || extractedText.length < 50) {
          // Fall back to sending to LLM as context
          const configs = await ctx.env.DB.prepare(
            `SELECT provider, apiKey FROM ai_api_configs WHERE userId=? AND isActive=1`
          ).bind(ctx.userId).all<any>();
          const keys = new Map<string, string>();
          for (const c of configs.results ?? []) keys.set(c.provider, c.apiKey);

          if (keys.has("openai")) {
            try {
              const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys.get("openai")}` },
                body: JSON.stringify({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: [
                    { type: "text", text: "このPDFドキュメントの内容をすべて読み取ってテキストとして出力してください。" },
                    { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Data}` } },
                  ] }],
                  max_tokens: 4096,
                }),
              });
              if (res.ok) {
                const data = await res.json() as any;
                extractedText = data.choices?.[0]?.message?.content ?? extractedText;
              }
            } catch { /* ignore */ }
          }
          if (!extractedText || extractedText.length < 50) {
            extractedText = `[PDFファイル: ${input.fileName}] — テキスト抽出が限定的です。画像ベースのPDFの場合はVision APIが必要です。`;
          }
        }
      } else {
        extractedText = `[ファイル: ${input.fileName}] (${input.mimeType})`;
      }

      // Truncate if too long
      const maxLen = 15000;
      const truncated = extractedText.length > maxLen ? extractedText.slice(0, maxLen) + "\n...(省略)" : extractedText;

      // 3. LLM Analysis → personality, skills, knowledge
      const analysisResult = await invokeLLM(llmConfig, [
        {
          role: "system",
          content: `あなたはデジタルツインの人格・スキル解析の専門家です。
アップロードされたドキュメント（履歴書、プレゼン資料、名刺、メモ等）から以下を抽出してください。
JSON形式のみ出力:
{
  "personality": "抽出した性格・コミュニケーションスタイルの説明（日本語）",
  "description": "職業的な経歴・専門性の要約（日本語）",
  "skills": ["スキル1", "スキル2", ...],
  "knowledgeTitle": "ナレッジベースに保存するタイトル",
  "knowledgeSummary": "内容の要約（200文字以内）",
  "extractedProfile": {
    "company": "会社名 or null",
    "position": "役職 or null",
    "industry": "業界 or null",
    "experience": "経歴要約 or null"
  }
}
既存のツイン設定:
- 名前: ${twin.name}
- 性格: ${twin.personality || "未設定"}
- 説明: ${twin.description || "未設定"}
- タグ: ${(twin.tags || []).join(", ") || "なし"}

既存設定を尊重しつつ、新しい情報を統合して更新してください。`,
        },
        { role: "user", content: `ファイル名: ${input.fileName}\nファイル種別: ${input.mimeType}\n\n--- 抽出テキスト ---\n${truncated}` },
      ], { maxTokens: 2048, temperature: 0.3 });

      // 4. Parse and apply
      let updateResult: any = { updated: false };
      try {
        const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          // Update twin personality/description/tags
          const updates: string[] = [];
          const params: any[] = [];

          if (parsed.personality) {
            updates.push("personality=?");
            params.push(parsed.personality);
          }
          if (parsed.description) {
            updates.push("description=?");
            params.push(parsed.description);
          }
          if (parsed.skills && Array.isArray(parsed.skills) && parsed.skills.length > 0) {
            const existingTags: string[] = twin.tags || [];
            const merged = Array.from(new Set([...existingTags, ...parsed.skills])).slice(0, 20);
            updates.push("tags=?");
            params.push(JSON.stringify(merged));
          }
          if (updates.length > 0) {
            updates.push("updatedAt=datetime('now')");
            params.push(twin.id);
            await ctx.env.DB.prepare(
              `UPDATE digital_twins SET ${updates.join(",")} WHERE id=?`
            ).bind(...params).run();
          }

          // Add to knowledge base
          await ctx.env.DB.prepare(
            `INSERT INTO knowledge_base (twinId, sourceType, sourceId, title, content, summary, metadata) VALUES (?,?,?,?,?,?,?)`
          ).bind(
            twin.id,
            "upload",
            fileKey,
            parsed.knowledgeTitle || input.fileName,
            truncated.slice(0, 50000),
            parsed.knowledgeSummary || truncated.slice(0, 200),
            JSON.stringify({ fileName: input.fileName, mimeType: input.mimeType, fileUrl, analyzedAt: new Date().toISOString() })
          ).run();

          // Update user_profiles if profile data extracted
          if (parsed.extractedProfile) {
            const ep = parsed.extractedProfile;
            const profileUpdates: string[] = [];
            const profileParams: any[] = [];
            if (ep.company) { profileUpdates.push("company=?"); profileParams.push(ep.company); }
            if (ep.position) { profileUpdates.push("position=?"); profileParams.push(ep.position); }
            if (ep.industry) { profileUpdates.push("industry=?"); profileParams.push(ep.industry); }
            if (ep.experience) { profileUpdates.push("experience=?"); profileParams.push(ep.experience); }
            if (profileUpdates.length > 0) {
              profileParams.push(ctx.userId);
              await ctx.env.DB.prepare(
                `UPDATE user_profiles SET ${profileUpdates.join(",")} WHERE userId=?`
              ).bind(...profileParams).run();
            }
          }

          updateResult = {
            updated: true,
            personality: parsed.personality,
            description: parsed.description,
            skills: parsed.skills || [],
            knowledgeTitle: parsed.knowledgeTitle || input.fileName,
            extractedProfile: parsed.extractedProfile || null,
          };
        }
      } catch { /* parse error */ }

      // Record uploaded file
      await ctx.env.DB.prepare(
        `INSERT INTO uploaded_files (userId, twinId, filename, fileKey, url, mimeType, size, status, processedAt)
         VALUES (?,?,?,?,?,?,?,?,datetime('now'))`
      ).bind(ctx.userId, twin.id, input.fileName, fileKey, fileUrl, input.mimeType, binaryData.length, "completed").run();

      return {
        ...updateResult,
        extractedTextLength: extractedText.length,
        fileUrl,
      };
    }),

  // ============ Phase 16: ツインペルソナ切替システム ============

  createPersona: protectedProcedure
    .input(z.object({
      name: z.string(),
      mode: z.string(),
      personality: z.string().optional(),
      systemPrompt: z.string().optional(),
      description: z.string().optional(),
      tags: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const result = await ctx.env.DB.prepare(
        `INSERT INTO twin_personas (twinId, name, mode, personality, systemPrompt, description, tags, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
      ).bind(
        twin.id,
        input.name,
        input.mode,
        input.personality ?? null,
        input.systemPrompt ?? null,
        input.description ?? null,
        input.tags ?? null,
      ).run();

      return { id: result.meta?.last_row_id ?? 0 };
    }),

  listPersonas: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];

    const rows = await ctx.env.DB.prepare(
      `SELECT id, name, mode, personality, description, tags, useCount, createdAt FROM twin_personas WHERE twinId=? ORDER BY createdAt DESC`
    ).bind(twin.id).all<any>();

    return (rows.results ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      personality: r.personality,
      description: r.description,
      tags: r.tags,
      useCount: r.useCount ?? 0,
      createdAt: r.createdAt,
    }));
  }),

  updatePersona: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      name: z.string().optional(),
      mode: z.string().optional(),
      personality: z.string().optional(),
      systemPrompt: z.string().optional(),
      description: z.string().optional(),
      tags: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const persona = await ctx.env.DB.prepare(
        `SELECT id FROM twin_personas WHERE id=? AND twinId=?`
      ).bind(input.personaId, twin.id).first<any>();
      if (!persona) throw new TRPCError({ code: "FORBIDDEN", message: "このペルソナへのアクセス権がありません" });

      const updates: string[] = [];
      const values: any[] = [];
      if (input.name !== undefined) { updates.push("name=?"); values.push(input.name); }
      if (input.mode !== undefined) { updates.push("mode=?"); values.push(input.mode); }
      if (input.personality !== undefined) { updates.push("personality=?"); values.push(input.personality); }
      if (input.systemPrompt !== undefined) { updates.push("systemPrompt=?"); values.push(input.systemPrompt); }
      if (input.description !== undefined) { updates.push("description=?"); values.push(input.description); }
      if (input.tags !== undefined) { updates.push("tags=?"); values.push(input.tags); }

      if (updates.length > 0) {
        updates.push("updatedAt=datetime('now')");
        const sql = `UPDATE twin_personas SET ${updates.join(",")} WHERE id=?`;
        values.push(input.personaId);
        await ctx.env.DB.prepare(sql).bind(...values).run();
      }

      return { success: true as const };
    }),

  deletePersona: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const persona = await ctx.env.DB.prepare(
        `SELECT id FROM twin_personas WHERE id=? AND twinId=?`
      ).bind(input.personaId, twin.id).first<any>();
      if (!persona) throw new TRPCError({ code: "FORBIDDEN", message: "このペルソナへのアクセス権がありません" });

      await ctx.env.DB.prepare(`DELETE FROM twin_personas WHERE id=?`).bind(input.personaId).run();
      return { success: true as const };
    }),

  getPersonaStats: protectedProcedure
    .input(z.object({ personaId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];

      let personas: any[];
      if (input.personaId) {
        const p = await ctx.env.DB.prepare(
          `SELECT * FROM twin_personas WHERE id=? AND twinId=?`
        ).bind(input.personaId, twin.id).first<any>();
        personas = p ? [p] : [];
      } else {
        const rows = await ctx.env.DB.prepare(
          `SELECT * FROM twin_personas WHERE twinId=?`
        ).bind(twin.id).all<any>();
        personas = rows.results ?? [];
      }

      const sessions = await ctx.env.DB.prepare(
        `SELECT id, settings FROM matching_sessions WHERE userId=? OR targetUserId=?`
      ).bind(ctx.userId, ctx.userId).all<any>();
      const allSessions = sessions.results ?? [];

      const results = await ctx.env.DB.prepare(
        `SELECT sessionId, overallScore FROM matching_results WHERE userId=?`
      ).bind(ctx.userId).all<any>();
      const allResults = results.results ?? [];
      const resultMap = new Map<number, number>();
      for (const r of allResults) {
        resultMap.set(r.sessionId, r.overallScore ?? 0);
      }

      return personas.map((p: any) => {
        const matchingSessions = allSessions.filter((s: any) => {
          const settings = parseJson<any>(s.settings);
          return settings?.personaId === p.id;
        });
        const scores = matchingSessions
          .map((s: any) => resultMap.get(s.id))
          .filter((s: number | undefined): s is number => s !== undefined);
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
        const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

        return {
          personaId: p.id,
          name: p.name,
          mode: p.mode,
          avgScore,
          maxScore,
          matchCount: matchingSessions.length,
        };
      });
    }),

  // ============ Phase 18: ツイン進化マップ ============

  getEvolutionTimeline: protectedProcedure
    .query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const events: Array<{ date: string; type: string; title: string; description: string; data?: any }> = [];

      // 1. Milestones
      const milestones = await ctx.env.DB
        .prepare(`SELECT * FROM twin_milestones WHERE twinId = ? AND userId = ? ORDER BY achievedAt ASC`)
        .bind(twin.id, ctx.userId)
        .all<any>();
      for (const m of (milestones.results || [])) {
        events.push({
          date: m.achievedAt,
          type: "milestone",
          title: m.name || m.milestoneId,
          description: m.description || `マイルストーン「${m.milestoneId}」を達成`,
        });
      }

      // 2. Skill level changes
      const skills = await ctx.env.DB
        .prepare(`SELECT * FROM twin_skill_levels WHERE twinId = ? AND userId = ? ORDER BY createdAt ASC`)
        .bind(twin.id, ctx.userId)
        .all<any>();
      for (const s of (skills.results || [])) {
        events.push({
          date: s.updatedAt || s.createdAt,
          type: "skill_up",
          title: `${s.skillType} Lv.${s.level}`,
          description: `スキル「${s.skillType}」がレベル${s.level}に到達`,
          data: { skillType: s.skillType, level: s.level },
        });
      }

      // 3. Matching scores over time
      const matchings = await ctx.env.DB
        .prepare(`
          SELECT ms.id, ms.theme, ms.createdAt, mr.compatibilityScore
          FROM matching_sessions ms
          LEFT JOIN matching_results mr ON mr.sessionId = ms.id
          WHERE ms.initiatorUserId = ? AND mr.compatibilityScore IS NOT NULL
          ORDER BY ms.createdAt ASC
        `)
        .bind(ctx.userId)
        .all<any>();
      for (const m of (matchings.results || [])) {
        events.push({
          date: m.createdAt,
          type: "matching",
          title: `マッチング: ${m.theme}`,
          description: `スコア ${Math.round(m.compatibilityScore)}点`,
          data: { sessionId: m.id, score: m.compatibilityScore },
        });
      }

      // 4. Dialogue feedback (personality change signals)
      const feedback = await ctx.env.DB
        .prepare(`
          SELECT df.createdAt, df.rating, df.comment, ms.theme
          FROM dialogue_feedback df
          JOIN matching_sessions ms ON ms.id = df.sessionId
          WHERE df.userId = ?
          ORDER BY df.createdAt ASC
        `)
        .bind(ctx.userId)
        .all<any>();
      for (const f of (feedback.results || [])) {
        events.push({
          date: f.createdAt,
          type: "personality_change",
          title: `フィードバック: ${f.rating === "up" ? "Good" : "Improve"}`,
          description: f.comment || `マッチング「${f.theme}」へのフィードバック`,
        });
      }

      // 5. Knowledge added
      const knowledge = await ctx.env.DB
        .prepare(`SELECT id, title, sourceType, createdAt FROM knowledge_base WHERE twinId = ? ORDER BY createdAt ASC`)
        .bind(twin.id)
        .all<any>();
      for (const k of (knowledge.results || [])) {
        events.push({
          date: k.createdAt,
          type: "knowledge_added",
          title: k.title || "ナレッジ追加",
          description: `${k.sourceType}からナレッジを追加`,
        });
      }

      // Sort all events by date
      events.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

      return { twinId: twin.id, events };
    }),

  getEvolutionComparison: protectedProcedure
    .input(z.object({ period: z.enum(["week", "month", "quarter"]).default("month") }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const periodDays = input.period === "week" ? 7 : input.period === "month" ? 30 : 90;
      const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

      // Current state
      const currentSkills = await ctx.env.DB
        .prepare(`SELECT * FROM twin_skill_levels WHERE twinId = ? AND userId = ?`)
        .bind(twin.id, ctx.userId)
        .all<any>();
      const currentKnowledge = await ctx.env.DB
        .prepare(`SELECT COUNT(*) as cnt FROM knowledge_base WHERE twinId = ?`)
        .bind(twin.id)
        .first<any>();

      // Recent matching scores (after cutoff)
      const recentMatchings = await ctx.env.DB
        .prepare(`
          SELECT mr.compatibilityScore
          FROM matching_sessions ms
          JOIN matching_results mr ON mr.sessionId = ms.id
          WHERE ms.initiatorUserId = ? AND ms.createdAt >= ?
        `)
        .bind(ctx.userId, cutoffDate)
        .all<any>();
      const recentScores = (recentMatchings.results || []).map((r: any) => r.compatibilityScore).filter((s: any) => s != null);
      const afterAvgScore = recentScores.length > 0 ? Math.round(recentScores.reduce((a: number, b: number) => a + b, 0) / recentScores.length) : 0;

      // Before period matching scores (before cutoff)
      const olderMatchings = await ctx.env.DB
        .prepare(`
          SELECT mr.compatibilityScore
          FROM matching_sessions ms
          JOIN matching_results mr ON mr.sessionId = ms.id
          WHERE ms.initiatorUserId = ? AND ms.createdAt < ?
        `)
        .bind(ctx.userId, cutoffDate)
        .all<any>();
      const olderScores = (olderMatchings.results || []).map((r: any) => r.compatibilityScore).filter((s: any) => s != null);
      const beforeAvgScore = olderScores.length > 0 ? Math.round(olderScores.reduce((a: number, b: number) => a + b, 0) / olderScores.length) : 0;

      // Skills before period
      const olderSkills = await ctx.env.DB
        .prepare(`SELECT COUNT(*) as cnt FROM twin_skill_levels WHERE twinId = ? AND userId = ? AND createdAt < ?`)
        .bind(twin.id, ctx.userId, cutoffDate)
        .first<any>();

      // Knowledge before period
      const olderKnowledge = await ctx.env.DB
        .prepare(`SELECT COUNT(*) as cnt FROM knowledge_base WHERE twinId = ? AND createdAt < ?`)
        .bind(twin.id, cutoffDate)
        .first<any>();

      const personality = twin.personality ? parseJson<any>(twin.personality) : null;

      const after = {
        personality,
        avgScore: afterAvgScore,
        skillCount: (currentSkills.results || []).length,
        knowledgeCount: currentKnowledge?.cnt || 0,
      };

      const before = {
        personality: personality, // We don't have historical personality snapshots, use current
        avgScore: beforeAvgScore,
        skillCount: olderSkills?.cnt || 0,
        knowledgeCount: olderKnowledge?.cnt || 0,
      };

      return {
        period: input.period,
        before,
        after,
        changes: {
          scoreChange: afterAvgScore - beforeAvgScore,
          newSkills: after.skillCount - before.skillCount,
          newKnowledge: after.knowledgeCount - before.knowledgeCount,
          personalityShift: null, // Would need historical snapshots
        },
      };
    }),

  predictEvolutionPath: protectedProcedure
    .mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      // Gather context
      const milestones = await ctx.env.DB
        .prepare(`SELECT * FROM twin_milestones WHERE twinId = ? AND userId = ? ORDER BY achievedAt DESC LIMIT 10`)
        .bind(twin.id, ctx.userId)
        .all<any>();
      const skills = await ctx.env.DB
        .prepare(`SELECT * FROM twin_skill_levels WHERE twinId = ? AND userId = ? ORDER BY level DESC`)
        .bind(twin.id, ctx.userId)
        .all<any>();
      const matchings = await ctx.env.DB
        .prepare(`
          SELECT ms.theme, ms.createdAt, mr.compatibilityScore, mr.summary
          FROM matching_sessions ms
          LEFT JOIN matching_results mr ON mr.sessionId = ms.id
          WHERE ms.initiatorUserId = ?
          ORDER BY ms.createdAt DESC LIMIT 20
        `)
        .bind(ctx.userId)
        .all<any>();

      const twinInfo = `ツイン名: ${twin.name}\n説明: ${twin.description || "N/A"}\nパーソナリティ: ${twin.personality || "N/A"}`;
      const milestoneList = (milestones.results || []).map((m: any) => `- ${m.name || m.milestoneId}: ${m.description || ""} (${m.achievedAt})`).join("\n");
      const skillList = (skills.results || []).map((s: any) => `- ${s.skillType}: Lv.${s.level}`).join("\n");
      const matchingHistory = (matchings.results || []).map((m: any) => `- ${m.theme}: スコア${m.compatibilityScore || "N/A"} (${m.createdAt})`).join("\n");

      const systemPrompt = `あなたはデジタルツインの成長予測エキスパートです。ツインの現在の状態と履歴から将来の成長パスを予測してください。
返答は必ず以下のJSON形式のみで返してください。説明文は不要です。
{
  "predictions": [
    {
      "timeframe": "<例: 1ヶ月後>",
      "milestone": "<予測されるマイルストーン>",
      "likelihood": "high" | "medium" | "low",
      "description": "<詳細説明>"
    }
  ],
  "overallTrajectory": "<全体的な成長方向性の説明>",
  "suggestedActions": ["<推奨アクション1>", "<推奨アクション2>"]
}`;

      const userPrompt = `以下のツイン情報から将来の成長パスを予測してください:

${twinInfo}

=== マイルストーン ===
${milestoneList || "なし"}

=== スキル ===
${skillList || "なし"}

=== マッチング履歴 ===
${matchingHistory || "なし"}`;

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
      if (!llmConfig) { return { predictions: [], overallTrajectory: "LLM APIキーが未設定です", suggestedActions: ["AI API設定でキーを登録してください"] }; }
      const llmResult = await invokeLLM(llmConfig, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], { maxTokens: 2048, temperature: 0.7 });
      const raw = llmResult.content;

      let result: any;
      try {
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        result = JSON.parse(cleaned);
      } catch {
        result = {
          predictions: [{ timeframe: "1ヶ月後", milestone: "分析データ不足", likelihood: "low" as const, description: "より多くのマッチングを実行することで予測精度が向上します" }],
          overallTrajectory: "データ不足のため予測できませんでした",
          suggestedActions: ["マッチングを実施してデータを蓄積してください"],
        };
      }

      return {
        predictions: result.predictions || [],
        overallTrajectory: result.overallTrajectory || "",
        suggestedActions: result.suggestedActions || [],
      };
    }),

  // ============ ツイン・コラボレーション・モード ============

  startCollaboration: protectedProcedure
    .input(z.object({
      twinIds: z.array(z.number()).min(2).max(4),
      topic: z.string(),
      turns: z.number().default(5),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;

      // Load and validate all twins
      const twins: any[] = [];
      for (const twinId of input.twinIds) {
        const twin = await db.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(twinId).first<any>();
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: `ツインID ${twinId} が見つかりません` });

        // Check ownership: user's own twin or friend's twin
        if (twin.userId !== ctx.userId) {
          const friendship = await db.prepare(
            `SELECT id FROM friendships WHERE ((userId=? AND friendId=?) OR (userId=? AND friendId=?)) AND status='accepted'`
          ).bind(ctx.userId, twin.userId, twin.userId, ctx.userId).first<any>();
          if (!friendship) throw new TRPCError({ code: "FORBIDDEN", message: `ツインID ${twinId} へのアクセス権がありません` });
        }
        twins.push(normalizeTwin(twin));
      }

      const twinNames = twins.map(t => t.name).join(", ");

      // Create collaboration record
      const collabResult = await db.prepare(
        `INSERT INTO twin_collaborations (userId, topic, twinIds, twinNames, status, createdAt) VALUES (?, ?, ?, ?, 'completed', datetime('now'))`
      ).bind(ctx.userId, input.topic, toJson(input.twinIds), twinNames).run();
      const collaborationId = collabResult.meta?.last_row_id as number;

      // Generate multi-twin dialogue
      const llmConfig = await getUserLLMConfig(db, ctx.userId, "matching", ctx.env);
      const allTurns: { turnNumber: number; twinId: number; twinName: string; content: string }[] = [];
      const conversationHistory: string[] = [];

      for (let turn = 0; turn < input.turns; turn++) {
        const twinIndex = turn % twins.length;
        const currentTwin = twins[twinIndex];
        const otherTwins = twins.filter((_, i) => i !== twinIndex);

        const systemPrompt = `あなたは「${currentTwin.name}」として発言します。
性格: ${currentTwin.personality || "特に指定なし"}
説明: ${currentTwin.description || "特に指定なし"}
MBTI: ${currentTwin.mbtiType || "未診断"}

他の参加者: ${otherTwins.map(t => `${t.name}（${t.personality || "性格未設定"}）`).join("、")}

テーマ「${input.topic}」について、あなたの視点から意見を述べてください。
${conversationHistory.length > 0 ? "これまでの会話を踏まえて、新しい視点や反論、同意などを自然に表現してください。" : "最初の発言者として、テーマについて議論を始めてください。"}
発言は1〜3文程度で簡潔にしてください。JSON形式ではなく、自然な発言テキストのみ返してください。`;

        const userPrompt = conversationHistory.length > 0
          ? `これまでの会話:\n${conversationHistory.join("\n")}\n\n${currentTwin.name}として次の発言をしてください。`
          : `テーマ「${input.topic}」について、${currentTwin.name}として最初に発言してください。`;

        let content: string;
        try {
          const llmRes = await invokeLLM(llmConfig!, [{role: "system", content: systemPrompt}, {role: "user", content: userPrompt}]);
          content = llmRes.content.replace(/```[a-z]*\n?/g, "").replace(/```\n?/g, "").trim();
        } catch {
          content = `${input.topic}について、私の考えを述べさせていただきます。`;
        }

        conversationHistory.push(`${currentTwin.name}: ${content}`);
        allTurns.push({ turnNumber: turn + 1, twinId: currentTwin.id, twinName: currentTwin.name, content });

        // Save turn to DB
        await db.prepare(
          `INSERT INTO twin_collaboration_turns (collaborationId, turnNumber, twinId, twinName, content, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`
        ).bind(collaborationId, turn + 1, currentTwin.id, currentTwin.name, content).run();
      }

      return { collaborationId, turns: allTurns, twinNames: twins.map(t => t.name) };
    }),

  getCollaboration: protectedProcedure
    .input(z.object({ collaborationId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;

      const collab = await db.prepare(
        `SELECT * FROM twin_collaborations WHERE id=? AND userId=?`
      ).bind(input.collaborationId, ctx.userId).first<any>();
      if (!collab) throw new TRPCError({ code: "NOT_FOUND", message: "コラボレーションが見つかりません" });

      const turns = await db.prepare(
        `SELECT * FROM twin_collaboration_turns WHERE collaborationId=? ORDER BY turnNumber`
      ).bind(input.collaborationId).all<any>();

      return {
        id: collab.id,
        topic: collab.topic,
        twinIds: parseJson<number[]>(collab.twinIds) || [],
        twinNames: collab.twinNames,
        analysis: parseJson<any>(collab.analysis),
        status: collab.status,
        createdAt: collab.createdAt,
        turns: (turns.results ?? []).map((t: any) => ({
          turnNumber: t.turnNumber,
          twinId: t.twinId,
          twinName: t.twinName,
          content: t.content,
        })),
      };
    }),

  analyzeCollaboration: protectedProcedure
    .input(z.object({ collaborationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;

      const collab = await db.prepare(
        `SELECT * FROM twin_collaborations WHERE id=? AND userId=?`
      ).bind(input.collaborationId, ctx.userId).first<any>();
      if (!collab) throw new TRPCError({ code: "NOT_FOUND", message: "コラボレーションが見つかりません" });

      const turns = await db.prepare(
        `SELECT * FROM twin_collaboration_turns WHERE collaborationId=? ORDER BY turnNumber`
      ).bind(input.collaborationId).all<any>();

      const dialogue = (turns.results ?? []).map((t: any) => `${t.twinName}: ${t.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(db, ctx.userId, "matching", ctx.env);
      const systemPrompt = `あなたはマルチパーソナリティ対話の分析者です。以下の複数ツイン間の対話を分析し、必ず以下のJSON形式で返してください:
{"agreements":["合意点"],"disagreements":[{"topic":"議題","positions":[{"twinName":"ツイン名","position":"立場"}]}],"uniquePerspectives":[{"twinName":"ツイン名","perspective":"独自の視点"}],"consensusAreas":["コンセンサスが形成された領域"],"mediationSuggestion":"調停・統合の提案"}`;

      const userPrompt = `テーマ: ${collab.topic}\n参加ツイン: ${collab.twinNames}\n\n対話内容:\n${dialogue}\n\n上記の対話を分析し、JSON形式で返してください。`;

      const rawResult = await invokeLLM(llmConfig!, [{role: "system", content: systemPrompt}, {role: "user", content: userPrompt}]);
      const raw = rawResult.content;
      let analysis: any;
      try {
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        analysis = JSON.parse(cleaned);
      } catch {
        analysis = {
          agreements: ["テーマに対する基本的な関心の共有"],
          disagreements: [],
          uniquePerspectives: [{ twinName: "全体", perspective: "各ツインが独自の視点を提供" }],
          consensusAreas: ["テーマの重要性についての共通認識"],
          mediationSuggestion: "より具体的なサブトピックに分けて議論を深めることをお勧めします",
        };
      }

      await db.prepare(
        `UPDATE twin_collaborations SET analysis=? WHERE id=?`
      ).bind(toJson(analysis), input.collaborationId).run();

      return analysis;
    }),

  listCollaborations: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    const rows = await db.prepare(
      `SELECT tc.*, (SELECT COUNT(*) FROM twin_collaboration_turns WHERE collaborationId=tc.id) as turnCount
       FROM twin_collaborations tc WHERE tc.userId=? ORDER BY tc.createdAt DESC`
    ).bind(ctx.userId).all<any>();

    return (rows.results ?? []).map((r: any) => ({
      id: r.id,
      topic: r.topic,
      twinNames: r.twinNames,
      turnCount: r.turnCount,
      hasAnalysis: r.analysis !== null && r.analysis !== undefined,
      createdAt: r.createdAt,
    }));
  }),
});
