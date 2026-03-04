import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const matchingToolsRouter = router({
  generatePresentation: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT ms.*, mr.compatibilityScore, mr.summary, mr.strengths, mr.challenges, mr.recommendations FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const dialogues = await ctx.env.DB.prepare(`SELECT md.*, dt.name as speakerName FROM matching_dialogues md JOIN digital_twins dt ON dt.id=md.speakerTwinId WHERE md.sessionId=? ORDER BY md.turnNumber`).bind(input.sessionId).all<any>();
      const twin1 = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const strengths = parseJson<string[]>(session.strengths) ?? [];
      const challenges = parseJson<string[]>(session.challenges) ?? [];
      const recommendations = parseJson<string[]>(session.recommendations) ?? [];
      const dialogueText = (dialogues.results ?? []).map((d: any) => `${d.speakerName}: ${d.content}`).join("\n\n");

      const markdown = `# マッチングレポート\n## テーマ: ${session.theme}\n\n**参加者**: ${twin1?.name ?? "Twin 1"} × ${twin2?.name ?? "Twin 2"}\n**相性スコア**: ${session.compatibilityScore ?? "-"}%\n\n---\n\n## 要約\n${session.summary || "分析結果なし"}\n\n## 強み\n${strengths.map(s => `- ${s}`).join("\n") || "- なし"}\n\n## 課題\n${challenges.map(s => `- ${s}`).join("\n") || "- なし"}\n\n## 提案\n${recommendations.map(s => `- ${s}`).join("\n") || "- なし"}\n\n---\n\n## 対話ログ\n${dialogueText || "対話なし"}`;
      const slideCount = 4 + Math.ceil((dialogues.results?.length ?? 0) / 3);
      return { slideContent: { markdown, slideCount }, slideCount };
    }),
  generateNanoBananaSlides: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT ms.*, mr.compatibilityScore, mr.summary, mr.strengths, mr.challenges FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const twin1 = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const strengths = parseJson<string[]>(session.strengths) ?? [];
      const challenges = parseJson<string[]>(session.challenges) ?? [];
      const slides = [
        { title: session.theme, content: `${twin1?.name ?? "Twin 1"} × ${twin2?.name ?? "Twin 2"}`, type: "title" },
        { title: "相性スコア", content: `${session.compatibilityScore ?? 0}%`, type: "score" },
        { title: "強み", content: strengths.join("\n"), type: "list" },
        { title: "課題と提案", content: challenges.join("\n"), type: "list" },
      ];
      return { slideContentFile: "", slideCount: slides.length, slides, theme: session.theme, twin1Name: twin1?.name ?? "", twin2Name: twin2?.name ?? "", compatibilityScore: parseFloat(session.compatibilityScore ?? "0") };
    }),
  exportPptx: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async () => {
      // PPTX generation requires external library not available in CF Workers
      // Return empty with message - users should use PDF export instead
      return { base64: "", filename: "", url: undefined as string | undefined, message: "PPTX出力は現在準備中です。PDF出力をご利用ください。" };
    }),

  // ============ AI Auto-Scheduler v2 ============
  getSchedulerPreferences: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const prefs = await ctx.env.DB.prepare(`SELECT * FROM scheduler_preferences WHERE userId=?`).bind(ctx.userId).first<any>();
    if (!prefs) return null;
    return {
      ...prefs,
      availableSlots: parseJson<string[]>(prefs.availableSlots) || [],
      preferredThemes: parseJson<string[]>(prefs.preferredThemes) || [],
    };
  }),
  updateSchedulerPreferences: protectedProcedure
    .input(z.object({
      availableSlots: z.array(z.string()).optional(),
      preferredThemes: z.array(z.string()).optional(),
      autoExecute: z.boolean().optional(),
      frequency: z.enum(["daily", "weekly", "biweekly", "monthly"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await ctx.env.DB.prepare(`SELECT id FROM scheduler_preferences WHERE userId=?`).bind(ctx.userId).first<any>();
      if (existing) {
        const updates: string[] = [];
        const params: any[] = [];
        if (input.availableSlots !== undefined) { updates.push("availableSlots=?"); params.push(toJson(input.availableSlots)); }
        if (input.preferredThemes !== undefined) { updates.push("preferredThemes=?"); params.push(toJson(input.preferredThemes)); }
        if (input.autoExecute !== undefined) { updates.push("autoExecute=?"); params.push(input.autoExecute ? 1 : 0); }
        if (input.frequency !== undefined) { updates.push("frequency=?"); params.push(input.frequency); }
        updates.push("updatedAt=datetime('now')");
        params.push(ctx.userId);
        await ctx.env.DB.prepare(`UPDATE scheduler_preferences SET ${updates.join(",")} WHERE userId=?`).bind(...params).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO scheduler_preferences (userId, availableSlots, preferredThemes, autoExecute, frequency) VALUES (?,?,?,?,?)`
        ).bind(ctx.userId, toJson(input.availableSlots || []), toJson(input.preferredThemes || []), input.autoExecute ? 1 : 0, input.frequency || "weekly").run();
      }
      return { success: true };
    }),
  getSchedulerSuggestions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!myTwin) return [];

    const prefs = await ctx.env.DB.prepare(`SELECT * FROM scheduler_preferences WHERE userId=?`).bind(ctx.userId).first<any>();
    const preferredThemes = parseJson<string[]>(prefs?.preferredThemes) || [];

    // Get friends with twins
    const friendRows = await ctx.env.DB.prepare(
      `SELECT u.id as fId, u.name as fName, dt.name as twinName, dt.description as twinDesc, dt.tags as twinTags, up.industry
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END
       LEFT JOIN digital_twins dt ON dt.userId = u.id
       LEFT JOIN user_profiles up ON up.userId = u.id
       WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted' AND dt.id IS NOT NULL`
    ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();

    // Get recent matching history
    const recentMatches = await ctx.env.DB.prepare(
      `SELECT ms.theme, ms.twin2Id, mr.compatibilityScore, dt.userId as friendUserId, u.name as friendName
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId = ms.id
       LEFT JOIN digital_twins dt ON dt.id = ms.twin2Id
       LEFT JOIN users u ON u.id = dt.userId
       WHERE ms.initiatorUserId = ? AND ms.status = 'completed'
       ORDER BY ms.createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();

    const friends = friendRows.results ?? [];
    const history = recentMatches.results ?? [];
    if (friends.length === 0) return [];

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "analysis", ctx.env);
    if (!llmConfig) {
      // Fallback: return top 3 friends with generic themes
      return friends.slice(0, 3).map((f: any) => ({
        friendId: f.fId,
        friendName: f.fName,
        suggestedTheme: preferredThemes[0] || "ビジネス協業の可能性",
        reason: "プロフィール情報に基づく推薦",
        estimatedScore: 65,
      }));
    }

    const friendSummaries = friends.map((f: any) => `${f.fName}: ${f.twinDesc || ""}${f.industry ? ` (${f.industry})` : ""}`).join("\n");
    const historyText = history.map((h: any) => `${h.friendName}: テーマ「${h.theme}」→ ${h.compatibilityScore}%`).join("\n");

    const result = await invokeLLM(llmConfig, [
      { role: "system", content: `あなたはビジネスマッチングスケジューラーです。ユーザーの過去のマッチング結果と友達リストから、次に最適なマッチング相手とテーマを3件提案してください。
JSON配列で出力: [{"friendName":"名前","suggestedTheme":"テーマ","reason":"理由","estimatedScore":70}]` },
      { role: "user", content: `私のツイン: ${myTwin.name} - ${myTwin.description || ""}
好みのテーマ: ${preferredThemes.join(", ") || "なし"}

友達リスト:
${friendSummaries}

過去のマッチング:
${historyText || "なし"}

3件の提案をJSONで出力してください。` },
    ], { maxTokens: 1024, temperature: 0.5 });

    try {
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        return suggestions.map((s: any) => {
          const friend = friends.find((f: any) => f.fName === s.friendName);
          return {
            friendId: friend?.fId || 0,
            friendName: s.friendName,
            suggestedTheme: s.suggestedTheme,
            reason: s.reason,
            estimatedScore: s.estimatedScore || 65,
          };
        }).filter((s: any) => s.friendId > 0);
      }
    } catch {}
    return [];
  }),
  executeScheduledMatching: protectedProcedure
    .input(z.object({ friendId: z.number(), theme: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // This is basically a wrapper around startStreaming with the suggested params
      await ensureSchema(ctx.env.DB);
      // Update lastSuggestionAt
      await ctx.env.DB.prepare(`UPDATE scheduler_preferences SET lastSuggestionAt=datetime('now') WHERE userId=?`).bind(ctx.userId).run();
      // Return the friendId and theme so the frontend can call startStreaming
      return { friendId: input.friendId, theme: input.theme, execute: true };
    }),

  // ============ Multilingual Twin Dialogue ============
  translateDialogue: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      targetLanguage: z.string().min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();

      if (!dialogues.results?.length) return { translations: [] };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "translation", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "翻訳にはLLM APIキーが必要です" });

      const textsToTranslate = (dialogues.results ?? []).map((d: any) => ({ turnNumber: d.turnNumber, content: d.content }));
      const batchSize = 5;
      const translations: { turnNumber: number; original: string; translated: string }[] = [];

      for (let i = 0; i < textsToTranslate.length; i += batchSize) {
        const batch = textsToTranslate.slice(i, i + batchSize);
        const prompt = batch.map((t: any) => `[Turn ${t.turnNumber}]: ${t.content}`).join("\n\n");

        const result = await invokeLLM(llmConfig, [
          { role: "system", content: `You are a professional translator. Translate the following dialogue turns to ${input.targetLanguage}. Keep the [Turn X] prefix. Translate naturally, preserving business context and nuance. Output ONLY the translations, one per line with the same [Turn X] prefix.` },
          { role: "user", content: prompt },
        ], { maxTokens: 4096, temperature: 0.2 });

        for (const item of batch) {
          const regex = new RegExp(`\\[Turn ${item.turnNumber}\\]:\\s*(.+?)(?=\\[Turn |$)`, 's');
          const match = result.content.match(regex);
          translations.push({
            turnNumber: item.turnNumber,
            original: item.content,
            translated: match ? match[1].trim() : item.content,
          });
        }
      }

      return { translations, targetLanguage: input.targetLanguage };
    }),
  createMultilingual: protectedProcedure
    .input(z.object({
      friendId: z.number(),
      theme: z.string().min(1).max(500),
      turns: z.number().min(1).max(20).default(5),
      language1: z.string().default("日本語"),
      language2: z.string().default("English"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

      const friendTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
      if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIが見つかりません" });

      const sessionRes = await ctx.env.DB.prepare(
        `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'running',?)`
      ).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme,
        toJson({ friendId: input.friendId, multilingual: true, language1: input.language1, language2: input.language2 })
      ).run();
      const sessionId = Number(sessionRes.meta.last_row_id);

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      const dialogueHistory: { speaker: string; content: string; translated: string }[] = [];

      for (let turn = 0; turn < input.turns; turn++) {
        const isTwin1 = turn % 2 === 0;
        const speaker = isTwin1 ? myTwin : friendTwin;
        const speakerLang = isTwin1 ? input.language1 : input.language2;
        const otherLang = isTwin1 ? input.language2 : input.language1;
        const speakerName = speaker.name || `Twin #${speaker.id}`;

        const context = dialogueHistory.map(d => `${d.speaker} (${d.content})`).join("\n");

        let content = `${speakerName}として${speakerLang}で発言します。`;
        let translated = content;

        try {
          if (llmConfig) {
            const translatedContext = dialogueHistory.map(d => `${d.speaker}: ${d.translated}`).join("\n");

            const msgs: { role: "system" | "user"; content: string }[] = [
              { role: "system", content: `あなたは「${speakerName}」です。性格: ${speaker.personality || "プロフェッショナル"}。
テーマ「${input.theme}」について${speakerLang}で発言してください。
必ず${speakerLang}で書いてください。他の参加者は${otherLang}で話します。
発言は100〜250文字程度で簡潔に。` },
              ...(context ? [{ role: "user" as const, content: `これまでの対話:\n${translatedContext}\n\n${speakerName}として${speakerLang}で次の発言をしてください。` }] : [{ role: "user" as const, content: `テーマ「${input.theme}」について${speakerLang}で最初の発言をしてください。` }]),
            ];
            const result = await invokeLLM(llmConfig, msgs, { maxTokens: 512, temperature: 0.8 });
            if (result.content) content = result.content;

            // Translate to the other language
            const transResult = await invokeLLM(llmConfig, [
              { role: "system", content: `Translate the following text to ${otherLang}. Output ONLY the translation, nothing else.` },
              { role: "user", content },
            ], { maxTokens: 512, temperature: 0.2 });
            translated = transResult.content || content;
          }
        } catch { translated = content; }

        await ctx.env.DB.prepare(
          `INSERT INTO matching_dialogues (sessionId, turnNumber, speakerTwinId, content, aiProvider, aiModel, createdAt) VALUES (?,?,?,?,?,?,datetime('now'))`
        ).bind(sessionId, turn, speaker.id, JSON.stringify({ original: content, translated, language: speakerLang }), "multilingual", "v1").run();

        dialogueHistory.push({ speaker: speakerName, content, translated });
      }

      // Run standard analysis
      const dialogueText = dialogueHistory.map(d => `${d.speaker}: ${d.content} [翻訳: ${d.translated}]`).join("\n");

      try {
        if (llmConfig) {
          const analysisResult = await invokeLLM(llmConfig, [
            { role: "system", content: "ビジネスマッチング分析の専門家です。多言語対話を分析してください。JSON形式で回答。" },
            { role: "user", content: `テーマ: ${input.theme}\n${myTwin.name}(${input.language1}) vs ${friendTwin.name}(${input.language2})\n\n${dialogueText}\n\nJSON: {"compatibilityScore":0-100,"summary":"","strengths":[""],"challenges":[""],"recommendations":[""],"scoreBreakdown":{"skillMatch":{"score":0,"reason":""},"valueAlignment":{"score":0,"reason":""},"communicationStyle":{"score":0,"reason":""},"businessGoalFit":{"score":0,"reason":""},"complementaryStrengths":{"score":0,"reason":""}}}` },
          ], { maxTokens: 2048 });

          const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            await ctx.env.DB.prepare(
              `INSERT INTO matching_results (sessionId, compatibilityScore, summary, scoreBreakdown, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?,?)`
            ).bind(sessionId, analysis.compatibilityScore ?? 65, analysis.summary || "", toJson(analysis.scoreBreakdown || {}), toJson(analysis.strengths || []), toJson(analysis.challenges || []), toJson(analysis.recommendations || [])).run();
          }
        }
      } catch {
        await ctx.env.DB.prepare(
          `INSERT INTO matching_results (sessionId, compatibilityScore, summary) VALUES (?,?,?)`
        ).bind(sessionId, 65, "多言語対話が完了しました。").run();
      }

      await ctx.env.DB.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();

      return { sessionId };
    }),

  // ============ Dialogue Replay Mode ============
  getReplayData: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      
      const twin1 = await ctx.env.DB.prepare(`SELECT id, name, personality, avatarUrl FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, name, personality, avatarUrl FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      
      const notes = await ctx.env.DB.prepare(
        `SELECT * FROM matching_notes WHERE sessionId=? AND userId=? ORDER BY turnNumber`
      ).bind(input.sessionId, ctx.userId).all<any>();
      
      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
      
      return {
        session: { ...session, settings: parseJson<any>(session.settings) },
        twin1: twin1 ? { id: twin1.id, name: twin1.name, personality: twin1.personality, avatarUrl: twin1.avatarUrl } : null,
        twin2: twin2 ? { id: twin2.id, name: twin2.name, personality: twin2.personality, avatarUrl: twin2.avatarUrl } : null,
        dialogues: dialogues.results ?? [],
        notes: (notes.results ?? []).map((n: any) => ({
          turnNumber: n.turnNumber,
          content: n.content,
          updatedAt: n.updatedAt,
        })),
        result: result ? {
          compatibilityScore: result.compatibilityScore,
          summary: result.summary,
        } : null,
      };
    }),
  saveNote: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      turnNumber: z.number(),
      content: z.string().max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (!input.content.trim()) {
        // Delete note if empty
        await ctx.env.DB.prepare(
          `DELETE FROM matching_notes WHERE sessionId=? AND turnNumber=? AND userId=?`
        ).bind(input.sessionId, input.turnNumber, ctx.userId).run();
        return { deleted: true };
      }
      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_notes (sessionId, turnNumber, userId, content, updatedAt) VALUES (?,?,?,?,datetime('now'))`
      ).bind(input.sessionId, input.turnNumber, ctx.userId, input.content.trim()).run();
      return { saved: true };
    }),

  // ============ A/B Test Matching ============
  abTestCreate: protectedProcedure.input(z.object({
    theme: z.string().min(1),
    friendId: z.number(),
    personalityA: z.string(),
    personalityB: z.string(),
    turns: z.number().min(1).max(10).optional(),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const myTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=?`).bind(ctx.userId).first<any>();
    const friendTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=?`).bind(input.friendId).first<any>();
    if (!myTwin || !friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // Create two sessions: A and B with different personality settings
    const settingsA = toJson({ abTest: true, variant: "A", personality: input.personalityA, friendId: input.friendId, turns: input.turns ?? 5 });
    const settingsB = toJson({ abTest: true, variant: "B", personality: input.personalityB, friendId: input.friendId, turns: input.turns ?? 5 });

    const resA = await ctx.env.DB.prepare(
      `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'pending',?)`
    ).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme, settingsA).run();

    const resB = await ctx.env.DB.prepare(
      `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'pending',?)`
    ).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme, settingsB).run();

    return { sessionIdA: Number(resA.meta.last_row_id), sessionIdB: Number(resB.meta.last_row_id) };
  }),
  abTestResults: protectedProcedure.input(z.object({
    sessionIdA: z.number(), sessionIdB: z.number(),
  })).query(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const getSessionData = async (sid: number) => {
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=? AND initiatorUserId=?`).bind(sid, ctx.userId).first<any>();
      if (!session) return null;
      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(sid).first<any>();
      const dialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(sid).all<any>();
      return {
        session: { ...session, settings: parseJson<any>(session.settings) },
        result: result ? { ...result, scoreBreakdown: parseJson<any>(result.scoreBreakdown), strengths: parseJson<string[]>(result.strengths), challenges: parseJson<string[]>(result.challenges), recommendations: parseJson<string[]>(result.recommendations) } : null,
        dialogues: dialogues.results ?? [],
      };
    };
    const a = await getSessionData(input.sessionIdA);
    const b = await getSessionData(input.sessionIdB);
    if (!a || !b) throw new TRPCError({ code: "NOT_FOUND" });

    const scoreA = a.result?.compatibilityScore ?? 0;
    const scoreB = b.result?.compatibilityScore ?? 0;
    const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "tie";
    const diff = Math.abs(scoreA - scoreB);

    return { a, b, comparison: { winner, scoreDiff: diff, scoreA, scoreB } };
  }),
  abTestList: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, ms.status, ms.settings, ms.createdAt, mr.compatibilityScore FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE ms.initiatorUserId=? AND json_extract(ms.settings, '$.abTest')=1 ORDER BY ms.createdAt DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, settings: parseJson<any>(r.settings) }));
  }),

  // ============ Dialogue Templates ============
  createTemplate: protectedProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      theme: z.string().min(1).max(500),
      turns: z.number().min(1).max(20).default(5),
      systemPrompt: z.string().max(5000).optional(),
      tags: z.array(z.string()).max(10).optional(),
      visibility: z.enum(["public", "private"]).default("private"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // If from session, extract dialogue pattern
      let dialoguePattern: string | null = null;
      if (input.sessionId) {
        const dialogues = await ctx.env.DB.prepare(
          `SELECT md.turnNumber, md.content, dt.name as speakerName
           FROM matching_dialogues md
           LEFT JOIN digital_twins dt ON dt.id = md.speakerTwinId
           WHERE md.sessionId=? ORDER BY md.turnNumber`
        ).bind(input.sessionId).all<any>();
        if (dialogues.results?.length) {
          dialoguePattern = JSON.stringify(
            (dialogues.results ?? []).map((d: any) => ({
              turn: d.turnNumber,
              speaker: d.speakerName,
              contentPreview: (d.content || "").slice(0, 100),
            }))
          );
        }
      }
      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_templates (userId, name, description, theme, turns, systemPrompt, dialoguePattern, tags, visibility)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(
        ctx.userId, input.name, input.description || null, input.theme,
        input.turns, input.systemPrompt || null, dialoguePattern,
        JSON.stringify(input.tags || []), input.visibility
      ).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  listTemplates: protectedProcedure
    .input(z.object({
      publicOnly: z.boolean().default(false),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let sql: string;
      let params: any[];
      if (input.publicOnly) {
        sql = `SELECT mt.*, u.name as creatorName, (SELECT COUNT(*) FROM matching_template_uses WHERE templateId=mt.id) as useCount
               FROM matching_templates mt LEFT JOIN users u ON u.id=mt.userId
               WHERE mt.visibility='public' ORDER BY useCount DESC LIMIT ?`;
        params = [input.limit];
      } else {
        sql = `SELECT mt.*, u.name as creatorName, (SELECT COUNT(*) FROM matching_template_uses WHERE templateId=mt.id) as useCount
               FROM matching_templates mt LEFT JOIN users u ON u.id=mt.userId
               WHERE mt.userId=? OR mt.visibility='public' ORDER BY mt.createdAt DESC LIMIT ?`;
        params = [ctx.userId, input.limit];
      }
      const rows = await ctx.env.DB.prepare(sql).bind(...params).all<any>();
      return (rows.results ?? []).map((r: any) => ({
        ...r,
        tags: parseJson<string[]>(r.tags) ?? [],
        dialoguePattern: parseJson<any>(r.dialoguePattern),
      }));
    }),
  useTemplate: protectedProcedure
    .input(z.object({ templateId: z.number(), friendId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const tmpl = await ctx.env.DB.prepare(`SELECT * FROM matching_templates WHERE id=?`).bind(input.templateId).first<any>();
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND", message: "テンプレートが見つかりません" });
      // Record use
      await ctx.env.DB.prepare(
        `INSERT INTO matching_template_uses (templateId, userId) VALUES (?,?)`
      ).bind(input.templateId, ctx.userId).run();
      // Return template data for client to call startStreaming with
      return {
        theme: tmpl.theme,
        turns: tmpl.turns,
        systemPrompt: tmpl.systemPrompt || null,
        friendId: input.friendId,
      };
    }),
  deleteTemplate: protectedProcedure
    .input(z.object({ templateId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM matching_templates WHERE id=? AND userId=?`).bind(input.templateId, ctx.userId).run();
      return { success: true };
    }),

  // ============ Phase 17: AIネゴシエーション・シミュレーター ============
  startNegotiation: protectedProcedure
    .input(z.object({
      theme: z.string(),
      difficulty: z.enum(["beginner", "intermediate", "advanced"]),
      personaId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const difficultyProfiles: Record<string, { role: string; style: string }> = {
        beginner: { role: "協力的なビジネスパートナー", style: "穏やかで協力的。相手の提案を受け入れやすく、Win-Winを目指す。" },
        intermediate: { role: "経験豊富な交渉担当者", style: "論理的で冷静。自社の利益を守りつつ、合理的な妥協点を探る。時折プレッシャーをかける。" },
        advanced: { role: "厳しい交渉のプロフェッショナル", style: "非常にタフ。高圧的な戦術、沈黙、最後通牒を使う。簡単には譲歩しない。相手の弱点を突く。" },
      };

      const profile = difficultyProfiles[input.difficulty];

      const res = await ctx.env.DB.prepare(
        `INSERT INTO negotiation_sessions (userId, theme, difficulty, opponentRole, personaId, status) VALUES (?,?,?,?,?,?)`
      ).bind(ctx.userId, input.theme, input.difficulty, profile.role, input.personaId ?? null, "active").run();
      const sessionId = res.meta?.last_row_id as number;

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      let opponentMessage = `こんにちは。「${input.theme}」についてお話しましょう。私は${profile.role}です。まず、貴社のご要望をお聞かせください。`;

      if (llmConfig) {
        try {
          const result = await invokeLLM(llmConfig, [
            { role: "system", content: `あなたはビジネス交渉のロールプレイ相手です。\n役割: ${profile.role}\n交渉スタイル: ${profile.style}\n交渉テーマ: ${input.theme}\n\nあなたは交渉の相手方として振る舞います。最初の発言として、自己紹介と自社の立場を述べ、交渉を開始してください。日本語で簡潔に（200文字以内で）応答してください。` },
            { role: "user", content: `交渉テーマ「${input.theme}」について、最初の発言をしてください。` },
          ], { maxTokens: 512, temperature: 0.8 });
          opponentMessage = result.content;
        } catch { /* use fallback */ }
      }

      await ctx.env.DB.prepare(
        `INSERT INTO negotiation_turns (negotiationId, turnNumber, role, content) VALUES (?,?,?,?)`
      ).bind(sessionId, 1, "opponent", opponentMessage).run();

      return { sessionId, opponentMessage, opponentRole: profile.role };
    }),
  sendNegotiationMessage: protectedProcedure
    .input(z.object({
      negotiationId: z.number(),
      message: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const session = await ctx.env.DB.prepare(
        `SELECT * FROM negotiation_sessions WHERE id=? AND userId=? AND status='active'`
      ).bind(input.negotiationId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "交渉セッションが見つかりません" });

      const turns = await ctx.env.DB.prepare(
        `SELECT role, content FROM negotiation_turns WHERE negotiationId=? ORDER BY turnNumber ASC`
      ).bind(input.negotiationId).all<any>();
      const history = (turns.results ?? []).map((t: any) => `${t.role === "user" ? "あなた" : "相手"}: ${t.content}`).join("\n");

      const nextTurn = (turns.results?.length ?? 0) + 1;

      await ctx.env.DB.prepare(
        `INSERT INTO negotiation_turns (negotiationId, turnNumber, role, content) VALUES (?,?,?,?)`
      ).bind(input.negotiationId, nextTurn, "user", input.message).run();

      const difficultyStyles: Record<string, string> = {
        beginner: "穏やかで協力的。相手の提案を受け入れやすく、Win-Winを目指す。",
        intermediate: "論理的で冷静。自社の利益を守りつつ、合理的な妥協点を探る。時折プレッシャーをかける。",
        advanced: "非常にタフ。高圧的な戦術、沈黙、最後通牒を使う。簡単には譲歩しない。相手の弱点を突く。",
      };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      let opponentResponse = "承知しました。その点についてもう少し具体的にお聞かせいただけますか？";

      if (llmConfig) {
        try {
          const result = await invokeLLM(llmConfig, [
            { role: "system", content: `あなたはビジネス交渉のロールプレイ相手です。\n役割: ${session.opponentRole}\n交渉スタイル: ${difficultyStyles[session.difficulty as string] || difficultyStyles.beginner}\n交渉テーマ: ${session.theme}\n\nこれまでの会話:\n${history}\n\n相手の最新発言に対して、あなたの役割に忠実に応答してください。日本語で簡潔に（200文字以内で）応答してください。` },
            { role: "user", content: input.message },
          ], { maxTokens: 512, temperature: 0.8 });
          opponentResponse = result.content;
        } catch { /* use fallback */ }
      }

      await ctx.env.DB.prepare(
        `INSERT INTO negotiation_turns (negotiationId, turnNumber, role, content) VALUES (?,?,?,?)`
      ).bind(input.negotiationId, nextTurn + 1, "opponent", opponentResponse).run();

      return { opponentResponse, turnNumber: nextTurn + 1 };
    }),
  endNegotiation: protectedProcedure
    .input(z.object({ negotiationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      const session = await ctx.env.DB.prepare(
        `SELECT * FROM negotiation_sessions WHERE id=? AND userId=?`
      ).bind(input.negotiationId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "交渉セッションが見つかりません" });

      const turns = await ctx.env.DB.prepare(
        `SELECT role, content, turnNumber FROM negotiation_turns WHERE negotiationId=? ORDER BY turnNumber ASC`
      ).bind(input.negotiationId).all<any>();
      const dialogue = (turns.results ?? []).map((t: any) => `ターン${t.turnNumber} [${t.role === "user" ? "ユーザー" : "相手"}]: ${t.content}`).join("\n");

      let analysis: any = { overallScore: 50, techniques: [], strengths: [], improvements: [], detailedFeedback: "分析を完了できませんでした" };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (llmConfig) {
        try {
          const result = await invokeLLM(llmConfig, [
            { role: "system", content: `あなたはビジネス交渉スキルの評価エキスパートです。以下の交渉ロールプレイを分析し、ユーザーの交渉スキルを評価してください。\n\n交渉テーマ: ${session.theme}\n難易度: ${session.difficulty}\n相手の役割: ${session.opponentRole}\n\n以下のJSON形式で回答してください（JSONのみ、他のテキストは不要）:\n{\n  "overallScore": <0-100の総合スコア>,\n  "techniques": [\n    { "name": "<技法名>", "score": <0-100>, "feedback": "<具体的フィードバック>" }\n  ],\n  "strengths": ["<強み1>", "<強み2>"],\n  "improvements": ["<改善点1>", "<改善点2>"],\n  "detailedFeedback": "<詳細な総合フィードバック>"\n}\n\ntechniques には最低5つの評価軸を含めてください:\n- 論理的説得力\n- 感情コントロール\n- 創造的解決策\n- 情報収集力\n- 譲歩戦略` },
            { role: "user", content: `以下の交渉を評価してください:\n\n${dialogue}` },
          ], { maxTokens: 2048 });
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
        } catch { /* use default */ }
      }

      await ctx.env.DB.prepare(
        `UPDATE negotiation_sessions SET status='completed', score=?, feedback=?, completedAt=datetime('now') WHERE id=?`
      ).bind(analysis.overallScore, toJson(analysis), input.negotiationId).run();

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (twin) {
        const existing = await ctx.env.DB.prepare(
          `SELECT id, level FROM twin_skill_levels WHERE twinId=? AND skillType='negotiation'`
        ).bind(twin.id).first<any>();
        if (existing) {
          const newLevel = Math.min(5, (existing.level as number) + 1);
          await ctx.env.DB.prepare(
            `UPDATE twin_skill_levels SET level=?, updatedAt=datetime('now') WHERE id=?`
          ).bind(newLevel, existing.id).run();
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO twin_skill_levels (twinId, userId, skillType, level) VALUES (?,?,?,?)`
          ).bind(twin.id, ctx.userId, "negotiation", 1).run();
        }
      }

      return analysis;
    }),
  getNegotiationHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    const rows = await ctx.env.DB.prepare(
      `SELECT ns.id, ns.theme, ns.difficulty, ns.score, ns.opponentRole, ns.status, ns.createdAt,
              (SELECT COUNT(*) FROM negotiation_turns WHERE negotiationId=ns.id) as turnCount
       FROM negotiation_sessions ns
       WHERE ns.userId=?
       ORDER BY ns.createdAt DESC
       LIMIT 50`
    ).bind(ctx.userId).all<any>();

    return (rows.results ?? []).map((r: any) => ({
      id: r.id,
      theme: r.theme,
      difficulty: r.difficulty,
      score: r.score,
      opponentRole: r.opponentRole,
      status: r.status,
      turnCount: r.turnCount,
      createdAt: r.createdAt,
    }));
  }),
  // ============ AIマッチング戦略プランナー ============
  generateStrategy: protectedProcedure
    .input(z.object({ friendId: z.number(), theme: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;

      // Load user's twin + profile
      const myTwin = await getMyTwin(db, ctx.userId);
      if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "あなたのツインが見つかりません" });
      const myProfile = await db.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

      // Load friend's twin + profile
      const friendTwin = await getMyTwin(db, input.friendId);
      if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "相手のツインが見つかりません" });
      const friendProfile = await db.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(input.friendId).first<any>();
      const friendUser = await db.prepare(`SELECT name FROM users WHERE id=?`).bind(input.friendId).first<any>();

      // Load past matching history between them
      const pastMatchings = await db.prepare(
        `SELECT ms.theme, ms.createdAt, mr.compatibilityScore, mr.summary
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         WHERE ms.initiatorUserId = ? AND (ms.twin1Id = ? OR ms.twin2Id = ?)
         ORDER BY ms.createdAt DESC LIMIT 5`
      ).bind(ctx.userId, friendTwin.id, friendTwin.id).all<any>();

      // Load personality profiles
      const myBigFive = myTwin.bigFiveTraits ? JSON.stringify(myTwin.bigFiveTraits) : "未診断";
      const friendBigFive = friendTwin.bigFiveTraits ? JSON.stringify(friendTwin.bigFiveTraits) : "未診断";

      const historyText = (pastMatchings.results ?? []).map((m: any) =>
        `テーマ: ${m.theme || "なし"}, スコア: ${m.compatibilityScore || "N/A"}, 要約: ${m.summary || "N/A"}`
      ).join("\n") || "過去のマッチング履歴なし";

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      const systemPrompt = `あなたはビジネスマッチングの戦略アドバイザーです。2人のプロフィールと過去の履歴を分析し、最適なマッチング戦略を立案してください。必ず以下のJSON形式で返してください:
{"emphasize":["強調すべきポイント"],"avoid":["避けるべきこと"],"approach":"アプローチ方法","openingStrategy":"オープニング戦略","keyPoints":["キーポイント"],"predictedChallenges":["予測される課題"],"confidenceLevel":0.8}`;

      const userPrompt = `【あなた側】
名前: ${myTwin.name}
性格: ${myTwin.personality || "未設定"}
説明: ${myTwin.description || "未設定"}
業界: ${myProfile?.industry || "未設定"}
スキル: ${myProfile?.skills || "未設定"}
Big Five: ${myBigFive}
MBTI: ${myTwin.mbtiType || "未診断"}

【相手側】
名前: ${friendTwin.name} (${friendUser?.name || "不明"})
性格: ${friendTwin.personality || "未設定"}
説明: ${friendTwin.description || "未設定"}
業界: ${friendProfile?.industry || "未設定"}
スキル: ${friendProfile?.skills || "未設定"}
Big Five: ${friendBigFive}
MBTI: ${friendTwin.mbtiType || "未診断"}

【過去のマッチング履歴】
${historyText}

${input.theme ? `【テーマ】${input.theme}` : ""}

上記を分析し、マッチング戦略をJSON形式で返してください。`;

      const rawResult = await invokeLLM(llmConfig!, [{role: "system", content: systemPrompt}, {role: "user", content: userPrompt}]);
      const raw = rawResult.content;
      let strategy: any;
      try {
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        strategy = JSON.parse(cleaned);
      } catch {
        strategy = {
          emphasize: ["共通の業界知識を活用"],
          avoid: ["一方的な話題にならないよう注意"],
          approach: "相互理解を深める対話型アプローチ",
          openingStrategy: "共通の関心事から話を始める",
          keyPoints: ["相手の専門性を尊重する", "具体的な協業案を提示する"],
          predictedChallenges: ["業界の違いによる認識のズレ"],
          confidenceLevel: 0.6,
        };
      }

      const result = await db.prepare(
        `INSERT INTO matching_strategies (userId, friendId, theme, strategy, createdAt, updatedAt) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(ctx.userId, input.friendId, input.theme || null, toJson(strategy)).run();

      const strategyId = result.meta?.last_row_id;

      return { id: strategyId, strategy, friendName: friendUser?.name || friendTwin.name, theme: input.theme || null };
    }),
  getStrategy: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM matching_strategies WHERE userId=? AND friendId=? ORDER BY createdAt DESC LIMIT 1`
      ).bind(ctx.userId, input.friendId).first<any>();
      if (!row) return null;
      return {
        id: row.id,
        friendId: row.friendId,
        theme: row.theme,
        strategy: parseJson<any>(row.strategy),
        notes: row.notes,
        review: parseJson<any>(row.review),
        effectiveness: row.effectiveness,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
  saveStrategyNote: protectedProcedure
    .input(z.object({ strategyId: z.number(), note: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM matching_strategies WHERE id=? AND userId=?`
      ).bind(input.strategyId, ctx.userId).first<any>();
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "戦略が見つかりません" });

      await ctx.env.DB.prepare(
        `UPDATE matching_strategies SET notes=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(input.note, input.strategyId).run();

      return { success: true };
    }),
  reviewStrategy: protectedProcedure
    .input(z.object({
      strategyId: z.number(),
      sessionId: z.number(),
      effectiveness: z.enum(["excellent", "good", "neutral", "poor"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;

      const strategyRow = await db.prepare(
        `SELECT * FROM matching_strategies WHERE id=? AND userId=?`
      ).bind(input.strategyId, ctx.userId).first<any>();
      if (!strategyRow) throw new TRPCError({ code: "NOT_FOUND", message: "戦略が見つかりません" });

      const matchResult = await db.prepare(
        `SELECT mr.*, ms.theme FROM matching_results mr JOIN matching_sessions ms ON ms.id = mr.sessionId WHERE mr.sessionId=?`
      ).bind(input.sessionId).first<any>();
      if (!matchResult) throw new TRPCError({ code: "NOT_FOUND", message: "マッチング結果が見つかりません" });

      const strategy = parseJson<any>(strategyRow.strategy) || {};
      const llmConfig = await getUserLLMConfig(db, ctx.userId, "matching", ctx.env);

      const systemPrompt = `あなたはマッチング戦略の評価アドバイザーです。事前に立てた戦略と実際のマッチング結果を比較し、振り返りを生成してください。必ず以下のJSON形式で返してください:
{"lessonsLearned":["学んだこと"],"effectivenessScore":0.8,"whatWorked":["うまくいったこと"],"whatDidnt":["うまくいかなかったこと"],"nextTimeAdvice":"次回へのアドバイス"}`;

      const userPrompt = `【事前戦略】
${JSON.stringify(strategy, null, 2)}

【ユーザーの効果評価】${input.effectiveness}

【マッチング結果】
テーマ: ${matchResult.theme || "なし"}
スコア: ${matchResult.compatibilityScore || "N/A"}
要約: ${matchResult.summary || "N/A"}
強み: ${matchResult.strengths || "N/A"}
課題: ${matchResult.challenges || "N/A"}

上記を分析し、戦略の振り返りをJSON形式で返してください。`;

      const rawResult = await invokeLLM(llmConfig!, [{role: "system", content: systemPrompt}, {role: "user", content: userPrompt}]);
      const raw = rawResult.content;
      let review: any;
      try {
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        review = JSON.parse(cleaned);
      } catch {
        review = {
          lessonsLearned: ["データを基にした分析が必要です"],
          effectivenessScore: 0.5,
          whatWorked: ["戦略的アプローチの試み"],
          whatDidnt: ["詳細な分析が不足"],
          nextTimeAdvice: "より具体的なゴール設定を行い、相手のニーズを事前にリサーチしましょう",
        };
      }

      await db.prepare(
        `UPDATE matching_strategies SET review=?, effectiveness=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(toJson(review), input.effectiveness, input.strategyId).run();

      return review;
    }),

  // ============ マッチング成果トラッカー ============
  createActionItem: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      title: z.string(),
      description: z.string().optional(),
      dueDate: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).default("medium"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Verify user owns this session
      const session = await ctx.env.DB.prepare(
        `SELECT id FROM matching_sessions WHERE id=? AND initiatorUserId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "マッチングセッションが見つかりません" });

      const result = await ctx.env.DB.prepare(
        `INSERT INTO matching_action_items (sessionId, userId, title, description, priority, dueDate, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(input.sessionId, ctx.userId, input.title, input.description || null, input.priority, input.dueDate || null).run();

      return { id: result.meta?.last_row_id };
    }),
  updateActionItem: protectedProcedure
    .input(z.object({
      itemId: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
      dueDate: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM matching_action_items WHERE id=? AND userId=?`
      ).bind(input.itemId, ctx.userId).first<any>();
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "アクションアイテムが見つかりません" });

      const updates: string[] = [];
      const values: any[] = [];
      if (input.title !== undefined) { updates.push("title=?"); values.push(input.title); }
      if (input.description !== undefined) { updates.push("description=?"); values.push(input.description); }
      if (input.status !== undefined) { updates.push("status=?"); values.push(input.status); }
      if (input.dueDate !== undefined) { updates.push("dueDate=?"); values.push(input.dueDate); }
      if (input.priority !== undefined) { updates.push("priority=?"); values.push(input.priority); }

      if (updates.length === 0) return { success: true };
      updates.push("updatedAt=datetime('now')");
      values.push(input.itemId);

      await ctx.env.DB.prepare(
        `UPDATE matching_action_items SET ${updates.join(", ")} WHERE id=?`
      ).bind(...values).run();

      return { success: true };
    }),
  listActionItems: protectedProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let sql = `SELECT mai.*, ms.theme as sessionTheme FROM matching_action_items mai
                 LEFT JOIN matching_sessions ms ON ms.id = mai.sessionId
                 WHERE mai.userId=?`;
      const binds: any[] = [ctx.userId];

      if (input.sessionId !== undefined) {
        sql += " AND mai.sessionId=?";
        binds.push(input.sessionId);
      }
      if (input.status !== undefined) {
        sql += " AND mai.status=?";
        binds.push(input.status);
      }
      sql += " ORDER BY mai.createdAt DESC";

      const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<any>();
      return (rows.results ?? []).map((r: any) => ({
        id: r.id,
        sessionId: r.sessionId,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority,
        dueDate: r.dueDate,
        sessionTheme: r.sessionTheme,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }),
  recordOutcome: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      outcomeType: z.enum(["meeting", "deal", "partnership", "referral", "other"]),
      description: z.string(),
      monetaryValue: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Verify user owns this session
      const session = await ctx.env.DB.prepare(
        `SELECT id FROM matching_sessions WHERE id=? AND initiatorUserId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "マッチングセッションが見つかりません" });

      const result = await ctx.env.DB.prepare(
        `INSERT INTO matching_outcomes (sessionId, userId, outcomeType, description, monetaryValue, createdAt)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(input.sessionId, ctx.userId, input.outcomeType, input.description, input.monetaryValue ?? 0).run();

      return { id: result.meta?.last_row_id };
    }),
  getOutcomeSummary: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;

    // Total outcomes and value
    const totals = await db.prepare(
      `SELECT COUNT(*) as totalOutcomes, COALESCE(SUM(monetaryValue), 0) as totalValue FROM matching_outcomes WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    // By type
    const byTypeRows = await db.prepare(
      `SELECT outcomeType, COUNT(*) as count, COALESCE(SUM(monetaryValue), 0) as value FROM matching_outcomes WHERE userId=? GROUP BY outcomeType`
    ).bind(ctx.userId).all<any>();

    const byType: Record<string, { count: number; value: number }> = {};
    for (const r of (byTypeRows.results ?? [])) {
      byType[r.outcomeType] = { count: r.count, value: r.value };
    }

    // Total matchings
    const totalMatchings = await db.prepare(
      `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=?`
    ).bind(ctx.userId).first<any>();

    // Matchings with outcomes
    const matchingsWithOutcomes = await db.prepare(
      `SELECT COUNT(DISTINCT sessionId) as cnt FROM matching_outcomes WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const totalM = totalMatchings?.cnt || 0;
    const withOutcomes = matchingsWithOutcomes?.cnt || 0;

    return {
      totalOutcomes: totals?.totalOutcomes || 0,
      totalValue: totals?.totalValue || 0,
      byType,
      matchingROI: totalM > 0 ? (totals?.totalValue || 0) / totalM : 0,
      outcomeRate: totalM > 0 ? withOutcomes / totalM : 0,
    };
  }),

  // ============ Feature 21-1: AIマッチングコーチング・プレイブック ============
  generatePlaybook: protectedProcedure
    .input(z.object({
      category: z.enum(["sales", "recruiting", "investor", "tech_alliance", "partnership", "general"]),
      customContext: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM APIキーが未設定です" });

      // Get user's matching history for personalization
      const history = await ctx.env.DB.prepare(
        `SELECT ms.theme, mr.compatibilityScore, mr.scoreBreakdown, mr.recommendations
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         WHERE ms.initiatorUserId = ? AND mr.id IS NOT NULL
         ORDER BY ms.createdAt DESC LIMIT 10`
      ).bind(ctx.userId).all<any>();

      const categoryLabels: Record<string, string> = {
        sales: "営業・商談", recruiting: "採用面接", investor: "投資家ピッチ",
        tech_alliance: "技術提携", partnership: "パートナーシップ", general: "一般ビジネス",
      };

      const historyContext = (history.results ?? []).map((h: any) => {
        const breakdown = parseJson<any>(h.scoreBreakdown);
        return `テーマ: ${h.theme}, スコア: ${h.compatibilityScore}, 強み: ${breakdown ? Object.entries(breakdown).filter(([,v]) => (v as number) >= 15).map(([k]) => k).join(",") : "N/A"}`;
      }).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたはビジネスマッチングの専門コンサルタントです。「${categoryLabels[input.category]}」カテゴリの実践的なプレイブックを作成してください。` },
        { role: "user", content: `カテゴリ: ${categoryLabels[input.category]}
${input.customContext ? `追加コンテキスト: ${input.customContext}` : ""}
${historyContext ? `\nユーザーの過去マッチング傾向:\n${historyContext}` : ""}

以下のJSON形式で出力してください:
{
  "title": "プレイブックタイトル",
  "sections": [
    { "heading": "セクション見出し", "content": "詳細な説明とアドバイス", "tips": ["具体的なヒント1", "ヒント2"] }
  ],
  "doList": ["すべきこと1", "すべきこと2"],
  "dontList": ["避けるべきこと1", "避けるべきこと2"],
  "openingLines": ["使える冒頭フレーズ1", "フレーズ2"],
  "closingStrategies": ["クロージング戦略1", "戦略2"],
  "customTips": ["ユーザーの傾向に合わせたカスタムヒント1", "ヒント2"]
}` },
      ], { maxTokens: 2048, temperature: 0.7 });

      let playbook: any = {};
      try {
        const match = result.content.match(/\{[\s\S]*\}/);
        if (match) playbook = JSON.parse(match[0]);
      } catch { playbook = { title: `${categoryLabels[input.category]}プレイブック`, sections: [], doList: [], dontList: [], openingLines: [], closingStrategies: [], customTips: [] }; }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_playbooks (userId, category, title, content, customTips, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(ctx.userId, input.category, playbook.title || `${categoryLabels[input.category]}プレイブック`, toJson(playbook), toJson(playbook.customTips || [])).run();

      return { id: Number(res.meta.last_row_id), ...playbook };
    }),
  listPlaybooks: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM matching_playbooks WHERE userId = ? OR isShared = 1 ORDER BY updatedAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      content: parseJson<any>(r.content),
      customTips: parseJson<any>(r.customTips),
    }));
  }),
  sharePlaybook: protectedProcedure
    .input(z.object({ playbookId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const pb = await ctx.env.DB.prepare(`SELECT * FROM matching_playbooks WHERE id = ? AND userId = ?`).bind(input.playbookId, ctx.userId).first<any>();
      if (!pb) throw new TRPCError({ code: "NOT_FOUND" });
      const shareCode = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, "0")).join("");
      await ctx.env.DB.prepare(`UPDATE matching_playbooks SET isShared = 1, shareCode = ?, updatedAt = datetime('now') WHERE id = ?`).bind(shareCode, input.playbookId).run();
      return { shareCode };
    }),
  deletePlaybook: protectedProcedure
    .input(z.object({ playbookId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM matching_playbooks WHERE id = ? AND userId = ?`).bind(input.playbookId, ctx.userId).run();
      return { deleted: true };
    }),

  // ============ Feature 22-2: マッチングシナリオ・プレイバック比較 ============
  compareScenarios: protectedProcedure
    .input(z.object({ sessionIds: z.array(z.number()).min(2).max(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);

      const sessionsData: any[] = [];
      for (const sid of input.sessionIds) {
        const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(sid).first<any>();
        if (!session) continue;
        const dialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(sid).all<any>();
        const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(sid).first<any>();
        const settings = parseJson<any>(session.settings) || {};
        sessionsData.push({
          sessionId: sid, theme: session.theme, settings,
          turnCount: (dialogues.results ?? []).length,
          dialogueSummary: (dialogues.results ?? []).map((d: any) => `[${d.speaker}] ${(d.content || "").slice(0, 100)}`).join("\n"),
          score: result?.compatibilityScore ?? 0,
          scoreBreakdown: parseJson<any>(result?.scoreBreakdown),
          recommendations: parseJson<any>(result?.recommendations),
        });
      }

      if (sessionsData.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "比較には2つ以上のセッションが必要です" });

      const comparisonText = sessionsData.map((s, i) => `セッション${i + 1} (ID:${s.sessionId}): テーマ「${s.theme}」, ターン数:${s.turnCount}, スコア:${s.score}\n設定: ${JSON.stringify(s.settings)}\n対話概要:\n${s.dialogueSummary}`).join("\n\n---\n\n");

      if (!llmConfig) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LLM設定がありません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはマッチング対話の比較分析の専門家です。複数のマッチングセッションを比較して詳細な分析を提供してください。" },
        { role: "user", content: `以下の${sessionsData.length}つのマッチングセッションを比較してください:\n\n${comparisonText}\n\nJSON形式で出力:\n{\n  "sessions": [\n    { "sessionId": 数値, "strengths": ["強み"], "weaknesses": ["弱み"], "uniquePoints": ["特徴的な点"] }\n  ],\n  "diffHighlights": [{ "aspect": "比較観点", "details": "詳細", "winner": セッションID }],\n  "bestSetting": { "recommendedTurns": 数値, "recommendedApproach": "推奨アプローチ", "reasoning": "理由" },\n  "overallInsight": "総合所見"\n}` },
      ], { maxTokens: 2048, temperature: 0.5 });

      let comparison: any = {};
      try { const match = result.content.match(/\{[\s\S]*\}/); if (match) comparison = JSON.parse(match[0]); } catch { comparison = { sessions: [], diffHighlights: [], bestSetting: {}, overallInsight: "" }; }

      const theme = sessionsData[0]?.theme || "比較";
      const res = await ctx.env.DB.prepare(
        `INSERT INTO scenario_comparisons (userId, theme, sessionIds, comparison, bestSettingAdvice, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(ctx.userId, theme, toJson(input.sessionIds), toJson(comparison), toJson(comparison.bestSetting)).run();

      return { id: Number(res.meta.last_row_id), sessionsData, comparison };
    }),
  listComparisons: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM scenario_comparisons WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      sessionIds: parseJson<number[]>(r.sessionIds),
      comparison: parseJson<any>(r.comparison),
      bestSettingAdvice: parseJson<any>(r.bestSettingAdvice),
    }));
  }),

  // ============ Feature 22-3: ユーザーダッシュボード・カスタムウィジェットAPI ============
  listWidgets: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM custom_widgets WHERE userId=? OR isShared=1 ORDER BY position ASC, createdAt ASC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, config: parseJson<any>(r.config) }));
  }),
  createWidget: protectedProcedure
    .input(z.object({
      widgetType: z.enum(["kpi", "chart", "query", "feed", "calendar", "notes", "links"]),
      title: z.string().min(1),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const maxPos = await ctx.env.DB.prepare(`SELECT MAX(position) as mp FROM custom_widgets WHERE userId=?`).bind(ctx.userId).first<any>();
      const position = (maxPos?.mp ?? -1) + 1;
      const res = await ctx.env.DB.prepare(
        `INSERT INTO custom_widgets (userId, widgetType, title, config, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(ctx.userId, input.widgetType, input.title, toJson(input.config || {}), position).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  updateWidget: protectedProcedure
    .input(z.object({ widgetId: z.number(), title: z.string().optional(), config: z.record(z.string(), z.unknown()).optional(), position: z.number().optional(), isVisible: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const sets: string[] = []; const binds: any[] = [];
      if (input.title !== undefined) { sets.push("title=?"); binds.push(input.title); }
      if (input.config !== undefined) { sets.push("config=?"); binds.push(toJson(input.config)); }
      if (input.position !== undefined) { sets.push("position=?"); binds.push(input.position); }
      if (input.isVisible !== undefined) { sets.push("isVisible=?"); binds.push(input.isVisible ? 1 : 0); }
      if (sets.length === 0) return { updated: false };
      sets.push("updatedAt=datetime('now')");
      binds.push(input.widgetId, ctx.userId);
      await ctx.env.DB.prepare(`UPDATE custom_widgets SET ${sets.join(",")} WHERE id=? AND userId=?`).bind(...binds).run();
      return { updated: true };
    }),
  deleteWidget: protectedProcedure
    .input(z.object({ widgetId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM custom_widgets WHERE id=? AND userId=?`).bind(input.widgetId, ctx.userId).run();
      return { deleted: true };
    }),
  shareWidget: protectedProcedure
    .input(z.object({ widgetId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const w = await ctx.env.DB.prepare(`SELECT * FROM custom_widgets WHERE id=? AND userId=?`).bind(input.widgetId, ctx.userId).first<any>();
      if (!w) throw new TRPCError({ code: "NOT_FOUND" });
      const shareCode = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, "0")).join("");
      await ctx.env.DB.prepare(`UPDATE custom_widgets SET isShared=1, shareCode=?, updatedAt=datetime('now') WHERE id=?`).bind(shareCode, input.widgetId).run();
      return { shareCode };
    }),

  // ============ Feature 23-1: マッチング自動議事録・アクションアイテム抽出 ============
  generateMinutes: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const dialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });
      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();

      const dialogueText = (dialogues.results ?? []).map((d: any) => `Turn ${d.turnNumber} [${d.speaker}]: ${d.content}`).join("\n");
      const scoreInfo = result ? `スコア: ${result.compatibilityScore}` : "";

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM未設定" });
      const llmResult = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネスミーティングの議事録作成の専門家です。マッチング対話を分析して構造化された議事録を作成してください。" },
        { role: "user", content: `テーマ: ${session.theme}\n${scoreInfo}\n\n対話:\n${dialogueText}\n\nJSON形式で出力:\n{\n  "summary": "対話の要約（2-3文）",\n  "decisions": ["決定事項1", "決定事項2"],\n  "actionItems": [\n    { "task": "タスク内容", "owner": "担当者", "priority": "high/medium/low", "dueDescription": "期限目安" }\n  ],\n  "nextAgenda": ["次回アジェンダ1", "次回アジェンダ2"],\n  "keyPoints": ["重要ポイント1", "ポイント2"],\n  "agreements": ["合意事項1"],\n  "openIssues": ["未解決課題1"]\n}` },
      ], { maxTokens: 2048, temperature: 0.5 });

      let minutes: any = {};
      try { const match = llmResult.content.match(/\{[\s\S]*\}/); if (match) minutes = JSON.parse(match[0]); } catch { minutes = { summary: "", decisions: [], actionItems: [], nextAgenda: [], keyPoints: [], agreements: [], openIssues: [] }; }

      // Generate Markdown
      const md = [
        `# 議事録: ${session.theme}`,
        `\n日時: ${session.createdAt}\n${scoreInfo}\n`,
        `## 概要\n${minutes.summary || ""}`,
        minutes.decisions?.length ? `\n## 決定事項\n${minutes.decisions.map((d: string) => `- ${d}`).join("\n")}` : "",
        minutes.actionItems?.length ? `\n## アクションアイテム\n${minutes.actionItems.map((a: any) => `- **[${a.priority || "medium"}]** ${a.task} (${a.owner || "未定"}) ${a.dueDescription ? `— ${a.dueDescription}` : ""}`).join("\n")}` : "",
        minutes.nextAgenda?.length ? `\n## 次回アジェンダ\n${minutes.nextAgenda.map((n: string) => `- ${n}`).join("\n")}` : "",
        minutes.keyPoints?.length ? `\n## 重要ポイント\n${minutes.keyPoints.map((k: string) => `- ${k}`).join("\n")}` : "",
        minutes.agreements?.length ? `\n## 合意事項\n${minutes.agreements.map((a: string) => `- ${a}`).join("\n")}` : "",
        minutes.openIssues?.length ? `\n## 未解決課題\n${minutes.openIssues.map((o: string) => `- ${o}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_minutes (sessionId, userId, summary, decisions, actionItems, nextAgenda, markdownContent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(input.sessionId, ctx.userId, minutes.summary || "", toJson(minutes.decisions), toJson(minutes.actionItems), toJson(minutes.nextAgenda), md).run();

      // Auto-create action items in matching_action_items for OutcomeTracker integration
      for (const ai of (minutes.actionItems || [])) {
        await ctx.env.DB.prepare(
          `INSERT INTO matching_action_items (sessionId, userId, title, description, status, priority, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))`
        ).bind(input.sessionId, ctx.userId, ai.task || "タスク", ai.dueDescription || "", ai.priority || "medium").run();
      }

      return { ...minutes, markdownContent: md };
    }),
  getMinutes: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM matching_minutes WHERE sessionId=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        decisions: parseJson<string[]>(row.decisions),
        actionItems: parseJson<any[]>(row.actionItems),
        nextAgenda: parseJson<string[]>(row.nextAgenda),
      };
    }),
  sendMinutesEmail: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.env.RESEND_API_KEY) return { sent: false, reason: "メール未設定" };
      const user = await ctx.env.DB.prepare(`SELECT id, name, email, role, plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.email) return { sent: false, reason: "メールアドレス未設定" };
      const minutes = await ctx.env.DB.prepare(`SELECT * FROM matching_minutes WHERE sessionId=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!minutes) throw new TRPCError({ code: "NOT_FOUND" });

      const fromEmail = ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.pages.dev";
      const decisions = parseJson<string[]>(minutes.decisions) || [];
      const actionItems = parseJson<any[]>(minutes.actionItems) || [];

      const emailHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#6366f1,#818cf8);padding:24px;border-radius:12px 12px 0 0;color:#fff;text-align:center">
  <h1 style="margin:0;font-size:22px">マッチング議事録</h1>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e5e7eb;border-top:0">
  <p style="color:#374151">${minutes.summary || ""}</p>
  ${decisions.length ? `<h3 style="color:#6366f1">決定事項</h3><ul>${decisions.map((d: string) => `<li>${d}</li>`).join("")}</ul>` : ""}
  ${actionItems.length ? `<h3 style="color:#6366f1">アクションアイテム</h3><ul>${actionItems.map((a: any) => `<li><strong>[${a.priority}]</strong> ${a.task}</li>`).join("")}</ul>` : ""}
