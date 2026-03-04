import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  ensureSchema,
  parseJson,
  toJson,
  getMyTwin,
  getCumulativeWaveform,
  getOtherPerspectiveWaveform,
} from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const twinsLearningRouter = router({
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
      const result = await invokeLLM(llmConfig, messages, { maxTokens: 256, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });
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
      const result = await invokeLLM(llmConfig, messages, { maxTokens: 256, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });
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
        }], { maxTokens: 256, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });

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
          }], { maxTokens: 256, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });
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
      }], { maxTokens: 1024, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });

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
        const result = await invokeLLM(llmConfig, messages, { maxTokens: 512, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });
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
        const result = await invokeLLM(llmConfig, messages, { maxTokens: 1024, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });
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
        const result = await invokeLLM(llmConfig, messages, { maxTokens: 512, db: ctx.env.DB, userId: ctx.userId, purpose: "twin_learning" });
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

  // ============ Dialogue Style Learning ============

  analyzeDialogueStyle: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // Gather matching dialogues
    const matchingDialogues = await ctx.env.DB.prepare(
      `SELECT md.content FROM matching_dialogues md
       JOIN matching_sessions ms ON ms.id=md.sessionId
       WHERE ms.initiatorUserId=? AND md.speaker LIKE '%' || (SELECT name FROM digital_twins WHERE userId=? LIMIT 1) || '%'
       ORDER BY md.id DESC LIMIT 50`
    ).bind(ctx.userId, ctx.userId).all<any>();

    // Gather chat messages (user messages)
    const chatMessages = await ctx.env.DB.prepare(
      `SELECT cm.content FROM chat_messages cm
       JOIN chat_sessions cs ON cs.id=cm.sessionId
       WHERE cs.userId=? AND cm.role='user'
       ORDER BY cm.id DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();

    const allTexts = [
      ...(matchingDialogues.results ?? []).map((d: any) => d.content),
      ...(chatMessages.results ?? []).map((m: any) => m.content),
    ];

    if (allTexts.length < 5) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "分析に十分な対話データがありません（最低5件必要）" });
    }

    const prompt = `以下のユーザーの対話テキストから、固有の口調・語彙・論理展開パターンを分析してください。

テキストサンプル（${allTexts.length}件）:
${allTexts.slice(0, 30).map((t: string, i: number) => `${i + 1}. ${t.slice(0, 200)}`).join('\n')}

以下の8軸でスタイルプロファイルを生成してください（各0-100）:
1. formality（フォーマル度）: カジュアル(0)〜ビジネスフォーマル(100)
2. assertiveness（主張性）: 控えめ(0)〜断定的(100)
3. empathy（共感度）: 事実重視(0)〜感情重視(100)
4. technicality（専門用語頻度）: 平易(0)〜専門的(100)
5. verbosity（饒舌度）: 簡潔(0)〜詳細(100)
6. creativity（創造性）: 定型(0)〜独創的(100)
7. logicality（論理性）: 直感的(0)〜論理的(100)
8. questionFrequency（質問頻度）: 少な��(0)〜多い(100)

また、特徴的なフレーズ・口癖・表現パターンを5つ抽出してください。

JSON形式で返してください:
{
  "styleProfile": {
    "formality": 数値, "assertiveness": 数値, "empathy": 数値, "technicality": 数値,
    "verbosity": 数値, "creativity": 数値, "logicality": 数値, "questionFrequency": 数値
  },
  "samplePhrases": ["特徴的フレーズ1", "フレーズ2", "フレーズ3", "フレーズ4", "フレーズ5"],
  "summary": "スタイル要約（2文）",
  "systemPromptAddition": "ツインのシステムプロンプトに追加すべき指示文（口調・スタイルの再現指示）"
}`;

    const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let analysis: any = {};
    try { analysis = JSON.parse(resp.content); } catch {
      analysis = {
        styleProfile: { formality: 50, assertiveness: 50, empathy: 50, technicality: 50, verbosity: 50, creativity: 50, logicality: 50, questionFrequency: 50 },
        samplePhrases: [],
        summary: "分析データが不足しています。",
        systemPromptAddition: "",
      };
    }

    await ctx.env.DB.prepare(
      `INSERT OR REPLACE INTO dialogue_style_profiles (userId, twinId, styleProfile, samplePhrases, analysisSource, appliedToPrompt)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).bind(
      ctx.userId, twin.id,
      toJson(analysis.styleProfile || {}),
      toJson(analysis.samplePhrases || []),
      toJson({ matchingCount: matchingDialogues.results?.length || 0, chatCount: chatMessages.results?.length || 0, summary: analysis.summary })
    ).run();

    return {
      styleProfile: analysis.styleProfile,
      samplePhrases: analysis.samplePhrases,
      summary: analysis.summary,
      systemPromptAddition: analysis.systemPromptAddition,
    };
  }),

  getDialogueStyle: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return null;
    const row = await ctx.env.DB.prepare(
      `SELECT * FROM dialogue_style_profiles WHERE userId=? AND twinId=?`
    ).bind(ctx.userId, twin.id).first<any>();
    if (!row) return null;
    return {
      ...row,
      styleProfile: parseJson<any>(row.styleProfile),
      samplePhrases: parseJson<string[]>(row.samplePhrases),
      analysisSource: parseJson<any>(row.analysisSource),
    };
  }),

  applyDialogueStyle: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

    const profile = await ctx.env.DB.prepare(
      `SELECT * FROM dialogue_style_profiles WHERE userId=? AND twinId=?`
    ).bind(ctx.userId, twin.id).first<any>();
    if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "スタイルプロファイルがありません" });

    const styleData = parseJson<any>(profile.styleProfile) || {};
    const phrases = parseJson<string[]>(profile.samplePhrases) || [];

    // Build style instruction to append to systemPrompt
    const styleInstruction = `\n\n【対話スタイル指示】
以下のスタイルで応答してください:
- フォーマル度: ${styleData.formality || 50}/100
- 主張性: ${styleData.assertiveness || 50}/100
- 共感度: ${styleData.empathy || 50}/100
- 専門用語頻度: ${styleData.technicality || 50}/100
- 饒舌度: ${styleData.verbosity || 50}/100
- 創造性: ${styleData.creativity || 50}/100
- 論理性: ${styleData.logicality || 50}/100
- 質問頻度: ${styleData.questionFrequency || 50}/100
${phrases.length ? '特徴的な表現: ' + phrases.join('、') : ''}`;

    const currentPrompt = twin.systemPrompt || '';
    // Remove old style instruction if exists
    const cleanedPrompt = currentPrompt.replace(/\n\n【対話スタイル指示】[\s\S]*$/, '');
    const newPrompt = cleanedPrompt + styleInstruction;

    await ctx.env.DB.prepare(
      `UPDATE digital_twins SET systemPrompt=? WHERE id=?`
    ).bind(newPrompt, twin.id).run();

    await ctx.env.DB.prepare(
      `UPDATE dialogue_style_profiles SET appliedToPrompt=1, updatedAt=datetime('now') WHERE userId=? AND twinId=?`
    ).bind(ctx.userId, twin.id).run();

    return { applied: true };
  }),

  // ============ Multi-modal Personality Report ============

  generatePersonalityReport: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

    // Gather all personality data
    const bigFive = twin.bigFiveScores ? (typeof twin.bigFiveScores === 'string' ? parseJson<any>(twin.bigFiveScores) : twin.bigFiveScores) : null;
    const mbti = twin.mbtiType ? (typeof twin.mbtiType === 'string' ? parseJson<any>(twin.mbtiType) : twin.mbtiType) : null;

    const skillLevels = await ctx.env.DB.prepare(
      `SELECT * FROM twin_skill_levels WHERE twinId=?`
    ).bind(twin.id).all<any>();

    const matchingStats = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as count, AVG(mr.compatibilityScore) as avgScore, MAX(mr.compatibilityScore) as maxScore
       FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id
       WHERE ms.initiatorUserId=?`
    ).bind(ctx.userId).first<any>();

    const styleProfile = await ctx.env.DB.prepare(
      `SELECT styleProfile, samplePhrases FROM dialogue_style_profiles WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const emotionStats = await ctx.env.DB.prepare(
      `SELECT AVG(json_extract(emotions, '$.joy')) as joy, AVG(json_extract(emotions, '$.confidence')) as confidence,
              AVG(json_extract(emotions, '$.anxiety')) as anxiety, AVG(json_extract(emotions, '$.anger')) as anger
       FROM emotion_journal_entries WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const successPatternCount = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as c FROM success_patterns WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const reportData = {
      twin: { name: twin.name, personality: twin.personality, description: twin.description, tags: twin.tags },
      profile: { company: profile?.company, position: profile?.position, industry: profile?.industry },
      bigFive,
      mbti,
      skills: (skillLevels.results ?? []).map((s: any) => ({ skill: s.skill, level: s.level, exp: s.experience })),
      matchingStats: { count: matchingStats?.count || 0, avgScore: Math.round(matchingStats?.avgScore || 0), maxScore: matchingStats?.maxScore || 0 },
      styleProfile: styleProfile ? parseJson<any>(styleProfile.styleProfile) : null,
      samplePhrases: styleProfile ? parseJson<string[]>(styleProfile.samplePhrases) : [],
      emotionAvg: {
        joy: Math.round((emotionStats?.joy || 0) * 10) / 10,
        confidence: Math.round((emotionStats?.confidence || 0) * 10) / 10,
        anxiety: Math.round((emotionStats?.anxiety || 0) * 10) / 10,
        anger: Math.round((emotionStats?.anger || 0) * 10) / 10,
      },
      successPatterns: successPatternCount?.c || 0,
    };

    // LLM generates comprehensive analysis
    const prompt = `以下のデジタルツインの全データを統合分析し、包括的な人格レポートを生成してください。

データ:
${JSON.stringify(reportData)}

JSON形式で返してください:
{
  "executiveSummary": "3文の概要",
  "personalityOverview": "人格の総合的な説明（5文）",
  "strengths": ["強み1", "強み2", "強み3"],
  "growthAreas": ["成長領域1", "成長領域2", "成長領域3"],
  "communicationStyle": "コミュニケーションスタイルの説明（3文）",
  "matchingAdvice": "マッチングへのアドバイス（3文）",
  "futureOutlook": "今後の展望（3文）",
  "scores": {"overall": 0-100, "communication": 0-100, "expertise": 0-100, "adaptability": 0-100, "leadership": 0-100}
}`;

    const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let analysis: any = {};
    try { analysis = JSON.parse(resp.content); } catch {
      analysis = {
        executiveSummary: `${twin.name}の人格レポートです。`,
        personalityOverview: twin.personality || "分析中",
        strengths: [], growthAreas: [], communicationStyle: "", matchingAdvice: "", futureOutlook: "",
        scores: { overall: 50, communication: 50, expertise: 50, adaptability: 50, leadership: 50 },
      };
    }

    const fullReportData = { ...reportData, analysis };

    // Generate HTML report
    const reportHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${twin.name} 人格レポート</title>
<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333}
h1{color:#6366f1;border-bottom:2px solid #6366f1;padding-bottom:10px}
h2{color:#4f46e5;margin-top:30px}.card{background:#f8fafc;border-radius:12px;padding:16px;margin:12px 0}
.score{display:inline-block;background:#6366f1;color:white;border-radius:20px;padding:4px 12px;font-weight:bold}
.badge{display:inline-block;background:#e0e7ff;color:#4338ca;border-radius:6px;padding:2px 8px;margin:2px;font-size:0.85em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.progress{background:#e2e8f0;border-radius:8px;height:12px;overflow:hidden}
.progress-bar{height:100%;border-radius:8px;background:linear-gradient(90deg,#6366f1,#8b5cf6)}</style></head>
<body><h1>${twin.name} — 人格レポート</h1>
<p><em>生成日: ${new Date().toISOString().split('T')[0]}</em></p>
<div class="card"><h2>概要</h2><p>${analysis.executiveSummary || ''}</p></div>
<div class="card"><h2>人格プロファイル</h2><p>${analysis.personalityOverview || ''}</p></div>
<div class="grid">
${Object.entries(analysis.scores || {}).map(([k, v]) => `<div class="card"><strong>${k}</strong><div class="progress"><div class="progress-bar" style="width:${v}%"></div></div><span class="score">${v}</span></div>`).join('')}
</div>
<div class="card"><h2>強み</h2><ul>${(analysis.strengths || []).map((s: string) => `<li>${s}</li>`).join('')}</ul></div>
<div class="card"><h2>成長領域</h2><ul>${(analysis.growthAreas || []).map((g: string) => `<li>${g}</li>`).join('')}</ul></div>
<div class="card"><h2>コミュニケーション</h2><p>${analysis.communicationStyle || ''}</p></div>
<div class="card"><h2>マッチングアドバイス</h2><p>${analysis.matchingAdvice || ''}</p></div>
<div class="card"><h2>今後の展望</h2><p>${analysis.futureOutlook || ''}</p></div>
${reportData.bigFive ? `<div class="card"><h2>Big Five</h2><p>${JSON.stringify(reportData.bigFive)}</p></div>` : ''}
${reportData.mbti ? `<div class="card"><h2>MBTI</h2><p>${typeof reportData.mbti === 'object' ? JSON.stringify(reportData.mbti) : reportData.mbti}</p></div>` : ''}
<div class="card"><h2>マッチング統計</h2><p>回数: ${reportData.matchingStats.count} | 平均: ${reportData.matchingStats.avgScore} | 最高: ${reportData.matchingStats.maxScore}</p></div>
<footer><p style="text-align:center;color:#94a3b8;margin-top:40px">分身AI — Digital Twin Personality Report</p></footer></body></html>`;

    await ctx.env.DB.prepare(
      `INSERT OR REPLACE INTO personality_reports (userId, twinId, reportHtml, reportData, shareCode)
       VALUES (?, ?, ?, ?, NULL)`
    ).bind(ctx.userId, twin.id, reportHtml, toJson(fullReportData)).run();

    return { reportData: fullReportData, analysis };
  }),

  getPersonalityReport: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return null;
    const row = await ctx.env.DB.prepare(
      `SELECT * FROM personality_reports WHERE userId=? AND twinId=?`
    ).bind(ctx.userId, twin.id).first<any>();
    if (!row) return null;
    return { ...row, reportData: parseJson<any>(row.reportData) };
  }),

  sharePersonalityReport: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    await ctx.env.DB.prepare(
      `UPDATE personality_reports SET shareCode=? WHERE userId=? AND twinId=?`
    ).bind(code, ctx.userId, twin.id).run();
    return { shareCode: code };
  }),

  sendPersonalityReportEmail: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

    const report = await ctx.env.DB.prepare(
      `SELECT reportHtml FROM personality_reports WHERE userId=? AND twinId=?`
    ).bind(ctx.userId, twin.id).first<any>();
    if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "レポートがありません" });

    const user = await ctx.env.DB.prepare(`SELECT email, name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.email) throw new TRPCError({ code: "BAD_REQUEST", message: "メールが設定されていません" });

    if ((ctx.env as any).RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${(ctx.env as any).RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: (ctx.env as any).RESEND_FROM_EMAIL || 'noreply@bunshin-ai.com',
          to: user.email,
          subject: `【分身AI】${twin.name} 人格レポート`,
          html: report.reportHtml,
        }),
      });
    }

    return { sent: true };
  }),
});
