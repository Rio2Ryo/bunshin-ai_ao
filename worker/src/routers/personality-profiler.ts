import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const personalityProfilerRouter = router({
  getSession: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const profile = await ctx.env.DB.prepare(
      `SELECT * FROM personality_profiles WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    if (!profile) {
      // Create new session
      await ctx.env.DB.prepare(
        `INSERT INTO personality_profiles (userId, status, interviewLog) VALUES (?, 'in_progress', '[]')`
      ).bind(ctx.userId).run();
      return {
        id: 0,
        status: "in_progress" as const,
        questionCount: 0,
        interviewLog: [],
        bigFive: null,
        mbti: null,
        mbtiScores: null,
        valueProfile: null,
      };
    }

    return {
      id: profile.id,
      status: profile.status,
      questionCount: profile.questionCount,
      interviewLog: parseJson<any[]>(profile.interviewLog) || [],
      bigFive: parseJson<any>(profile.bigFive),
      mbti: profile.mbti,
      mbtiScores: parseJson<any>(profile.mbtiScores),
      valueProfile: parseJson<any>(profile.valueProfile),
    };
  }),

  answer: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      content: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const profile = await ctx.env.DB.prepare(
        `SELECT * FROM personality_profiles WHERE userId=?`
      ).bind(ctx.userId).first<any>();

      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "診断セッションが見つかりません" });
      }

      if (profile.status === "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "診断は既に完了しています" });
      }

      const interviewLog = parseJson<any[]>(profile.interviewLog) || [];
      const questionCount = profile.questionCount + 1;

      // Add user answer to log
      interviewLog.push({ role: "user", content: input.content });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "personality", ctx.env);

      if (!llmConfig) {
        // Scripted fallback
        const fallbackQuestions = [
          "ありがとうございます。次に、チームで仕事をするとき、リーダーシップを取る方ですか？それとも協力者として支える方が得意ですか？",
          "なるほど。では、重要な決断を下すとき、データや論理を重視しますか？それとも直感や人の気持ちを大切にしますか？",
          "興味深いですね。ストレスを感じたとき、どのように対処しますか？一人で考えますか、それとも人に相談しますか？",
          "ありがとうございます。計画を立てて物事を進めるのが好きですか？それとも柔軟に対応するのが好きですか？",
          "もう少し聞かせてください。新しいアイデアや創造的なプロジェクトにワクワクしますか？それとも確実で実証済みの方法を好みますか？",
        ];

        const aiResponse = questionCount <= fallbackQuestions.length
          ? fallbackQuestions[questionCount - 1]
          : "ありがとうございます。十分な情報が集まりました。分析を行います。";

        interviewLog.push({ role: "assistant", content: aiResponse });

        const isComplete = questionCount >= 15;

        if (isComplete) {
          // Generate default results
          const defaultResults = {
            bigFive: { openness: 65, conscientiousness: 70, extraversion: 55, agreeableness: 72, neuroticism: 40 },
            mbti: "ENFJ",
            mbtiScores: { ei: 60, sn: 55, tf: 45, jp: 40 },
            valueProfile: { innovation: 70, stability: 60, collaboration: 75, achievement: 65, autonomy: 55 },
          };

          await ctx.env.DB.prepare(
            `UPDATE personality_profiles SET interviewLog=?, questionCount=?, status='completed', bigFive=?, mbti=?, mbtiScores=?, valueProfile=?, analyzedAt=datetime('now'), updatedAt=datetime('now') WHERE userId=?`
          ).bind(
            toJson(interviewLog), questionCount,
            toJson(defaultResults.bigFive), defaultResults.mbti,
            toJson(defaultResults.mbtiScores), toJson(defaultResults.valueProfile),
            ctx.userId
          ).run();

          return { aiResponse, isComplete: true, progress: 100 };
        }

        await ctx.env.DB.prepare(
          `UPDATE personality_profiles SET interviewLog=?, questionCount=?, updatedAt=datetime('now') WHERE userId=?`
        ).bind(toJson(interviewLog), questionCount, ctx.userId).run();

        return { aiResponse, isComplete: false, progress: Math.round((questionCount / 15) * 100) };
      }

      // LLM-powered interview
      const isNearEnd = questionCount >= 12;
      const isComplete = questionCount >= 15;

      const systemPrompt = `あなたはパーソナリティ診断の専門家AIです。ユーザーとの自然な対話を通じて、以下の3つの側面を分析しています：

1. Big Five（開放性、誠実性、外向性、協調性、神経質性）
2. MBTI（E/I, S/N, T/F, J/P の4軸）
3. 価値観（革新性、安定性、協調性、達成、自律性）

これまでの回答: ${questionCount - 1}問完了。

${isNearEnd ? "残り数問です。まだ聞いていない側面に焦点を当ててください。" : "自然な会話の流れで次の質問をしてください。"}
${isComplete ? `

十分な情報が集まりました。以下の形式で最終分析結果をJSON形式で返してください：

---PERSONALITY_ANALYSIS---
{
  "bigFive": {"openness": 0-100, "conscientiousness": 0-100, "extraversion": 0-100, "agreeableness": 0-100, "neuroticism": 0-100},
  "mbti": "XXXX",
  "mbtiScores": {"ei": 0-100, "sn": 0-100, "tf": 0-100, "jp": 0-100},
  "valueProfile": {"innovation": 0-100, "stability": 0-100, "collaboration": 0-100, "achievement": 0-100, "autonomy": 0-100}
}

分析結果の前に、ユーザーへの総評コメント（日本語）を含めてください。` : ""}

丁寧かつ親しみやすい日本語で質問してください。一度に1つの質問に絞ってください。`;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      // Add conversation history
      for (const entry of interviewLog) {
        messages.push({
          role: entry.role as "user" | "assistant",
          content: entry.content,
        });
      }

      let aiResponse = "";
      try {
        const result = await invokeLLM(llmConfig, messages, {
          maxTokens: isComplete ? 2048 : 512,
          temperature: 0.7,
        });
        aiResponse = result.content;
      } catch {
        aiResponse = "申し訳ございません。応答生成中にエラーが発生しました。もう一度お試しください。";
      }

      // Check for analysis result
      let analysisComplete = false;
      const analysisMatch = aiResponse.match(/---PERSONALITY_ANALYSIS---\s*(\{[\s\S]*\})/);

      if (analysisMatch || isComplete) {
        analysisComplete = true;

        let analysisData: any = null;
        if (analysisMatch) {
          try {
            analysisData = JSON.parse(analysisMatch[1]);
          } catch {}
        }

        if (!analysisData) {
          // Try to parse any JSON in the response
          const jsonMatch = aiResponse.match(/\{[\s\S]*"bigFive"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              analysisData = JSON.parse(jsonMatch[0]);
            } catch {}
          }
        }

        // Clean the AI response (remove JSON part for display)
        const cleanResponse = aiResponse
          .replace(/---PERSONALITY_ANALYSIS---[\s\S]*$/, "")
          .replace(/\{[\s\S]*"bigFive"[\s\S]*\}/, "")
          .trim();

        if (cleanResponse) {
          aiResponse = cleanResponse;
        } else {
          aiResponse = "パーソナリティ分析が完了しました！結果タブで確認してください。";
        }

        interviewLog.push({ role: "assistant", content: aiResponse });

        const finalData = analysisData || {
          bigFive: { openness: 65, conscientiousness: 70, extraversion: 55, agreeableness: 72, neuroticism: 40 },
          mbti: "ENFJ",
          mbtiScores: { ei: 60, sn: 55, tf: 45, jp: 40 },
          valueProfile: { innovation: 70, stability: 60, collaboration: 75, achievement: 65, autonomy: 55 },
        };

        await ctx.env.DB.prepare(
          `UPDATE personality_profiles SET interviewLog=?, questionCount=?, status='completed', bigFive=?, mbti=?, mbtiScores=?, valueProfile=?, analyzedAt=datetime('now'), updatedAt=datetime('now') WHERE userId=?`
        ).bind(
          toJson(interviewLog), questionCount,
          toJson(finalData.bigFive), finalData.mbti || "ENFJ",
          toJson(finalData.mbtiScores), toJson(finalData.valueProfile),
          ctx.userId
        ).run();

        return { aiResponse, isComplete: true, progress: 100 };
      }

      interviewLog.push({ role: "assistant", content: aiResponse });

      await ctx.env.DB.prepare(
        `UPDATE personality_profiles SET interviewLog=?, questionCount=?, updatedAt=datetime('now') WHERE userId=?`
      ).bind(toJson(interviewLog), questionCount, ctx.userId).run();

      return {
        aiResponse,
        isComplete: false,
        progress: Math.round((questionCount / 15) * 100),
      };
    }),

  getResults: protectedProcedure
    .input(z.object({ userId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const targetUserId = input?.userId || ctx.userId;

      const profile = await ctx.env.DB.prepare(
        `SELECT * FROM personality_profiles WHERE userId=?`
      ).bind(targetUserId).first<any>();

      if (!profile || profile.status !== "completed") return null;

      return {
        bigFive: parseJson<any>(profile.bigFive),
        mbti: profile.mbti,
        mbtiScores: parseJson<any>(profile.mbtiScores),
        valueProfile: parseJson<any>(profile.valueProfile),
        analyzedAt: profile.analyzedAt,
      };
    }),

  getCompatibility: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const myProfile = await ctx.env.DB.prepare(
        `SELECT * FROM personality_profiles WHERE userId=? AND status='completed'`
      ).bind(ctx.userId).first<any>();

      if (!myProfile) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "まず自分の診断を完了してください" });
      }

      const friendProfile = await ctx.env.DB.prepare(
        `SELECT * FROM personality_profiles WHERE userId=? AND status='completed'`
      ).bind(input.friendId).first<any>();

      if (!friendProfile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "友達がまだ診断を完了していません" });
      }

      const friendUser = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(input.friendId).first<any>();

      const myBigFive = parseJson<any>(myProfile.bigFive) || {};
      const friendBigFive = parseJson<any>(friendProfile.bigFive) || {};

      // Calculate compatibility score based on Big Five similarity
      const dimensions = ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"];
      let totalDiff = 0;
      let count = 0;
      for (const dim of dimensions) {
        const myVal = myBigFive[dim] ?? 50;
        const friendVal = friendBigFive[dim] ?? 50;
        totalDiff += Math.abs(myVal - friendVal);
        count++;
      }
      const avgDiff = count > 0 ? totalDiff / count : 50;
      const compatibilityScore = Math.round(Math.max(0, 100 - avgDiff));

      let summary = "";
      if (compatibilityScore >= 80) {
        summary = "非常に高い互換性があります。性格傾向が近く、自然な協力関係を築けるでしょう。";
      } else if (compatibilityScore >= 60) {
        summary = "良好な互換性です。いくつかの違いはありますが、補完的な関係を築けます。";
      } else if (compatibilityScore >= 40) {
        summary = "中程度の互換性です。異なる視点を持ち寄ることで、新しい発見があるかもしれません。";
      } else {
        summary = "性格傾向に違いがあります。相互理解を深めることで、多様性を活かした関係を築けます。";
      }

      return {
        compatibilityScore,
        summary,
        friendName: friendUser?.name || "友達",
        friendBigFive,
        myBigFive,
      };
    }),
});