</div></body></html>`;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: `分身AI <${fromEmail}>`, to: [user.email], subject: `【分身AI】マッチング議事録`, html: emailHtml }),
        });
        return { sent: res.ok };
      } catch { return { sent: false, reason: "送信失敗" }; }
    }),
  listMinutes: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT mm.*, ms.theme FROM matching_minutes mm JOIN matching_sessions ms ON ms.id = mm.sessionId WHERE mm.userId=? ORDER BY mm.createdAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r, decisions: parseJson<string[]>(r.decisions), actionItems: parseJson<any[]>(r.actionItems), nextAgenda: parseJson<string[]>(r.nextAgenda),
    }));
  }),

  // ============ ROI Dashboard ============
  getROIData: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    // Get all completed matchings with outcomes
    const matchings = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, ms.createdAt, mr.compatibilityScore,
              ms.settings, ms.initiatorUserId,
              (SELECT json_group_array(json_object('type', mo.outcomeType, 'amount', mo.amount))
               FROM matching_outcomes mo WHERE mo.sessionId = ms.id) as outcomes
       FROM matching_sessions ms
       LEFT JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE (ms.initiatorUserId = ? OR json_extract(ms.settings, '$.friendId') = ?)
       ORDER BY ms.createdAt DESC`
    ).bind(ctx.userId, ctx.userId).all<any>();

    // Friend-level ROI aggregation
    const friendROI: Record<number, { friendId: number; friendName: string; totalOutcomeAmount: number; matchCount: number; avgScore: number; scores: number[] }> = {};
    const monthlyData: Record<string, { month: string; matchCount: number; totalAmount: number; avgScore: number; scores: number[] }> = {};

    for (const m of matchings.results ?? []) {
      const settings = parseJson<any>(m.settings) || {};
      const friendId = m.initiatorUserId === ctx.userId ? settings.friendId : m.initiatorUserId;
      const outcomes = parseJson<any[]>(m.outcomes) || [];
      const totalAmount = outcomes.reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
      const month = (m.createdAt || '').substring(0, 7); // YYYY-MM
      const score = m.compatibilityScore || 0;

      if (friendId) {
        if (!friendROI[friendId]) {
          friendROI[friendId] = { friendId, friendName: '', totalOutcomeAmount: 0, matchCount: 0, avgScore: 0, scores: [] };
        }
        friendROI[friendId].totalOutcomeAmount += totalAmount;
        friendROI[friendId].matchCount++;
        if (score) friendROI[friendId].scores.push(score);
      }

      if (month) {
        if (!monthlyData[month]) {
          monthlyData[month] = { month, matchCount: 0, totalAmount: 0, avgScore: 0, scores: [] };
        }
        monthlyData[month].matchCount++;
        monthlyData[month].totalAmount += totalAmount;
        if (score) monthlyData[month].scores.push(score);
      }
    }

    // Resolve friend names
    for (const fid of Object.keys(friendROI)) {
      const u = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(Number(fid)).first<any>();
      friendROI[Number(fid)].friendName = u?.name || `User ${fid}`;
      const scores = friendROI[Number(fid)].scores;
      friendROI[Number(fid)].avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    }

    // Calculate monthly averages
    for (const key of Object.keys(monthlyData)) {
      const scores = monthlyData[key].scores;
      monthlyData[key].avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    }

    const friendRanking = Object.values(friendROI).sort((a, b) => b.totalOutcomeAmount - a.totalOutcomeAmount);
    const monthly = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));

    const totalMatchings = (matchings.results ?? []).length;
    const totalOutcome = friendRanking.reduce((s, f) => s + f.totalOutcomeAmount, 0);

    return { totalMatchings, totalOutcome, friendRanking, monthly };
  }),
  getROIGoals: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM roi_goals WHERE userId=? ORDER BY createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, milestones: parseJson<any[]>(r.milestones) || [] }));
  }),
  setROIGoal: protectedProcedure
    .input(z.object({
      targetAmount: z.number(),
      targetMatchCount: z.number(),
      period: z.enum(["monthly", "quarterly", "yearly"]),
      label: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO roi_goals (userId, targetAmount, targetMatchCount, period, label) VALUES (?, ?, ?, ?, ?)`
      ).bind(ctx.userId, input.targetAmount, input.targetMatchCount, input.period, input.label || null).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  deleteROIGoal: protectedProcedure
    .input(z.object({ goalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM roi_goals WHERE id=? AND userId=?`).bind(input.goalId, ctx.userId).run();
      return { deleted: true };
    }),
  getROISuggestions: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    // Gather ROI data
    const matchings = await ctx.env.DB.prepare(
      `SELECT ms.theme, mr.compatibilityScore, ms.createdAt,
              (SELECT SUM(mo.amount) FROM matching_outcomes mo WHERE mo.sessionId = ms.id) as outcomeAmount
       FROM matching_sessions ms
       LEFT JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId = ? ORDER BY ms.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    const goals = await ctx.env.DB.prepare(`SELECT * FROM roi_goals WHERE userId=? ORDER BY createdAt DESC LIMIT 3`).bind(ctx.userId).all<any>();

    const prompt = `以下のマッチングROIデータを分析し、ROI改善のための具体的な提案を3-5件JSON配列で返してください。

マッチング履歴:
${JSON.stringify(matchings.results ?? [])}

目標:
${JSON.stringify(goals.results ?? [])}

JSON形式: [{"title":"提案タイトル","description":"具体的な説明","impact":"high|medium|low","category":"frequency|quality|targeting|followup"}]`;

    const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let suggestions: any[] = [];
    try {
      const parsed = JSON.parse(result.content);
      suggestions = Array.isArray(parsed) ? parsed : parsed.suggestions || [];
    } catch {
      suggestions = [{ title: "データ分析中", description: "マッチングデータを増やして再度お試しください", impact: "medium", category: "frequency" }];
    }
    return { suggestions };
  }),

  // ============ Calendar View ============
  getCalendarEvents: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const startDate = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
      const endMonth = input.month === 12 ? 1 : input.month + 1;
      const endYear = input.month === 12 ? input.year + 1 : input.year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

      // Past matchings
      const matchings = await ctx.env.DB.prepare(
        `SELECT ms.id, ms.theme, ms.status, ms.createdAt, mr.compatibilityScore
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         WHERE (ms.initiatorUserId = ? OR json_extract(ms.settings, '$.friendId') = ?)
         AND ms.createdAt >= ? AND ms.createdAt < ?
         ORDER BY ms.createdAt ASC`
      ).bind(ctx.userId, ctx.userId, startDate, endDate).all<any>();

      // Scheduled events
      const scheduled = await ctx.env.DB.prepare(
        `SELECT * FROM matching_calendar_events WHERE userId=? AND scheduledAt >= ? AND scheduledAt < ? ORDER BY scheduledAt ASC`
      ).bind(ctx.userId, startDate, endDate).all<any>();

      return {
        matchings: matchings.results ?? [],
        scheduled: (scheduled.results ?? []).map((r: any) => ({ ...r, settings: parseJson<any>(r.settings) })),
      };
    }),
  createCalendarEvent: protectedProcedure
    .input(z.object({
      title: z.string(),
      friendId: z.number().optional(),
      theme: z.string().optional(),
      scheduledAt: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const settings = toJson({ friendId: input.friendId, theme: input.theme });
      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_calendar_events (userId, title, scheduledAt, notes, settings) VALUES (?, ?, ?, ?, ?)`
      ).bind(ctx.userId, input.title, input.scheduledAt, input.notes || null, settings).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  updateCalendarEvent: protectedProcedure
    .input(z.object({
      eventId: z.number(),
      title: z.string().optional(),
      scheduledAt: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const sets: string[] = [];
      const vals: any[] = [];
      if (input.title) { sets.push("title=?"); vals.push(input.title); }
      if (input.scheduledAt) { sets.push("scheduledAt=?"); vals.push(input.scheduledAt); }
      if (input.notes !== undefined) { sets.push("notes=?"); vals.push(input.notes); }
      if (input.status) { sets.push("status=?"); vals.push(input.status); }
      if (sets.length === 0) return { updated: false };
      sets.push("updatedAt=datetime('now')");
      await ctx.env.DB.prepare(
        `UPDATE matching_calendar_events SET ${sets.join(", ")} WHERE id=? AND userId=?`
      ).bind(...vals, input.eventId, ctx.userId).run();
      return { updated: true };
    }),
  deleteCalendarEvent: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM matching_calendar_events WHERE id=? AND userId=?`).bind(input.eventId, ctx.userId).run();
      return { deleted: true };
    }),
  setReminder: protectedProcedure
    .input(z.object({
      eventId: z.number(),
      reminderAt: z.string(),
      channel: z.enum(["app", "email", "line", "slack"]).default("app"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_reminders (userId, eventId, reminderAt, channel) VALUES (?, ?, ?, ?)`
      ).bind(ctx.userId, input.eventId, input.reminderAt, input.channel).run();
      return { id: Number(res.meta.last_row_id) };
    }),
  listReminders: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT mr.*, mce.title as eventTitle, mce.scheduledAt
       FROM matching_reminders mr
       JOIN matching_calendar_events mce ON mce.id = mr.eventId
       WHERE mr.userId=? AND mr.isSent=0
       ORDER BY mr.reminderAt ASC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  deleteReminder: protectedProcedure
    .input(z.object({ reminderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM matching_reminders WHERE id=? AND userId=?`).bind(input.reminderId, ctx.userId).run();
      return { deleted: true };
    }),

  // ============ Sandbox Simulation ============
  sandboxCreate: protectedProcedure
    .input(z.object({
      theme: z.string().min(1),
      opponentPersonality: z.string().optional(),
      opponentDescription: z.string().optional(),
      turnCount: z.number().min(1).max(10).default(5),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const myPrompt = `あなたは${twin.name}です。${twin.personality || ''}。${twin.description || ''}。ビジネスマッチングの対話で自分の立場を主張してください。`;
      const oppPrompt = `あなたは仮想の対話相手です。${input.opponentPersonality || '積極的なビジネスパーソン'}。${input.opponentDescription || '幅広い業界経験を持つ'}。ビジネスマッチングの対話で自分の立場を主張してください。`;

      const dialogues: { turn: number; speaker: string; content: string }[] = [];
      const history: { role: "user" | "assistant"; content: string }[] = [];

      for (let i = 0; i < input.turnCount; i++) {
        // My twin speaks
        const myMessages = [
          { role: "system" as const, content: myPrompt },
          ...history.map(h => ({ ...h, role: h.role as "user" | "assistant" })),
          { role: "user" as const, content: i === 0 ? `テーマ「${input.theme}」について対話を始めてください。` : `相手の発言に応答してください。` },
        ];
        const myResp = await invokeLLM(llmConfig, myMessages, { maxTokens: 300 });
        dialogues.push({ turn: i * 2 + 1, speaker: twin.name, content: myResp.content });
        history.push({ role: "assistant", content: myResp.content });

        // Opponent speaks
        const oppMessages = [
          { role: "system" as const, content: oppPrompt },
          ...history.map(h => ({ ...h, role: (h.role === "assistant" ? "user" : "assistant") as "user" | "assistant" })),
          { role: "user" as const, content: "相手の発言に応答してください。" },
        ];
        const oppResp = await invokeLLM(llmConfig, oppMessages, { maxTokens: 300 });
        dialogues.push({ turn: i * 2 + 2, speaker: "仮想相手", content: oppResp.content });
        history.push({ role: "user", content: oppResp.content });
      }

      // Analysis
      const analysisPrompt = `以下のビジネス対話を分析してJSON形式で返してください。
対話:
${dialogues.map(d => `[${d.speaker}] ${d.content}`).join('\n')}

JSON形式:
{"score":0-100,"strengths":["強み1","強み2"],"weaknesses":["弱み1"],"recommendedSettings":{"personality":"推奨人格設定","tips":["ヒント1"]},"summary":"総評"}`;

      const analysisResp = await invokeLLM(llmConfig, [{ role: "user", content: analysisPrompt }]);
      let result: any = {};
      try { result = JSON.parse(analysisResp.content); } catch { result = { score: 50, summary: "分析結果を取得できませんでした", strengths: [], weaknesses: [], recommendedSettings: {} }; }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO sandbox_sessions (userId, twinId, theme, opponentPersonality, opponentDescription, turnCount, dialogues, result, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, twin.id, input.theme, input.opponentPersonality || null, input.opponentDescription || null, input.turnCount, toJson(dialogues), toJson(result), toJson({ twinPersonality: twin.personality })).run();

      return { id: Number(res.meta.last_row_id), dialogues, result };
    }),
  sandboxList: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, theme, opponentPersonality, turnCount, createdAt, result FROM sandbox_sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, result: parseJson<any>(r.result) }));
  }),
  sandboxGet: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM sandbox_sessions WHERE id=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...row, dialogues: parseJson<any[]>(row.dialogues), result: parseJson<any>(row.result), settings: parseJson<any>(row.settings) };
    }),
  sandboxApplySettings: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT result FROM sandbox_sessions WHERE id=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const result = parseJson<any>(session.result) || {};
      const recommended = result.recommendedSettings || {};
      if (recommended.personality) {
        await ctx.env.DB.prepare(
          `UPDATE digital_twins SET personality=?, updatedAt=datetime('now') WHERE userId=?`
        ).bind(recommended.personality, ctx.userId).run();
      }
      return { applied: true, personality: recommended.personality };
    }),


  // ============ Replay Commentary AI ============
  generateCommentaryForReplay: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT turnNumber, speaker, content FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber ASC`
      ).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const dialogueText = (dialogues.results ?? []).map((d: any) => `ターン${d.turnNumber} [${d.speaker}]: ${d.content}`).join('\n\n');

      const prompt = `以下のビジネスマッチング対話の各ターンに対して、AIコメンタリー（解説）を生成してください。

${dialogueText}

各ターンについて以下を分析してJSON配列で返してください:
[{"turn":1,"technique":"使用されている交渉テクニック名","pattern":"戦略パターン（例：協調型/競争型/探索型）","improvement":"改善ポイント","insight":"注目すべきポイント","score":0-10}]`;

      const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let commentaries: any[] = [];
      try { const p = JSON.parse(result.content); commentaries = Array.isArray(p) ? p : p.commentaries || []; } catch { commentaries = (dialogues.results ?? []).map((d: any) => ({ turn: d.turnNumber, technique: "分析中", pattern: "不明", improvement: "", insight: "", score: 5 })); }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO replay_commentaries (sessionId, userId, commentaries) VALUES (?, ?, ?)`
      ).bind(input.sessionId, ctx.userId, toJson(commentaries)).run();

      return { commentaries };
    }),
  getReplayCommentary: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM replay_commentaries WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, commentaries: parseJson<any[]>(row.commentaries) };
    }),
  shareReplayCommentary: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const code = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      await ctx.env.DB.prepare(
        `UPDATE replay_commentaries SET shareCode=? WHERE sessionId=? AND userId=?`
      ).bind(code, input.sessionId, ctx.userId).run();
      return { shareCode: code };
    }),


  // ============ Matching Storyboard ============
  generateStoryboard: protectedProcedure
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
        `SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`
      ).bind(input.sessionId).first<any>();

      const settings = parseJson<any>(session.settings) || {};

      const prompt = `以下のビジネスマッチング対話をストーリー形式に変換してください。

テーマ: ${session.theme}
対話:
${(dialogues.results ?? []).map((d: any) => `${d.speaker}: ${d.content}`).join('\n')}

結果スコア: ${result?.compatibilityScore || 'N/A'}

起承転結の4幕構成で、キーモーメント（転機、共感、対立、合意）を抽出し、登場人物の心理描写を含めてください。

JSON形式で返してください:
{
  "title": "ストーリータイトル",
  "story": {
    "introduction": "起: 出会いと背景",
    "development": "承: 展開と深まり",
    "twist": "転: 転機・発見",
    "conclusion": "結: 合意と展望"
  },
  "keyMoments": [{"turnNumber": 1, "type": "empathy|conflict|agreement|discovery", "description": "説明", "quote": "引用"}],
  "characters": [{"name": "名前", "role": "役割", "motivation": "動機", "psychologicalArc": "心理的変化"}]
}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let parsed: any = {};
      try { parsed = JSON.parse(resp.content); } catch {
        parsed = {
          title: `${session.theme} - ストーリー`,
          story: { introduction: "対話が始まりました。", development: "議論が深まりました。", twist: "新しい発見がありました。", conclusion: "合意に至りました。" },
          keyMoments: [],
          characters: [],
        };
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO matching_storyboards (sessionId, userId, title, story, keyMoments, characters, structure)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        input.sessionId, ctx.userId,
        parsed.title || `${session.theme} - ストーリー`,
        toJson(parsed.story),
        toJson(parsed.keyMoments || []),
        toJson(parsed.characters || []),
        toJson({ theme: session.theme, score: result?.compatibilityScore })
      ).run();

      return { title: parsed.title, story: parsed.story, keyMoments: parsed.keyMoments, characters: parsed.characters };
    }),
  getStoryboard: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM matching_storyboards WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        story: parseJson<any>(row.story),
        keyMoments: parseJson<any[]>(row.keyMoments),
        characters: parseJson<any[]>(row.characters),
        structure: parseJson<any>(row.structure),
      };
    }),
  shareStoryboard: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const code = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      await ctx.env.DB.prepare(
        `UPDATE matching_storyboards SET shareCode=? WHERE sessionId=? AND userId=?`
      ).bind(code, input.sessionId, ctx.userId).run();
      return { shareCode: code };
    }),
  listStoryboardCollections: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM storyboard_collections WHERE userId=? ORDER BY createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, storyIds: parseJson<number[]>(r.storyIds) }));
  }),
  createStoryboardCollection: protectedProcedure
    .input(z.object({ name: z.string(), description: z.string().optional(), storyIds: z.array(z.number()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `INSERT INTO storyboard_collections (userId, name, description, storyIds) VALUES (?, ?, ?, ?)`
      ).bind(ctx.userId, input.name, input.description || null, toJson(input.storyIds || [])).run();
      return { created: true };
    }),

  // ============ Matching AI Facilitator ============
  getFacilitatorSuggestion: protectedProcedure
    .input(z.object({ sessionId: z.number(), turnNumber: z.number(), recentDialogue: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const prompt = `あなたはビジネスマッチング対話のAIファシリテーターです。
以下の対話を分析し、介入が必要かどうか判断してください。

テーマ: ${session.theme}
現在のターン: ${input.turnNumber}
直近の対話:
${input.recentDialogue}

以下のパターンを検出してください:
1. 沈黙/停滞 — 同じ話題の繰り返し
2. 堂々巡り — 結論が出ない議論
3. 対立 — 意見の衝突が激化
4. 話題枯渇 — 新しい観点が必要

JSON形式で返してください:
{
  "needsIntervention": true/false,
  "interventionType": "topic_change|deep_question|consensus|encouragement|none",
  "suggestion": "具体的な介入提案文",
  "reason": "介入理由",
  "confidence": 0.0-1.0
}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let parsed: any = {};
      try { parsed = JSON.parse(resp.content); } catch {
        parsed = { needsIntervention: false, interventionType: "none", suggestion: "", reason: "分析不能", confidence: 0 };
      }

      if (parsed.needsIntervention) {
        await ctx.env.DB.prepare(
          `INSERT INTO facilitator_interventions (sessionId, turnNumber, interventionType, suggestion) VALUES (?, ?, ?, ?)`
        ).bind(input.sessionId, input.turnNumber, parsed.interventionType, parsed.suggestion).run();
      }

      return parsed;
    }),
  acceptFacilitatorIntervention: protectedProcedure
    .input(z.object({ interventionId: z.number(), accepted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE facilitator_interventions SET accepted=? WHERE id=?`
      ).bind(input.accepted ? 1 : 0, input.interventionId).run();
      return { updated: true };
    }),
  getFacilitatorHistory: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM facilitator_interventions WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      return rows.results ?? [];
    }),
  getFacilitatorEffectiveness: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const stats = await ctx.env.DB.prepare(
      `SELECT 
        COUNT(*) as totalInterventions,
        SUM(CASE WHEN accepted=1 THEN 1 ELSE 0 END) as acceptedCount,
        AVG(effectScore) as avgEffectScore
       FROM facilitator_interventions fi
       JOIN matching_sessions ms ON ms.id = fi.sessionId
       WHERE ms.initiatorUserId=?`
    ).bind(ctx.userId).first<any>();

    const byType = await ctx.env.DB.prepare(
      `SELECT interventionType, COUNT(*) as count, SUM(CASE WHEN accepted=1 THEN 1 ELSE 0 END) as accepted
       FROM facilitator_interventions fi
       JOIN matching_sessions ms ON ms.id = fi.sessionId
       WHERE ms.initiatorUserId=?
       GROUP BY interventionType`
    ).bind(ctx.userId).all<any>();

    return {
      total: stats?.totalInterventions || 0,
      accepted: stats?.acceptedCount || 0,
      avgEffectScore: stats?.avgEffectScore || 0,
      byType: byType.results ?? [],
    };
  }),


  // ============ Session Tags & Filter ============
  addSessionTag: protectedProcedure
    .input(z.object({ sessionId: z.number(), tag: z.string(), category: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `INSERT OR IGNORE INTO session_tags (sessionId, userId, tag, category) VALUES (?, ?, ?, ?)`
      ).bind(input.sessionId, ctx.userId, input.tag, input.category || null).run();
      return { added: true };
    }),
  removeSessionTag: protectedProcedure
    .input(z.object({ sessionId: z.number(), tag: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM session_tags WHERE sessionId=? AND userId=? AND tag=?`
      ).bind(input.sessionId, ctx.userId, input.tag).run();
      return { removed: true };
    }),
  getSessionTags: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM session_tags WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).all<any>();
      return rows.results ?? [];
    }),
  getAllTags: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT tag, category, COUNT(*) as count FROM session_tags WHERE userId=? GROUP BY tag ORDER BY count DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  getTagAnalytics: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const analytics = await ctx.env.DB.prepare(
      `SELECT st.tag, st.category,
              COUNT(DISTINCT st.sessionId) as sessionCount,
              AVG(mr.compatibilityScore) as avgScore,
              MAX(mr.compatibilityScore) as maxScore,
              MIN(mr.compatibilityScore) as minScore
       FROM session_tags st
       JOIN matching_results mr ON mr.sessionId = st.sessionId
       WHERE st.userId=?
       GROUP BY st.tag
       ORDER BY avgScore DESC`
    ).bind(ctx.userId).all<any>();
    return analytics.results ?? [];
  }),
  filterSessionsByTags: protectedProcedure
    .input(z.object({
      tags: z.array(z.string()),
      operator: z.enum(["AND", "OR"]).default("OR"),
      minScore: z.number().optional(),
      maxScore: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let query: string;
      let binds: any[];

      if (input.operator === "AND") {
        const placeholders = input.tags.map(() => '?').join(', ');
        query = `SELECT ms.id, ms.theme, ms.status, ms.createdAt, mr.compatibilityScore,
                        GROUP_CONCAT(st.tag) as tags
                 FROM matching_sessions ms
                 JOIN session_tags st ON st.sessionId = ms.id AND st.userId=?
                 LEFT JOIN matching_results mr ON mr.sessionId = ms.id
                 WHERE st.tag IN (${placeholders})
                 AND ms.initiatorUserId=?
                 GROUP BY ms.id
                 HAVING COUNT(DISTINCT st.tag) = ?
                 ORDER BY ms.createdAt DESC`;
        binds = [ctx.userId, ...input.tags, ctx.userId, input.tags.length];
      } else {
        const placeholders = input.tags.map(() => '?').join(', ');
        query = `SELECT ms.id, ms.theme, ms.status, ms.createdAt, mr.compatibilityScore,
                        GROUP_CONCAT(DISTINCT st.tag) as tags
                 FROM matching_sessions ms
                 JOIN session_tags st ON st.sessionId = ms.id AND st.userId=?
                 LEFT JOIN matching_results mr ON mr.sessionId = ms.id
                 WHERE st.tag IN (${placeholders})
                 AND ms.initiatorUserId=?
                 GROUP BY ms.id
                 ORDER BY ms.createdAt DESC`;
        binds = [ctx.userId, ...input.tags, ctx.userId];
      }

      const rows = await ctx.env.DB.prepare(query).bind(...binds).all<any>();
      let results = rows.results ?? [];

      if (input.minScore !== undefined) {
        results = results.filter((r: any) => r.compatibilityScore >= input.minScore!);
      }
      if (input.maxScore !== undefined) {
        results = results.filter((r: any) => r.compatibilityScore <= input.maxScore!);
      }

      return results.map((r: any) => ({ ...r, tags: r.tags ? r.tags.split(',') : [] }));
    }),


  // ============ Theme Recommendation Engine ============
  recommendThemes: protectedProcedure
    .input(z.object({ friendId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      // Gather context
      const userProfile = await ctx.env.DB.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      let friendProfile: any = null;
      let friendTwin: any = null;
      if (input.friendId) {
        friendProfile = await ctx.env.DB.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(input.friendId).first<any>();
        friendTwin = await ctx.env.DB.prepare(`SELECT name, personality, description, tags FROM digital_twins WHERE userId=?`).bind(input.friendId).first<any>();
      }

      // Past themes and scores
      const pastThemes = await ctx.env.DB.prepare(
        `SELECT ms.theme, mr.compatibilityScore FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId=ms.id
         WHERE ms.initiatorUserId=?
         ORDER BY ms.createdAt DESC LIMIT 20`
      ).bind(ctx.userId).all<any>();

      const prompt = `ビジネスマッチングの最適テーマを5件提案してください。

ユーザープロフィール:
- 業界: ${userProfile?.industry || '未設定'}
- 会社: ${userProfile?.company || '未設定'}
- 役職: ${userProfile?.position || '未設定'}
- スキル: ${userProfile?.skills || '未設定'}
${input.friendId ? `
友達プロフィール:
- 業界: ${friendProfile?.industry || '未設定'}
- 会社: ${friendProfile?.company || '未設定'}
- ツイン: ${friendTwin?.name || '未設定'} (${friendTwin?.personality || ''})
` : ''}
過去のテーマ実績:
${(pastThemes.results ?? []).map((t: any) => `- ${t.theme}: ${t.compatibilityScore || 'N/A'}点`).join('\n')}

各テーマに期待スコア(0-100)、難易度(1-5)、新規性スコア(1-5)を付けてください。
過去に高スコアだったテーマの発展形や、未探索の有望エリアを含めてください。

JSON配列で返してください:
[{"theme":"テーマ名","expectedScore":数値,"difficulty":1-5,"novelty":1-5,"reason":"推薦理由","category":"業界トレンド|スキル活用|弱点克服|新規開拓|深掘り"}]`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let recommendations: any[] = [];
      try {
        const p = JSON.parse(resp.content);
        recommendations = Array.isArray(p) ? p : p.recommendations || [];
      } catch {
        recommendations = [{ theme: "ビジネス戦略について", expectedScore: 70, difficulty: 3, novelty: 3, reason: "汎用的なテーマ", category: "新規開拓" }];
      }

      await ctx.env.DB.prepare(
        `INSERT INTO theme_recommendations (userId, friendId, recommendations) VALUES (?, ?, ?)`
      ).bind(ctx.userId, input.friendId || null, toJson(recommendations)).run();

      return { recommendations };
    }),
  getThemeRecommendations: protectedProcedure
    .input(z.object({ friendId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let query = `SELECT * FROM theme_recommendations WHERE userId=?`;
      const binds: any[] = [ctx.userId];
      if (input.friendId) {
        query += ` AND friendId=?`;
        binds.push(input.friendId);
      }
      query += ` ORDER BY createdAt DESC LIMIT 1`;
      const row = await ctx.env.DB.prepare(query).bind(...binds).first<any>();
      if (!row) return null;
      return { ...row, recommendations: parseJson<any[]>(row.recommendations) };
    }),
  getThemeRankings: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    // Build rankings from actual matching data
    const rankings = await ctx.env.DB.prepare(
      `SELECT ms.theme, COUNT(*) as sessionCount,
              AVG(mr.compatibilityScore) as avgScore, MAX(mr.compatibilityScore) as maxScore
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId=ms.id
       WHERE ms.initiatorUserId=?
       GROUP BY ms.theme
       ORDER BY avgScore DESC`
    ).bind(ctx.userId).all<any>();

    return (rankings.results ?? []).map((r: any) => ({
      theme: r.theme,
      sessionCount: r.sessionCount,
      avgScore: Math.round((r.avgScore || 0) * 10) / 10,
      maxScore: r.maxScore || 0,
    }));
  }),
  startFromRecommendation: protectedProcedure
    .input(z.object({ theme: z.string(), friendId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Create a matching session with the recommended theme
      const settings = toJson({ friendId: input.friendId, source: 'theme_recommendation' });
      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_sessions (initiatorUserId, theme, status, settings, createdAt)
         VALUES (?, ?, 'pending', ?, datetime('now'))`
      ).bind(ctx.userId, input.theme, settings).run();
      return { sessionId: res.meta?.last_row_id };
    }),

  // ============ Success Pattern Library ============
  extractSuccessPatterns: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    // Get high-score matchings (80+)
    const highScoreSessions = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, mr.compatibilityScore
       FROM matching_sessions ms
       JOIN matching_results mr ON mr.sessionId=ms.id
       WHERE ms.initiatorUserId=? AND mr.compatibilityScore >= 80
       ORDER BY mr.compatibilityScore DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();

    if (!highScoreSessions.results?.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "スコア80以上のマッチングがありません" });
    }

    // Get dialogues for top sessions
    const sessionDialogues: any[] = [];
    for (const s of (highScoreSessions.results ?? []).slice(0, 5)) {
      const dialogues = await ctx.env.DB.prepare(
        `SELECT speaker, content, turnNumber FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(s.id).all<any>();
      sessionDialogues.push({
        sessionId: s.id, theme: s.theme, score: s.compatibilityScore,
        dialogue: (dialogues.results ?? []).map((d: any) => `${d.speaker}: ${d.content}`).join('\n'),
      });
    }

    const prompt = `以下の高スコア（80点以上）ビジネスマッチング対話から成功パターンを抽出してください。

${sessionDialogues.map((s: any) => `【${s.theme}】スコア: ${s.score}\n${s.dialogue}`).join('\n\n---\n\n')}

以下の3カテゴリで共通パターンを抽出してください:
1. opening_phrase — 効果的な開始フレーズ
2. question_technique — 質問テクニック
3. consensus_method — 合意形成手法

JSON配列で返してください:
[{
  "patternType": "opening_phrase|question_technique|consensus_method",
  "title": "パターン名",
  "description": "詳細説明",
  "examples": ["具体例1", "具体例2"],
  "effectiveness": 0.0-1.0（推定効果）,
  "tags": ["タグ"]
}]`;

    const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let patterns: any[] = [];
    try {
      const p = JSON.parse(resp.content);
      patterns = Array.isArray(p) ? p : p.patterns || [];
    } catch {
      patterns = [{ patternType: "opening_phrase", title: "共感から始める", description: "相手の状況への共感を示す開始", examples: ["素晴らしいご経歴ですね"], effectiveness: 0.7, tags: ["共感"] }];
    }

    const sourceIds = (highScoreSessions.results ?? []).map((s: any) => s.id);
    for (const pat of patterns) {
      await ctx.env.DB.prepare(
        `INSERT INTO success_patterns (userId, patternType, title, description, examples, sourceSessionIds, effectiveness, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ctx.userId, pat.patternType, pat.title, pat.description,
        toJson(pat.examples || []), toJson(sourceIds),
        pat.effectiveness || 0.5, toJson(pat.tags || [])
      ).run();
    }

    return { patterns, sourceCount: sourceIds.length };
  }),
  listSuccessPatterns: protectedProcedure
    .input(z.object({ patternType: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let query = `SELECT * FROM success_patterns WHERE userId=?`;
      const binds: any[] = [ctx.userId];
      if (input.patternType) {
        query += ` AND patternType=?`;
        binds.push(input.patternType);
      }
      query += ` ORDER BY effectiveness DESC`;
      const rows = await ctx.env.DB.prepare(query).bind(...binds).all<any>();
      return (rows.results ?? []).map((r: any) => ({
        ...r,
        examples: parseJson<string[]>(r.examples),
        sourceSessionIds: parseJson<number[]>(r.sourceSessionIds),
        tags: parseJson<string[]>(r.tags),
      }));
    }),
  getPreMatchSuggestions: protectedProcedure
    .input(z.object({ theme: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      // Get user's patterns
      const patterns = await ctx.env.DB.prepare(
        `SELECT patternType, title, description, examples FROM success_patterns WHERE userId=? ORDER BY effectiveness DESC LIMIT 10`
      ).bind(ctx.userId).all<any>();

      if (!patterns.results?.length) return { suggestions: [] };

      const prompt = `次のマッチングテーマ「${input.theme}」に対して、以下の成功パターンから適用すべきものを選び、具体的なアドバイスを生成してください。

成功パターン:
${(patterns.results ?? []).map((p: any) => `[${p.patternType}] ${p.title}: ${p.description}`).join('\n')}

JSON配列で返してください:
[{"patternTitle":"パターン名","advice":"テーマに合わせた具体的アドバイス","priority":"high|medium|low","timing":"opening|middle|closing"}]`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let suggestions: any[] = [];
      try { const p = JSON.parse(resp.content); suggestions = Array.isArray(p) ? p : p.suggestions || []; } catch { suggestions = []; }
      return { suggestions };
    }),
  deleteSuccessPattern: protectedProcedure
    .input(z.object({ patternId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM success_patterns WHERE id=? AND userId=?`).bind(input.patternId, ctx.userId).run();
      return { deleted: true };
    }),

  // ============ Interactive Negotiation Scenario ============
  createInteractiveScenario: protectedProcedure
    .input(z.object({ theme: z.string(), friendId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      // Get opponent info
      let opponentName = "交渉相手";
      let opponentPersonality = "プロフェッショナルなビジネスパーソン";
      if (input.friendId) {
        const friendTwin = await ctx.env.DB.prepare(`SELECT name, personality FROM digital_twins WHERE userId=?`).bind(input.friendId).first<any>();
        if (friendTwin) { opponentName = friendTwin.name || opponentName; opponentPersonality = friendTwin.personality || opponentPersonality; }
      }

      // Generate opening
      const openingPrompt = `あなたは「${opponentName}」（${opponentPersonality}）です。テーマ「${input.theme}」についてビジネス交渉の冒頭発言をしてください。簡潔に2-3文で。`;
      const openingResp = await invokeLLM(llmConfig, [{ role: "user", content: openingPrompt }]);

      const dialogue = [{ turnNumber: 1, speaker: opponentName, content: openingResp.content, strategy: null as string | null }];

      const res = await ctx.env.DB.prepare(
        `INSERT INTO interactive_scenarios (userId, friendId, theme, dialogue, choices, status)
         VALUES (?, ?, ?, ?, '[]', 'active')`
      ).bind(ctx.userId, input.friendId || null, input.theme, toJson(dialogue)).run();

      return { id: res.meta?.last_row_id, dialogue, opponentName };
    }),
  respondInteractiveScenario: protectedProcedure
    .input(z.object({ scenarioId: z.number(), strategy: z.enum(["aggressive", "defensive", "compromise", "propose"]) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const scenario = await ctx.env.DB.prepare(
        `SELECT * FROM interactive_scenarios WHERE id=? AND userId=?`
      ).bind(input.scenarioId, ctx.userId).first<any>();
      if (!scenario) throw new TRPCError({ code: "NOT_FOUND" });
      if (scenario.status !== 'active') throw new TRPCError({ code: "BAD_REQUEST", message: "シナリオは終了しています" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      const dialogue = parseJson<any[]>(scenario.dialogue) || [];
      const choices = parseJson<any[]>(scenario.choices) || [];

      const strategyLabels: Record<string, string> = {
        aggressive: "攻めの姿勢で、自分の提案を強く推す",
        defensive: "守りの姿勢で、リスクを慎重に検討する",
        compromise: "妥協点を探り、双方にメリットのある提案をする",
        propose: "新しいアイデアや創造的な解決策を提案する",
      };

      const dialogueText = dialogue.map((d: any) => `${d.speaker}: ${d.content}`).join('\n');

      // Twin responds with chosen strategy
      const twinPrompt = `あなたは「${twin?.name || 'ツイン'}」（${twin?.personality || 'ビジネスパーソン'}）です。
テーマ「${scenario.theme}」について交渉中です。

これまでの対話:
${dialogueText}

戦略指示: ${strategyLabels[input.strategy]}

この戦略に従って応答してください。簡潔に2-3文で。`;
      const twinResp = await invokeLLM(llmConfig, [{ role: "user", content: twinPrompt }]);
      dialogue.push({ turnNumber: dialogue.length + 1, speaker: twin?.name || 'ツイン', content: twinResp.content, strategy: input.strategy });
      choices.push({ turnNumber: dialogue.length, strategy: input.strategy });

      // Opponent responds
      let opponentName = "交渉相手";
      if (scenario.friendId) {
        const ft = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE userId=?`).bind(scenario.friendId).first<any>();
        if (ft) opponentName = ft.name || opponentName;
      }
      const oppPrompt = `あなたは「${opponentName}」です。テーマ「${scenario.theme}」について交渉中です。\n\nこれまでの対話:\n${dialogueText}\n${twin?.name || 'ツイン'}: ${twinResp.content}\n\n自然に応答してください。簡潔に2-3文で。`;
      const oppResp = await invokeLLM(llmConfig, [{ role: "user", content: oppPrompt }]);
      dialogue.push({ turnNumber: dialogue.length + 1, speaker: opponentName, content: oppResp.content, strategy: null });

      // Check if scenario should end (after 5 exchanges = 10 turns)
      const isComplete = dialogue.length >= 10;
      const newStatus = isComplete ? 'completed' : 'active';

      await ctx.env.DB.prepare(
        `UPDATE interactive_scenarios SET dialogue=?, choices=?, status=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(toJson(dialogue), toJson(choices), newStatus, input.scenarioId).run();

      return { dialogue, choices, isComplete };
    }),
  analyzeInteractiveScenario: protectedProcedure
    .input(z.object({ scenarioId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const scenario = await ctx.env.DB.prepare(
        `SELECT * FROM interactive_scenarios WHERE id=? AND userId=?`
      ).bind(input.scenarioId, ctx.userId).first<any>();
      if (!scenario) throw new TRPCError({ code: "NOT_FOUND" });

      const dialogue = parseJson<any[]>(scenario.dialogue) || [];
      const choices = parseJson<any[]>(scenario.choices) || [];

      const prompt = `以下の交渉シナリオを分析してください。

テーマ: ${scenario.theme}
対話:
${dialogue.map((d: any) => `[${d.strategy ? '戦略:' + d.strategy : '相手'}] ${d.speaker}: ${d.content}`).join('\n')}

ユーザーの選択:
${choices.map((c: any) => `ターン${c.turnNumber}: ${c.strategy}`).join(', ')}

JSON形式で返してください:
{
  "overallScore": 0-100,
  "strategyEffectiveness": {"aggressive": 0-100, "defensive": 0-100, "compromise": 0-100, "propose": 0-100},
  "bestChoice": {"turnNumber": 数値, "strategy": "選択", "reason": "理由"},
  "worstChoice": {"turnNumber": 数値, "strategy": "選択", "reason": "理由"},
  "optimalRoute": [{"turnNumber": 数値, "recommendedStrategy": "戦略", "reason": "理由"}],
  "lessons": ["学び1", "学び2", "学び3"],
  "summary": "総合評価"
}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let analysis: any = {};
      try { analysis = JSON.parse(resp.content); } catch {
        analysis = { overallScore: 50, strategyEffectiveness: {}, bestChoice: null, worstChoice: null, optimalRoute: [], lessons: ["分析不能"], summary: "データ不足" };
      }

      await ctx.env.DB.prepare(
        `UPDATE interactive_scenarios SET analysisResult=?, status='completed', updatedAt=datetime('now') WHERE id=?`
      ).bind(toJson(analysis), input.scenarioId).run();

      return analysis;
    }),
  getInteractiveScenario: protectedProcedure
    .input(z.object({ scenarioId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM interactive_scenarios WHERE id=? AND userId=?`
      ).bind(input.scenarioId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, dialogue: parseJson<any[]>(row.dialogue), choices: parseJson<any[]>(row.choices), analysisResult: parseJson<any>(row.analysisResult) };
    }),
  listInteractiveScenarios: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, theme, status, createdAt, json_array_length(dialogue) as turnCount FROM interactive_scenarios WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // ============ Real-time Translation Chat ============
  createTranslationChat: protectedProcedure
    .input(z.object({ friendId: z.number(), userLang: z.string().default("ja"), friendLang: z.string().default("en") }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Check friendship
      const friendship = await ctx.env.DB.prepare(
        `SELECT id FROM friendships WHERE ((userId=? AND friendId=?) OR (userId=? AND friendId=?)) AND status='accepted'`
      ).bind(ctx.userId, input.friendId, input.friendId, ctx.userId).first<any>();
      if (!friendship) throw new TRPCError({ code: "FORBIDDEN", message: "友達関係が必要です" });

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO translation_chat_sessions (userId, friendId, userLang, friendLang, status)
         VALUES (?, ?, ?, ?, 'active')`
      ).bind(ctx.userId, input.friendId, input.userLang, input.friendLang).run();

      const session = await ctx.env.DB.prepare(
        `SELECT * FROM translation_chat_sessions WHERE userId=? AND friendId=?`
      ).bind(ctx.userId, input.friendId).first<any>();

      return session;
    }),
  sendTranslationMessage: protectedProcedure
    .input(z.object({ sessionId: z.number(), text: z.string(), targetLang: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const session = await ctx.env.DB.prepare(
        `SELECT * FROM translation_chat_sessions WHERE id=?`
      ).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      // Determine target language
      const isInitiator = session.userId === ctx.userId;
      const targetLang = input.targetLang || (isInitiator ? session.friendLang : session.userLang);

      // Detect language and translate
      const translatePrompt = `以下のテキストを${targetLang === 'ja' ? '日本語' : targetLang === 'en' ? '英語' : targetLang === 'zh' ? '中国語' : targetLang === 'ko' ? '韓国語' : targetLang}に翻訳してください。自然で流暢な翻訳にしてください。

テキスト: ${input.text}

JSON形式で返してください:
{"translatedText": "翻訳結果", "detectedLang": "検出された原文言語コード(ja/en/zh/ko/es/fr/de)"}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: translatePrompt }]);
      let translated: any = {};
      try { translated = JSON.parse(resp.content); } catch { translated = { translatedText: input.text, detectedLang: "unknown" }; }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO translation_chat_messages (sessionId, userId, originalText, translatedText, originalLang, targetLang)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(input.sessionId, ctx.userId, input.text, translated.translatedText, translated.detectedLang || null, targetLang).run();

      return {
        id: res.meta?.last_row_id,
        originalText: input.text,
        translatedText: translated.translatedText,
        detectedLang: translated.detectedLang,
        targetLang,
      };
    }),
  getTranslationChatMessages: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT tcm.*, u.name as senderName FROM translation_chat_messages tcm
         LEFT JOIN users u ON u.id = tcm.userId
         WHERE tcm.sessionId=?
         ORDER BY tcm.createdAt ASC`
      ).bind(input.sessionId).all<any>();
      return rows.results ?? [];
    }),
  rateTranslation: protectedProcedure
    .input(z.object({ messageId: z.number(), rating: z.enum(["up", "down"]) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE translation_chat_messages SET qualityRating=? WHERE id=?`
      ).bind(input.rating, input.messageId).run();
      return { rated: true };
    }),
  listTranslationChats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT tcs.*, u.name as friendName,
              (SELECT COUNT(*) FROM translation_chat_messages WHERE sessionId=tcs.id) as messageCount
       FROM translation_chat_sessions tcs
       LEFT JOIN users u ON u.id = tcs.friendId
       WHERE tcs.userId=?
       ORDER BY tcs.createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // ============ Comparison Timeline ============
  createComparisonTimeline: protectedProcedure
    .input(z.object({ sessionIdA: z.number(), sessionIdB: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const sessionA = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionIdA).first<any>();
      const sessionB = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionIdB).first<any>();
      if (!sessionA || !sessionB) throw new TRPCError({ code: "NOT_FOUND" });

      const dialoguesA = await ctx.env.DB.prepare(
        `SELECT speaker, content, turnNumber FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionIdA).all<any>();
      const dialoguesB = await ctx.env.DB.prepare(
        `SELECT speaker, content, turnNumber FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionIdB).all<any>();

      const resultA = await ctx.env.DB.prepare(`SELECT compatibilityScore, scoreBreakdown FROM matching_results WHERE sessionId=?`).bind(input.sessionIdA).first<any>();
      const resultB = await ctx.env.DB.prepare(`SELECT compatibilityScore, scoreBreakdown FROM matching_results WHERE sessionId=?`).bind(input.sessionIdB).first<any>();

      const prompt = `2つのマッチング対話を比較分析してください。

【セッションA】テーマ: ${sessionA.theme}, スコア: ${resultA?.compatibilityScore || 'N/A'}
${(dialoguesA.results ?? []).map((d: any) => `${d.speaker}: ${d.content}`).join('\n')}

【セッションB】テーマ: ${sessionB.theme}, スコア: ${resultB?.compatibilityScore || 'N/A'}
${(dialoguesB.results ?? []).map((d: any) => `${d.speaker}: ${d.content}`).join('\n')}

JSON形式で返してください:
{
  "turnAnalysis": [{"turnNumber": 1, "sessionANote": "Aの評価", "sessionBNote": "Bの評価", "winner": "A|B|tie", "reason": "理由"}],
  "overallVerdict": {"winner": "A|B|tie", "reason": "総合判定理由", "scoreA": ${resultA?.compatibilityScore || 0}, "scoreB": ${resultB?.compatibilityScore || 0}},
  "keyDifferences": [{"aspect": "観点", "sessionA": "Aの特徴", "sessionB": "Bの特徴"}],
  "highlights": [{"turnNumber": 1, "session": "A|B", "description": "注目ポイント"}]
}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let comparison: any = {};
      try { comparison = JSON.parse(resp.content); } catch {
        comparison = { turnAnalysis: [], overallVerdict: { winner: "tie", reason: "分析不能" }, keyDifferences: [], highlights: [] };
      }

      const comparisonData = {
        sessionA: { id: input.sessionIdA, theme: sessionA.theme, score: resultA?.compatibilityScore, dialogues: dialoguesA.results ?? [] },
        sessionB: { id: input.sessionIdB, theme: sessionB.theme, score: resultB?.compatibilityScore, dialogues: dialoguesB.results ?? [] },
        ...comparison,
      };

      const res = await ctx.env.DB.prepare(
        `INSERT INTO comparison_timelines (userId, sessionIdA, sessionIdB, comparison, turnAnalysis, overallVerdict)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        ctx.userId, input.sessionIdA, input.sessionIdB,
        toJson(comparisonData), toJson(comparison.turnAnalysis || []), toJson(comparison.overallVerdict || {})
      ).run();

      return { id: res.meta?.last_row_id, ...comparisonData };
    }),
  getComparisonTimeline: protectedProcedure
    .input(z.object({ comparisonId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM comparison_timelines WHERE id=? AND userId=?`
      ).bind(input.comparisonId, ctx.userId).first<any>();
      if (!row) return null;
      return {
        ...row,
        comparison: parseJson<any>(row.comparison),
        turnAnalysis: parseJson<any[]>(row.turnAnalysis),
        overallVerdict: parseJson<any>(row.overallVerdict),
      };
    }),
  listComparisonTimelines: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ct.id, ct.sessionIdA, ct.sessionIdB, ct.createdAt,
              msA.theme as themeA, msB.theme as themeB,
              json_extract(ct.overallVerdict, '$.winner') as winner
       FROM comparison_timelines ct
       LEFT JOIN matching_sessions msA ON msA.id = ct.sessionIdA
       LEFT JOIN matching_sessions msB ON msB.id = ct.sessionIdB
       WHERE ct.userId=?
       ORDER BY ct.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  // ============ Risk Assessment ============
  assessRisk: protectedProcedure
    .input(z.object({ friendId: z.number(), theme: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const friend = await ctx.env.DB.prepare(`SELECT u.name, up.industry, up.company, up.position FROM users u LEFT JOIN user_profiles up ON up.userId=u.id WHERE u.id=?`).bind(input.friendId).first<any>();
      if (!friend) throw new TRPCError({ code: "NOT_FOUND", message: "相手が見つかりません" });

      const pastSessions = await ctx.env.DB.prepare(
        `SELECT ms.theme, mr.compatibilityScore, mr.scoreBreakdown FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id WHERE (ms.initiatorUserId=? AND json_extract(ms.settings,'$.friendId')=?) OR (ms.initiatorUserId=? AND json_extract(ms.settings,'$.friendId')=?) ORDER BY ms.createdAt DESC LIMIT 5`
      ).bind(ctx.userId, input.friendId, input.friendId, ctx.userId).all<any>();

      const myProfile = await ctx.env.DB.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "risk_assessment", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネスマッチングのリスク分析専門家です。相手プロフィール・過去の対話履歴・業界情報から潜在リスクを診断し、リスクレベルと軽減策を提案してください。" },
        { role: "user", content: `自分: ${myProfile?.displayName || "ユーザー"} (${myProfile?.industry || "業界不明"}, ${myProfile?.company || "会社不明"})\n相手: ${friend.name} (${friend.industry || "業界不明"}, ${friend.company || "会社不明"}, ${friend.position || "役職不明"})\nテーマ: ${input.theme || "未定"}\n過去マッチング: ${JSON.stringify((pastSessions.results || []).map((s: any) => ({ theme: s.theme, score: s.compatibilityScore })))}\n\nJSON:\n{"riskLevel":"high|medium|low","risks":[{"category":"value_conflict|knowledge_gap|communication_mismatch|interest_conflict|other","description":"...","severity":"high|medium|low"}],"mitigations":[{"risk":"...","strategy":"...","priority":"high|medium|low"}],"overallAssessment":"..."}` }
      ], { maxTokens: 2000, temperature: 0.3 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = { riskLevel: "medium", risks: [{ category: "other", description: result.content, severity: "medium" }], mitigations: [], overallAssessment: result.content };
      }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO risk_assessments (userId, friendId, riskLevel, risks, mitigations) VALUES (?,?,?,?,?)`
      ).bind(ctx.userId, input.friendId, parsed.riskLevel || "medium", toJson(parsed.risks || []), toJson(parsed.mitigations || [])).run();

      return { id: res.meta?.last_row_id, ...parsed };
    }),
  getRiskAssessment: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM risk_assessments WHERE userId=? AND friendId=? ORDER BY createdAt DESC LIMIT 1`
      ).bind(ctx.userId, input.friendId).first<any>();
      if (!row) return null;
      return { ...row, risks: parseJson<any[]>(row.risks) || [], mitigations: parseJson<any[]>(row.mitigations) || [] };
    }),
  verifyRisk: protectedProcedure
    .input(z.object({ assessmentId: z.number(), actualOutcome: z.string(), accuracy: z.number().min(0).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE risk_assessments SET verified=1, actualOutcome=?, accuracy=? WHERE id=? AND userId=?`
      ).bind(input.actualOutcome, input.accuracy, input.assessmentId, ctx.userId).run();
      return { verified: true };
    }),
  listRiskAssessments: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ra.*, u.name as friendName FROM risk_assessments ra JOIN users u ON u.id=ra.friendId WHERE ra.userId=? ORDER BY ra.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, risks: parseJson<any[]>(r.risks) || [], mitigations: parseJson<any[]>(r.mitigations) || [] }));
  }),

  // ============ Impact Map ============
  addImpactEntry: protectedProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      outcomeType: z.enum(["deal", "partnership", "introduction", "idea", "meeting", "other"]),
      title: z.string().min(1),
      description: z.string().optional(),
      monetaryValue: z.number().default(0),
      linkedEntryId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO impact_map_entries (userId, sessionId, outcomeType, title, description, monetaryValue, linkedEntryId) VALUES (?,?,?,?,?,?,?)`
      ).bind(ctx.userId, input.sessionId ?? null, input.outcomeType, input.title, input.description || "", input.monetaryValue, input.linkedEntryId ?? null).run();
      return { id: res.meta?.last_row_id };
    }),
  listImpactEntries: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ime.*, ms.theme as sessionTheme FROM impact_map_entries ime LEFT JOIN matching_sessions ms ON ms.id=ime.sessionId WHERE ime.userId=? ORDER BY ime.createdAt DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  deleteImpactEntry: protectedProcedure
    .input(z.object({ entryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM impact_map_entries WHERE id=? AND userId=?`).bind(input.entryId, ctx.userId).run();
      return { deleted: true };
    }),
  getImpactSummary: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const entries = await ctx.env.DB.prepare(
      `SELECT * FROM impact_map_entries WHERE userId=?`
    ).bind(ctx.userId).all<any>();
    const all = entries.results ?? [];
    const totalValue = all.reduce((sum: number, e: any) => sum + (e.monetaryValue || 0), 0);
    const byType: Record<string, number> = {};
    all.forEach((e: any) => { byType[e.outcomeType] = (byType[e.outcomeType] || 0) + 1; });
    const chainCount = all.filter((e: any) => e.linkedEntryId).length;
    return { totalEntries: all.length, totalValue, byType, chainCount };
  }),
  generateImpactReport: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const entries = await ctx.env.DB.prepare(
      `SELECT ime.*, ms.theme as sessionTheme FROM impact_map_entries ime LEFT JOIN matching_sessions ms ON ms.id=ime.sessionId WHERE ime.userId=? AND ime.createdAt >= datetime('now','-30 days') ORDER BY ime.createdAt`
    ).bind(ctx.userId).all<any>();
    if (!entries.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "過去30日間のインパクトデータがありません" });

    const entrySummary = (entries.results || []).map((e: any) => `[${e.outcomeType}] ${e.title}: ¥${e.monetaryValue || 0}`).join("\n");

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "impact_report", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
    const result = await invokeLLM(llmConfig, [
      { role: "system", content: "マッチングのビジネスインパクトを分析し、月次レポートを生成してください。ROI計算、成果の因果連鎖分析、来月の予測を含めてください。" },
      { role: "user", content: `インパクトデータ(${entries.results.length}件):\n${entrySummary}\n\nJSON:\n{"summary":"総括","totalImpactScore":85,"roi":"ROI分析","causalChains":["連鎖1の説明"],"topOutcomes":["成果1"],"predictions":["予測1"],"recommendations":["提案1"]}` }
    ], { maxTokens: 1500, temperature: 0.4 });

    let parsed: any = {};
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { parsed = { summary: result.content, totalImpactScore: 50 }; }

    const res = await ctx.env.DB.prepare(
      `INSERT INTO impact_map_reports (userId, period, reportData, totalImpactScore) VALUES (?,?,?,?)`
    ).bind(ctx.userId, "monthly", toJson(parsed), parsed.totalImpactScore || 0).run();

    return { id: res.meta?.last_row_id, ...parsed };
  }),
  listImpactReports: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM impact_map_reports WHERE userId=? ORDER BY createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, reportData: parseJson<any>(r.reportData) || {} }));
  }),

  // === Phase 36: Strategy Annotations ===
  addStrategyAnnotation: protectedProcedure
    .input(z.object({ sessionId: z.number(), turnNumber: z.number(), tag: z.enum(["attack","defend","empathy","gather","propose","consensus","avoid"]), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const settings = parseJson<any>(session.settings) || {};
      if (session.initiatorUserId !== ctx.userId && settings.friendId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO strategy_annotations (sessionId, turnNumber, userId, tag, comment) VALUES (?,?,?,?,?)`
      ).bind(input.sessionId, input.turnNumber, ctx.userId, input.tag, input.comment || null).run();
      return { success: true };
    }),
  getStrategyAnnotations: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM strategy_annotations WHERE sessionId=? AND userId=? ORDER BY turnNumber`
      ).bind(input.sessionId, ctx.userId).all<any>();
      return rows.results ?? [];
    }),
  getStrategyStats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT sa.tag, COUNT(*) as count,
        AVG(CAST(mr.compatibilityScore AS REAL)) as avgScore,
        MAX(CAST(mr.compatibilityScore AS REAL)) as maxScore
      FROM strategy_annotations sa
      JOIN matching_results mr ON mr.sessionId = sa.sessionId
      WHERE sa.userId=?
      GROUP BY sa.tag
      ORDER BY avgScore DESC
    `).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  suggestOptimalStrategy: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const dialogues = await ctx.env.DB.prepare(
        `SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      const stats = await ctx.env.DB.prepare(`
        SELECT sa.tag, COUNT(*) as count, AVG(CAST(mr.compatibilityScore AS REAL)) as avgScore
        FROM strategy_annotations sa JOIN matching_results mr ON mr.sessionId = sa.sessionId
        WHERE sa.userId=? GROUP BY sa.tag
      `).bind(ctx.userId).all<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "strategy_suggestion", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const turns = (dialogues.results ?? []).map((d: any) => `ターン${d.turnNumber}: ${d.speakerRole}: ${d.message}`).join("\n");
      const statsText = (stats.results ?? []).map((s: any) => `${s.tag}: ${s.count}回, 平均スコア${Math.round(s.avgScore || 0)}`).join(", ");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネス対話戦略の専門家です。以下の対話とユーザーの戦略統計を分析し、各ターンの最適な戦略タグ（attack/defend/empathy/gather/propose/consensus/avoid）と理由を提案してください。JSON形式で返答: { \"suggestions\": [{ \"turnNumber\": 1, \"recommendedTag\": \"...\", \"reason\": \"...\" }], \"optimalSequence\": [\"tag1\",\"tag2\",...], \"patternAdvice\": \"全体的なアドバイス\" }" },
        { role: "user", content: `対話:\n${turns}\n\nユーザーの戦略統計: ${statsText || "データなし"}` }
      ], { maxTokens: 2000 });

      let parsed: any = { suggestions: [], optimalSequence: [], patternAdvice: result.content };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {}

      return parsed;
    }),
  // ============ Voice Notes ============
  addVoiceNote: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      turnNumber: z.number().optional(),
      transcript: z.string().min(1),
      duration: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_voice_notes (sessionId, turnNumber, userId, transcript, duration) VALUES (?,?,?,?,?)`
      ).bind(input.sessionId, input.turnNumber ?? null, ctx.userId, input.transcript, input.duration ?? 0).run();
      return { id: res.meta?.last_row_id };
    }),
  getVoiceNotes: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM matching_voice_notes WHERE sessionId=? AND userId=? ORDER BY createdAt ASC`
      ).bind(input.sessionId, ctx.userId).all<any>();
      return (rows.results ?? []).map((r: any) => ({
        ...r,
        actionItems: parseJson<string[]>(r.actionItems) || [],
      }));
    }),

  // ============ Session Bookmarks ============
  bookmarkSession: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      category: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO session_bookmarks (sessionId, userId, category, note) VALUES (?,?,?,?)`
      ).bind(input.sessionId, ctx.userId, input.category || "default", input.note || null).run();
      return { bookmarked: true };
    }),
  unbookmarkSession: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM session_bookmarks WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).run();
      return { unbookmarked: true };
    }),
  listBookmarks: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const cat = input?.category;
      let rows;
      if (cat) {
        rows = await ctx.env.DB.prepare(`
          SELECT sb.*, ms.theme, ms.status, ms.createdAt as sessionCreatedAt,
                 mr.compatibilityScore
          FROM session_bookmarks sb
          JOIN matching_sessions ms ON ms.id = sb.sessionId
          LEFT JOIN matching_results mr ON mr.sessionId = sb.sessionId
          WHERE sb.userId=? AND sb.category=?
          ORDER BY sb.createdAt DESC
        `).bind(ctx.userId, cat).all<any>();
      } else {
        rows = await ctx.env.DB.prepare(`
          SELECT sb.*, ms.theme, ms.status, ms.createdAt as sessionCreatedAt,
                 mr.compatibilityScore
          FROM session_bookmarks sb
          JOIN matching_sessions ms ON ms.id = sb.sessionId
          LEFT JOIN matching_results mr ON mr.sessionId = sb.sessionId
          WHERE sb.userId=?
          ORDER BY sb.createdAt DESC
        `).bind(ctx.userId).all<any>();
      }
      return rows.results ?? [];
    }),
  getBookmarkCategories: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT category, COUNT(*) as count FROM session_bookmarks WHERE userId=? GROUP BY category ORDER BY count DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  isBookmarked: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM session_bookmarks WHERE sessionId=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      return row ? { bookmarked: true, category: row.category, note: row.note } : { bookmarked: false };
    }),
  getDashboardBookmarks: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT sb.sessionId, sb.category, ms.theme, mr.compatibilityScore
       FROM session_bookmarks sb
       JOIN matching_sessions ms ON ms.id = sb.sessionId
       LEFT JOIN matching_results mr ON mr.sessionId = sb.sessionId
       WHERE sb.userId=?
       ORDER BY sb.createdAt DESC LIMIT 5`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // ============ Bulk Export & Archive ============
  bulkExport: protectedProcedure
    .input(z.object({ sessionIds: z.array(z.number()), format: z.enum(["csv", "json"]) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const placeholders = input.sessionIds.map(() => '?').join(',');
      const sessions = await ctx.env.DB.prepare(
        `SELECT ms.*, mr.compatibilityScore, mr.scoreBreakdown, mr.summary as resultSummary, mr.recommendations
         FROM matching_sessions ms
         LEFT JOIN matching_results mr ON mr.sessionId = ms.id
         WHERE ms.id IN (${placeholders}) AND ms.initiatorUserId=?`
      ).bind(...input.sessionIds, ctx.userId).all<any>();

      if (input.format === "json") {
        const data = (sessions.results ?? []).map((s: any) => ({
          id: s.id, theme: s.theme, status: s.status,
          score: s.compatibilityScore,
          breakdown: parseJson<any>(s.scoreBreakdown),
          summary: s.resultSummary,
          recommendations: s.recommendations,
          createdAt: s.createdAt,
        }));
        return { format: "json", data: JSON.stringify(data, null, 2), filename: `matchings-export-${Date.now()}.json` };
      }

      // CSV format
      const header = "ID,テーマ,ステータス,スコア,作成日";
      const csvRows = (sessions.results ?? []).map((s: any) =>
        `${s.id},"${(s.theme || '').replace(/"/g, '""')}",${s.status},${s.compatibilityScore || ''},${s.createdAt || ''}`
      );
      return { format: "csv", data: [header, ...csvRows].join("\n"), filename: `matchings-export-${Date.now()}.csv` };
    }),
  archiveSessions: protectedProcedure
    .input(z.object({ sessionIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const placeholders = input.sessionIds.map(() => '?').join(',');
      await ctx.env.DB.prepare(
        `UPDATE matching_sessions SET status='archived' WHERE id IN (${placeholders}) AND initiatorUserId=?`
      ).bind(...input.sessionIds, ctx.userId).run();
      return { archived: input.sessionIds.length };
    }),
  unarchiveSessions: protectedProcedure
    .input(z.object({ sessionIds: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const placeholders = input.sessionIds.map(() => '?').join(',');
      await ctx.env.DB.prepare(
        `UPDATE matching_sessions SET status='completed' WHERE id IN (${placeholders}) AND initiatorUserId=? AND status='archived'`
      ).bind(...input.sessionIds, ctx.userId).run();
      return { unarchived: input.sessionIds.length };
    }),
  archivedSessions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, ms.createdAt, mr.compatibilityScore
       FROM matching_sessions ms
       LEFT JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId=? AND ms.status='archived'
       ORDER BY ms.createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

});
