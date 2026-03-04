import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  ensureSchema,
  parseJson,
  toJson,
  getMyTwin,
  normalizeTwin,
} from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { createNotification } from "../notifications";

export const twinsToolsRouter = router({
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

  // ============ Phase 20: ツインナレッジグラフ ============

  generateKnowledgeGraph: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    const entries = await ctx.env.DB.prepare(
      `SELECT * FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC`
    ).bind(twin.id).all<any>();
    const entryList = entries.results ?? [];
    if (entryList.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "ナレッジベースにエントリがありません" });

    const entrySummaries = entryList.map((e: any, i: number) =>
      `[${i + 1}] タイトル: ${e.title || "無題"}\nカテゴリ: ${e.category || "未分類"}\n内容: ${(e.content || e.summary || "").slice(0, 300)}`
    ).join("\n\n");

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "AI APIキーが未設定です" });

    const systemPrompt = `あなたはナレッジグラフ生成の専門家です。与えられた知識エントリを分析し、エントリ間の関係性をグラフ構造として表現してください。必ず以下のJSON形式で返してください。

{
  "nodes": [
    { "id": <エントリ番号>, "label": "ノードラベル", "category": "カテゴリ名", "size": <1-10 重要度> }
  ],
  "edges": [
    { "source": <ソースノードid>, "target": <ターゲットノードid>, "label": "関係ラベル", "strength": <1-10 関係の強さ> }
  ],
  "clusters": [
    { "name": "クラスター名", "nodeIds": [<関連ノードidの配列>] }
  ]
}

ノードのidはエントリの番号（1から始まる整数）を使用してください。`;

    const userPrompt = `以下のナレッジベースエントリを分析し、関係性をグラフ構造で表現してください。

${entrySummaries}

エントリ間の関連性・類似性・依存関係・補完関係を見つけ、JSON形式で返してください。`;

    const llmResult = await invokeLLM(llmConfig, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { maxTokens: 4096 });

    let graph: any;
    try {
      const cleaned = llmResult.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      graph = JSON.parse(cleaned);
    } catch {
      // Fallback: create simple nodes from entries with no edges
      graph = {
        nodes: entryList.map((e: any, i: number) => ({
          id: i + 1,
          label: e.title || `エントリ${i + 1}`,
          category: e.category || "未分類",
          size: 5,
        })),
        edges: [],
        clusters: [{ name: "全エントリ", nodeIds: entryList.map((_: any, i: number) => i + 1) }],
      };
    }

    const graphJson = toJson(graph);
    const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

    await ctx.env.DB.prepare(
      `INSERT OR REPLACE INTO knowledge_graphs (twinId, graphData, generatedAt) VALUES (?, ?, ?)`
    ).bind(twin.id, graphJson, generatedAt).run();

    return graph;
  }),

  getKnowledgeGraph: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return null;

    const row = await ctx.env.DB.prepare(
      `SELECT * FROM knowledge_graphs WHERE twinId=?`
    ).bind(twin.id).first<any>();
    if (!row) return null;

    return {
      id: row.id,
      twinId: row.twinId,
      ...parseJson<any>(row.graphData),
      generatedAt: row.generatedAt,
    };
  }),

  getRelatedKnowledge: protectedProcedure
    .input(z.object({ entryId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];

      const row = await ctx.env.DB.prepare(
        `SELECT * FROM knowledge_graphs WHERE twinId=?`
      ).bind(twin.id).first<any>();
      if (!row) return [];

      const graph = parseJson<any>(row.graphData);
      if (!graph || !graph.edges || !graph.nodes) return [];

      // Find all edges connected to the given entry
      const connectedEdges = (graph.edges as any[]).filter(
        (e: any) => e.source === input.entryId || e.target === input.entryId
      );

      // Get connected node IDs
      const relatedNodeIds = connectedEdges.map((e: any) =>
        e.source === input.entryId ? e.target : e.source
      );

      // Get knowledge entries for the related nodes
      const entries = await ctx.env.DB.prepare(
        `SELECT * FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC`
      ).bind(twin.id).all<any>();
      const entryList = entries.results ?? [];

      // Map node IDs back to entries (1-indexed)
      return relatedNodeIds.map((nodeId: number) => {
        const entry = entryList[nodeId - 1];
        const edge = connectedEdges.find(
          (e: any) => (e.source === input.entryId ? e.target : e.source) === nodeId
        );
        const node = (graph.nodes as any[]).find((n: any) => n.id === nodeId);
        return {
          entryId: entry?.id ?? nodeId,
          title: entry?.title ?? node?.label ?? `エントリ${nodeId}`,
          category: entry?.category ?? node?.category ?? "未分類",
          relationship: edge?.label ?? "関連",
          strength: edge?.strength ?? 5,
          summary: (entry?.content || entry?.summary || "").slice(0, 200),
        };
      }).filter((r: any) => r.entryId != null);
    }),

  // ============ Feature 22-1: ツインメモリーバンク ============

  collectMemories: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // Collect from matching dialogues
    const matchings = await ctx.env.DB.prepare(
      `SELECT ms.id, ms.theme, mr.recommendations, mr.compatibilityScore
       FROM matching_sessions ms
       LEFT JOIN matching_results mr ON mr.sessionId = ms.id
       WHERE ms.initiatorUserId = ? AND mr.id IS NOT NULL
       ORDER BY ms.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    // Collect from chat messages
    const chats = await ctx.env.DB.prepare(
      `SELECT cs.id, cs.title, COUNT(cm.id) as msgCount
       FROM chat_sessions cs
       LEFT JOIN chat_messages cm ON cm.sessionId = cs.id
       WHERE cs.userId = ? AND cs.mode != 'onboarding'
       GROUP BY cs.id ORDER BY cs.createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();

    // Collect from feedback
    const feedbacks = await ctx.env.DB.prepare(
      `SELECT df.sessionId, df.turnNumber, df.rating, df.comment, ms.theme
       FROM dialogue_feedback df
       JOIN matching_sessions ms ON ms.id = df.sessionId
       WHERE df.userId = ? ORDER BY df.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    let added = 0;
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);

    // Matching memories
    for (const m of (matchings.results ?? [])) {
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM twin_memories WHERE twinId = ? AND sourceType = 'matching' AND sourceId = ?`
      ).bind(twin.id, m.id).first();
      if (existing) continue;

      const recs = parseJson<any>(m.recommendations);
      const summary = `テーマ「${m.theme}」でスコア${m.compatibilityScore}。${recs?.length ? recs[0] : ""}`;
      await ctx.env.DB.prepare(
        `INSERT INTO twin_memories (twinId, userId, sourceType, sourceId, title, content, summary, importance) VALUES (?, ?, 'matching', ?, ?, ?, ?, ?)`
      ).bind(twin.id, ctx.userId, m.id, `マッチング: ${m.theme}`, toJson({ theme: m.theme, score: m.compatibilityScore, recommendations: recs }), summary, m.compatibilityScore >= 70 ? 8 : 5).run();
      added++;
    }

    // Chat memories
    for (const c of (chats.results ?? [])) {
      if ((c.msgCount ?? 0) < 3) continue;
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM twin_memories WHERE twinId = ? AND sourceType = 'chat' AND sourceId = ?`
      ).bind(twin.id, c.id).first();
      if (existing) continue;

      await ctx.env.DB.prepare(
        `INSERT INTO twin_memories (twinId, userId, sourceType, sourceId, title, content, summary, importance) VALUES (?, ?, 'chat', ?, ?, ?, ?, 4)`
      ).bind(twin.id, ctx.userId, c.id, `チャット: ${c.title || "会話"}`, toJson({ title: c.title, messageCount: c.msgCount }), `${c.title || "会話"} (${c.msgCount}メッセージ)`).run();
      added++;
    }

    // Feedback memories
    for (const f of (feedbacks.results ?? [])) {
      if (!f.comment) continue;
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM twin_memories WHERE twinId = ? AND sourceType = 'feedback' AND sourceId = ? AND title LIKE ?`
      ).bind(twin.id, f.sessionId, `%Turn${f.turnNumber}%`).first();
      if (existing) continue;

      await ctx.env.DB.prepare(
        `INSERT INTO twin_memories (twinId, userId, sourceType, sourceId, title, content, summary, importance) VALUES (?, ?, 'feedback', ?, ?, ?, ?, ?)`
      ).bind(twin.id, ctx.userId, f.sessionId, `フィードバック: ${f.theme} Turn${f.turnNumber}`, toJson({ rating: f.rating, comment: f.comment, theme: f.theme }), `${f.rating === "up" ? "👍" : "👎"} ${f.comment}`, f.rating === "down" ? 7 : 5).run();
      added++;
    }

    // Auto-summarize with LLM if we have enough memories
    const allMemories = await ctx.env.DB.prepare(
      `SELECT * FROM twin_memories WHERE twinId = ? ORDER BY importance DESC LIMIT 30`
    ).bind(twin.id).all<any>();

    let autoSummary = null;
    if ((allMemories.results ?? []).length >= 5 && llmConfig) {
      try {
        const memText = (allMemories.results ?? []).map((m: any) => `[${m.sourceType}] ${m.title}: ${m.summary || ""}`).join("\n");
        const result = await invokeLLM(llmConfig, [
          { role: "system", content: "ツインの記憶を要約して、人格の特徴や傾向を簡潔にまとめてください。JSON形式: {\"summary\": \"要約\", \"traits\": [\"特徴1\"], \"preferences\": [\"好み1\"]}" },
          { role: "user", content: memText },
        ], { maxTokens: 512, temperature: 0.5 });
        const match = result.content.match(/\{[\s\S]*\}/);
        if (match) autoSummary = JSON.parse(match[0]);
      } catch { /* ignore */ }
    }

    return { added, total: (allMemories.results ?? []).length, autoSummary };
  }),

  listMemories: protectedProcedure
    .input(z.object({ pinnedOnly: z.boolean().optional(), sourceType: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];
      let sql = `SELECT * FROM twin_memories WHERE twinId = ?`;
      const binds: any[] = [twin.id];
      if (input?.pinnedOnly) { sql += ` AND isPinned = 1`; }
      if (input?.sourceType) { sql += ` AND sourceType = ?`; binds.push(input.sourceType); }
      sql += ` ORDER BY isPinned DESC, importance DESC, updatedAt DESC`;
      const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<any>();
      return (rows.results ?? []).map((r: any) => ({ ...r, content: parseJson<any>(r.content), tags: parseJson<string[]>(r.tags) }));
    }),

  updateMemory: protectedProcedure
    .input(z.object({ memoryId: z.number(), title: z.string().optional(), summary: z.string().optional(), isPinned: z.boolean().optional(), importance: z.number().min(1).max(10).optional(), tags: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const sets: string[] = []; const binds: any[] = [];
      if (input.title !== undefined) { sets.push("title=?"); binds.push(input.title); }
      if (input.summary !== undefined) { sets.push("summary=?"); binds.push(input.summary); }
      if (input.isPinned !== undefined) { sets.push("isPinned=?"); binds.push(input.isPinned ? 1 : 0); }
      if (input.importance !== undefined) { sets.push("importance=?"); binds.push(input.importance); }
      if (input.tags !== undefined) { sets.push("tags=?"); binds.push(toJson(input.tags)); }
      if (sets.length === 0) return { updated: false };
      sets.push("updatedAt=datetime('now')");
      binds.push(input.memoryId, ctx.userId);
      await ctx.env.DB.prepare(`UPDATE twin_memories SET ${sets.join(",")} WHERE id=? AND userId=?`).bind(...binds).run();
      return { updated: true };
    }),

  deleteMemory: protectedProcedure
    .input(z.object({ memoryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM twin_memories WHERE id=? AND userId=?`).bind(input.memoryId, ctx.userId).run();
      return { deleted: true };
    }),

  // ============ Feature 23-2: ツインバージョン管理 ============

  createVersion: protectedProcedure
    .input(z.object({ label: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

      // Get latest version number
      const latest = await ctx.env.DB.prepare(
        `SELECT MAX(version) as maxVer FROM twin_versions WHERE twinId=?`
      ).bind(twin.id).first<any>();
      const newVersion = (latest?.maxVer ?? 0) + 1;

      // Compute diff from previous version
      let diff: any = null;
      if (newVersion > 1) {
        const prev = await ctx.env.DB.prepare(
          `SELECT * FROM twin_versions WHERE twinId=? AND version=?`
        ).bind(twin.id, newVersion - 1).first<any>();
        if (prev) {
          diff = {
            personality: prev.personality !== twin.personality ? { from: (prev.personality || "").slice(0, 100), to: (twin.personality || "").slice(0, 100) } : null,
            description: prev.description !== twin.description ? { from: (prev.description || "").slice(0, 100), to: (twin.description || "").slice(0, 100) } : null,
            tags: prev.tags !== twin.tags ? { from: prev.tags, to: twin.tags } : null,
          };
        }
      }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO twin_versions (twinId, userId, version, label, personality, description, systemPrompt, tags, diff, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(twin.id, ctx.userId, newVersion, input.label || `v${newVersion}`, twin.personality || "", twin.description || "", twin.systemPrompt || "", twin.tags || "", toJson(diff)).run();

      return { id: Number(res.meta.last_row_id), version: newVersion };
    }),

  listVersions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM twin_versions WHERE twinId=? ORDER BY version DESC`
    ).bind(twin.id).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, diff: parseJson<any>(r.diff) }));
  }),

  rollbackVersion: protectedProcedure
    .input(z.object({ versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      const version = await ctx.env.DB.prepare(
        `SELECT * FROM twin_versions WHERE id=? AND twinId=?`
      ).bind(input.versionId, twin.id).first<any>();
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "バージョンが見つかりません" });

      // Apply the version's state to the twin
      const sets: string[] = [];
      const binds: any[] = [];
      if (version.personality != null) { sets.push("personality=?"); binds.push(version.personality); }
      if (version.description != null) { sets.push("description=?"); binds.push(version.description); }
      if (version.systemPrompt != null) { sets.push("systemPrompt=?"); binds.push(version.systemPrompt); }
      if (version.tags != null) { sets.push("tags=?"); binds.push(version.tags); }
      if (sets.length > 0) {
        sets.push("updatedAt=datetime('now')");
        binds.push(twin.id);
        await ctx.env.DB.prepare(`UPDATE digital_twins SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
      }

      return { rolledBack: true, version: version.version };
    }),

  compareVersions: protectedProcedure
    .input(z.object({ versionIdA: z.number(), versionIdB: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      const vA = await ctx.env.DB.prepare(`SELECT * FROM twin_versions WHERE id=? AND twinId=?`).bind(input.versionIdA, twin.id).first<any>();
      const vB = await ctx.env.DB.prepare(`SELECT * FROM twin_versions WHERE id=? AND twinId=?`).bind(input.versionIdB, twin.id).first<any>();
      if (!vA || !vB) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        versionA: { id: vA.id, version: vA.version, label: vA.label, personality: vA.personality, description: vA.description, tags: vA.tags, createdAt: vA.createdAt },
        versionB: { id: vB.id, version: vB.version, label: vB.label, personality: vB.personality, description: vB.description, tags: vB.tags, createdAt: vB.createdAt },
        diff: {
          personality: vA.personality !== vB.personality,
          description: vA.description !== vB.description,
          systemPrompt: vA.systemPrompt !== vB.systemPrompt,
          tags: vA.tags !== vB.tags,
        },
      };
    }),

  getVersionPerformance: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) return [];
    const versions = await ctx.env.DB.prepare(
      `SELECT * FROM twin_versions WHERE twinId=? ORDER BY version ASC`
    ).bind(twin.id).all<any>();

    const result: any[] = [];
    for (const v of (versions.results ?? [])) {
      // Get matching scores created after this version but before next
      const nextVersion = (versions.results ?? []).find((nv: any) => nv.version === v.version + 1);
      const scoreRows = await ctx.env.DB.prepare(
        `SELECT AVG(mr.compatibilityScore) as avgScore, COUNT(mr.id) as matchCount
         FROM matching_results mr
         JOIN matching_sessions ms ON ms.id = mr.sessionId
         WHERE ms.initiatorUserId = ? AND ms.createdAt >= ? ${nextVersion ? "AND ms.createdAt < ?" : ""}
         AND mr.compatibilityScore IS NOT NULL`
      ).bind(...[ctx.userId, v.createdAt, ...(nextVersion ? [nextVersion.createdAt] : [])]).first<any>();

      result.push({
        version: v.version,
        label: v.label,
        createdAt: v.createdAt,
        avgScore: Math.round(scoreRows?.avgScore ?? 0),
        matchCount: scoreRows?.matchCount ?? 0,
      });
    }
    return result;
  }),

  // ============ Twin AI Coach Dialogue ============

  startCoaching: protectedProcedure
    .input(z.object({ twinId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=? AND userId=?`).bind(input.twinId, ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO twin_coaching_sessions (twinId, userId, status, personalityBefore) VALUES (?, ?, 'active', ?)`
      ).bind(input.twinId, ctx.userId, twin.personality || '').run();
      const sessionId = Number(res.meta.last_row_id);

      // Create initial system message
      await ctx.env.DB.prepare(
        `INSERT INTO twin_coaching_messages (sessionId, role, content) VALUES (?, 'system', ?)`
      ).bind(sessionId, `あなたのツイン「${twin.name}」のコーチングセッションを開始しました。\n\n現在の人格設定:\n${twin.personality || '(未設定)'}\n\n説明:\n${twin.description || '(未設定)'}\n\nどのような改善をしたいですか？例：\n• 「もっと積極的に」\n• 「専門用語を減らして」\n• 「相手の話をもっと聞くように」`).run();

      return { sessionId };
    }),

  sendCoachingMessage: protectedProcedure
    .input(z.object({ sessionId: z.number(), message: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT tcs.*, dt.name as twinName, dt.personality, dt.description, dt.systemPrompt, dt.tags
         FROM twin_coaching_sessions tcs
         JOIN digital_twins dt ON dt.id = tcs.twinId
         WHERE tcs.id=? AND tcs.userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      // Save user message
      await ctx.env.DB.prepare(
        `INSERT INTO twin_coaching_messages (sessionId, role, content) VALUES (?, 'user', ?)`
      ).bind(input.sessionId, input.message).run();

      // Get conversation history
      const history = await ctx.env.DB.prepare(
        `SELECT role, content FROM twin_coaching_messages WHERE sessionId=? ORDER BY createdAt ASC`
      ).bind(input.sessionId).all<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const systemPrompt = `あなたはデジタルツインのコーチングアシスタントです。ユーザーがツインの改善指示を出すのを手伝います。

現在のツイン設定:
- 名前: ${session.twinName}
- 人格: ${session.personality || '未設定'}
- 説明: ${session.description || '未設定'}
- システムプロンプト: ${session.systemPrompt || '未設定'}

ユーザーの指示に基づいて:
1. 指示を理解し確認する
2. 具体的にどのパラメータを調整すべきか提案する
3. ユーザーが「適用」「反映」と言ったら、以下のJSON形式で調整内容を返す:
---TWIN_UPDATE---
{"personality":"新しい人格","description":"新しい説明","systemPrompt":"新しいシステムプロンプト"}
---END_UPDATE---

適用指示がなければ自然な対話で改善案を議論してください。`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...(history.results ?? []).filter((m: any) => m.role !== 'system').map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const result = await invokeLLM(llmConfig, messages);
      const aiContent = result.content;

      // Save AI response
      await ctx.env.DB.prepare(
        `INSERT INTO twin_coaching_messages (sessionId, role, content) VALUES (?, 'assistant', ?)`
      ).bind(input.sessionId, aiContent).run();

      // Check if there's a twin update directive
      const updateMatch = aiContent.match(/---TWIN_UPDATE---\s*([\s\S]*?)\s*---END_UPDATE---/);
      let applied = false;
      if (updateMatch) {
        try {
          const updates = JSON.parse(updateMatch[1]);
          const setClauses: string[] = [];
          const values: any[] = [];
          if (updates.personality) { setClauses.push("personality=?"); values.push(updates.personality); }
          if (updates.description) { setClauses.push("description=?"); values.push(updates.description); }
          if (updates.systemPrompt) { setClauses.push("systemPrompt=?"); values.push(updates.systemPrompt); }
          if (setClauses.length > 0) {
            setClauses.push("updatedAt=datetime('now')");
            await ctx.env.DB.prepare(
              `UPDATE digital_twins SET ${setClauses.join(", ")} WHERE id=? AND userId=?`
            ).bind(...values, session.twinId, ctx.userId).run();
            await ctx.env.DB.prepare(
              `UPDATE twin_coaching_sessions SET personalityAfter=?, updatedAt=datetime('now') WHERE id=?`
            ).bind(updates.personality || session.personality, input.sessionId).run();
            applied = true;
          }
        } catch { /* ignore parse errors */ }
      }

      return { content: aiContent.replace(/---TWIN_UPDATE---[\s\S]*?---END_UPDATE---/g, '').trim(), applied };
    }),

  listCoachingSessions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT tcs.*, dt.name as twinName,
              (SELECT COUNT(*) FROM twin_coaching_messages tcm WHERE tcm.sessionId = tcs.id AND tcm.role='user') as messageCount
       FROM twin_coaching_sessions tcs
       JOIN digital_twins dt ON dt.id = tcs.twinId
       WHERE tcs.userId=? ORDER BY tcs.updatedAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  getCoachingSession: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(
        `SELECT tcs.*, dt.name as twinName, dt.personality as currentPersonality
         FROM twin_coaching_sessions tcs
         JOIN digital_twins dt ON dt.id = tcs.twinId
         WHERE tcs.id=? AND tcs.userId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const messages = await ctx.env.DB.prepare(
        `SELECT * FROM twin_coaching_messages WHERE sessionId=? ORDER BY createdAt ASC`
      ).bind(input.sessionId).all<any>();

      return { ...session, messages: messages.results ?? [] };
    }),

  endCoaching: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE twin_coaching_sessions SET status='completed', updatedAt=datetime('now') WHERE id=? AND userId=?`
      ).bind(input.sessionId, ctx.userId).run();
      return { ended: true };
    }),

  // ============ Emotion Mapping Journal ============

  recordEmotion: protectedProcedure
    .input(z.object({
      sourceType: z.enum(["matching", "chat", "coaching", "manual"]),
      sourceId: z.number().optional(),
      emotions: z.object({
        joy: z.number().min(0).max(1),
        anger: z.number().min(0).max(1),
        sadness: z.number().min(0).max(1),
        happiness: z.number().min(0).max(1),
        anxiety: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      }),
      context: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const emotions = input.emotions;
      const entries = Object.entries(emotions);
      const dominant = entries.sort((a, b) => b[1] - a[1])[0];
      const intensity = entries.reduce((sum, [, v]) => sum + v, 0) / entries.length;

      const res = await ctx.env.DB.prepare(
        `INSERT INTO emotion_journal_entries (userId, twinId, sourceType, sourceId, emotions, dominantEmotion, intensity, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, twin.id, input.sourceType, input.sourceId || null, toJson(input.emotions), dominant[0], Math.round(intensity * 100) / 100, input.context || null).run();

      // Check for stress patterns (3+ recent entries with high anxiety or anger)
      const recent = await ctx.env.DB.prepare(
        `SELECT emotions FROM emotion_journal_entries WHERE userId=? ORDER BY createdAt DESC LIMIT 5`
      ).bind(ctx.userId).all<any>();
      const recentEmotions = (recent.results ?? []).map((r: any) => parseJson<any>(r.emotions) || {});
      const highStressCount = recentEmotions.filter(e => (e.anxiety || 0) > 0.7 || (e.anger || 0) > 0.7).length;

      if (highStressCount >= 3) {
        await ctx.env.DB.prepare(
          `INSERT INTO emotion_alerts (userId, alertType, message, suggestion) VALUES (?, 'stress', ?, ?)`
        ).bind(ctx.userId, "ストレス兆候が検出されました: 最近の対話で不安や怒りの感情が高い状態が続いています", "対話のテーマを変えてみる、リラックスできるトピックでの練習、またはツインの人格設定を調整することをお勧めします").run();
      }

      return { id: Number(res.meta.last_row_id), dominantEmotion: dominant[0], intensity };
    }),

  analyzeSessionEmotions: protectedProcedure
    .input(z.object({
      sourceType: z.enum(["matching", "chat"]),
      sourceId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      // Get dialogues
      let dialogueText = "";
      if (input.sourceType === "matching") {
        const dialogues = await ctx.env.DB.prepare(
          `SELECT speaker, content FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber ASC`
        ).bind(input.sourceId).all<any>();
        dialogueText = (dialogues.results ?? []).map((d: any) => `[${d.speaker}] ${d.content}`).join('\n');
      } else {
        const messages = await ctx.env.DB.prepare(
          `SELECT role, content FROM chat_messages WHERE sessionId=? ORDER BY createdAt ASC LIMIT 20`
        ).bind(input.sourceId).all<any>();
        dialogueText = (messages.results ?? []).map((m: any) => `[${m.role}] ${m.content}`).join('\n');
      }

      if (!dialogueText) throw new TRPCError({ code: "BAD_REQUEST", message: "対話データがありません" });

      const prompt = `以下の対話から感情の推移を分析してJSON形式で返してください。

${dialogueText}

JSON形式:
{"emotions":{"joy":0-1,"anger":0-1,"sadness":0-1,"happiness":0-1,"anxiety":0-1,"confidence":0-1},"dominantEmotion":"最も強い感情","transitions":[{"turn":1,"emotion":"感情名","intensity":0-1}],"summary":"感情の推移の要約","stressIndicators":["ストレス兆候"]}`;

      const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let analysis: any = {};
      try { analysis = JSON.parse(result.content); } catch { analysis = { emotions: { joy: 0.5, anger: 0.1, sadness: 0.1, happiness: 0.5, anxiety: 0.2, confidence: 0.5 }, dominantEmotion: "happiness", transitions: [], summary: "分析中", stressIndicators: [] }; }

      // Auto-record emotion
      const emotions = analysis.emotions || {};
      const emotionEntries = Object.entries(emotions);
      const dominant = emotionEntries.sort(([,a]: any, [,b]: any) => b - a)[0];
      const intensity = emotionEntries.reduce((sum: number, [, v]: any) => sum + v, 0) / Math.max(emotionEntries.length, 1);

      await ctx.env.DB.prepare(
        `INSERT INTO emotion_journal_entries (userId, twinId, sourceType, sourceId, emotions, dominantEmotion, intensity, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, twin.id, input.sourceType, input.sourceId, toJson(emotions), dominant?.[0] || "neutral", Math.round(intensity * 100) / 100, analysis.summary || null).run();

      return analysis;
    }),

  getEmotionJournal: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM emotion_journal_entries WHERE userId=? ORDER BY createdAt DESC LIMIT ?`
      ).bind(ctx.userId, input.limit).all<any>();
      return (rows.results ?? []).map((r: any) => ({ ...r, emotions: parseJson<any>(r.emotions) }));
    }),

  getEmotionTimeline: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT emotions, dominantEmotion, intensity, createdAt, sourceType FROM emotion_journal_entries WHERE userId=? ORDER BY createdAt ASC LIMIT 60`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, emotions: parseJson<any>(r.emotions) }));
  }),

  getEmotionAlerts: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM emotion_alerts WHERE userId=? AND isRead=0 ORDER BY createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  markEmotionAlertRead: protectedProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE emotion_alerts SET isRead=1 WHERE id=? AND userId=?`).bind(input.alertId, ctx.userId).run();
      return { read: true };
    }),

  getEmotionAdvice: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    const recent = await ctx.env.DB.prepare(
      `SELECT emotions, dominantEmotion, intensity, sourceType, context, createdAt FROM emotion_journal_entries WHERE userId=? ORDER BY createdAt DESC LIMIT 10`
    ).bind(ctx.userId).all<any>();

    const prompt = `以下の感情ジャーナルデータを分析し、ストレス対策とメンタルヘルスのアドバイスをJSON形式で返してください。

${JSON.stringify((recent.results ?? []).map((r: any) => ({ ...r, emotions: parseJson<any>(r.emotions) })))}

JSON形式: {"overallMood":"全体的な気分","stressLevel":"low|medium|high","advice":[{"title":"アドバイスタイトル","description":"詳細","priority":"high|medium|low"}],"recommendation":"総合的な推奨事項"}`;

    const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let advice: any = {};
    try { advice = JSON.parse(result.content); } catch { advice = { overallMood: "分析中", stressLevel: "medium", advice: [], recommendation: "データを増やしてください" }; }
    return advice;
  }),


  // ============ Twin Goal Setting & Progress Tracker ============

  createGoal: protectedProcedure
    .input(z.object({
      goalType: z.enum(["skill", "score", "matching_count", "knowledge", "feedback", "custom"]),
      title: z.string().min(1),
      targetValue: z.number().min(1),
      unit: z.string().optional(),
      deadline: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO twin_goals (userId, twinId, goalType, title, targetValue, unit, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, twin.id, input.goalType, input.title, input.targetValue, input.unit || null, input.deadline || null).run();
      return { id: Number(res.meta.last_row_id) };
    }),

  listGoals: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM twin_goals WHERE userId=? ORDER BY status ASC, createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, milestones: parseJson<any[]>(r.milestones) || [] }));
  }),

  updateGoalProgress: protectedProcedure
    .input(z.object({ goalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const goal = await ctx.env.DB.prepare(`SELECT * FROM twin_goals WHERE id=? AND userId=?`).bind(input.goalId, ctx.userId).first<any>();
      if (!goal) throw new TRPCError({ code: "NOT_FOUND" });

      let currentValue = 0;

      switch (goal.goalType) {
        case "score": {
          const avg = await ctx.env.DB.prepare(
            `SELECT AVG(mr.compatibilityScore) as avg FROM matching_results mr JOIN matching_sessions ms ON ms.id = mr.sessionId WHERE ms.initiatorUserId = ? AND mr.compatibilityScore IS NOT NULL`
          ).bind(ctx.userId).first<any>();
          currentValue = Math.round(avg?.avg || 0);
          break;
        }
        case "matching_count": {
          const count = await ctx.env.DB.prepare(
            `SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId = ?`
          ).bind(ctx.userId).first<any>();
          currentValue = count?.c || 0;
          break;
        }
        case "knowledge": {
          const twin = await getMyTwin(ctx.env.DB, ctx.userId);
          const kbCount = await ctx.env.DB.prepare(
            `SELECT COUNT(*) as c FROM knowledge_base WHERE twinId = ?`
          ).bind(twin?.id || 0).first<any>();
          currentValue = kbCount?.c || 0;
          break;
        }
        case "feedback": {
          const fbCount = await ctx.env.DB.prepare(
            `SELECT COUNT(*) as c FROM dialogue_feedback WHERE userId = ? AND rating = 'up'`
          ).bind(ctx.userId).first<any>();
          currentValue = fbCount?.c || 0;
          break;
        }
        case "skill": {
          const twin = await getMyTwin(ctx.env.DB, ctx.userId);
          const skillAvg = await ctx.env.DB.prepare(
            `SELECT AVG(level) as avg FROM twin_skill_levels WHERE twinId = ?`
          ).bind(twin?.id || 0).first<any>();
          currentValue = Math.round(skillAvg?.avg || 0);
          break;
        }
        default:
          currentValue = goal.currentValue || 0;
      }

      const wasCompleted = goal.status === "completed";
      const nowCompleted = currentValue >= goal.targetValue;

      await ctx.env.DB.prepare(
        `UPDATE twin_goals SET currentValue=?, status=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(currentValue, nowCompleted ? "completed" : "active", input.goalId).run();

      // Award points on first completion
      let pointsAwarded = 0;
      if (nowCompleted && !wasCompleted) {
        pointsAwarded = 50;
        try {
          await ctx.env.DB.prepare(
            `UPDATE user_points SET balance = balance + ?, totalEarned = totalEarned + ? WHERE userId = ?`
          ).bind(pointsAwarded, pointsAwarded, ctx.userId).run();
          await ctx.env.DB.prepare(
            `INSERT INTO point_transactions (userId, amount, type, description) VALUES (?, ?, 'earn', ?)`
          ).bind(ctx.userId, pointsAwarded, `目標達成: ${goal.title}`).run();
        } catch { /* points table may not exist for this user */ }
      }

      return { currentValue, completed: nowCompleted, pointsAwarded };
    }),

  deleteGoal: protectedProcedure
    .input(z.object({ goalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM twin_goals WHERE id=? AND userId=?`).bind(input.goalId, ctx.userId).run();
      return { deleted: true };
    }),

  getGoalSuggestions: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    const matchCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM matching_sessions WHERE initiatorUserId=?`).bind(ctx.userId).first<any>();
    const avgScore = await ctx.env.DB.prepare(`SELECT AVG(mr.compatibilityScore) as avg FROM matching_results mr JOIN matching_sessions ms ON ms.id=mr.sessionId WHERE ms.initiatorUserId=?`).bind(ctx.userId).first<any>();
    const existingGoals = await ctx.env.DB.prepare(`SELECT goalType, title, status FROM twin_goals WHERE userId=?`).bind(ctx.userId).all<any>();

    const prompt = `ツインの成長目標を3件提案してください。

ツイン情報:
- 名前: ${twin?.name || '未設定'}
- 人格: ${twin?.personality || '未設定'}
- マッチング数: ${matchCount?.c || 0}
- 平均スコア: ${Math.round(avgScore?.avg || 0)}
- 既存目標: ${JSON.stringify(existingGoals.results ?? [])}

JSON配列で返してください:
[{"goalType":"skill|score|matching_count|knowledge|feedback","title":"目標タイトル","targetValue":数値,"unit":"単位","reason":"理由"}]`;

    const result = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
    let suggestions: any[] = [];
    try { const p = JSON.parse(result.content); suggestions = Array.isArray(p) ? p : p.suggestions || []; } catch { suggestions = [{ goalType: "matching_count", title: "マッチング10回達成", targetValue: 10, unit: "回", reason: "経験値を積む" }]; }
    return { suggestions };
  }),


  // ============ Knowledge Quiz ============

  generateQuiz: protectedProcedure
    .input(z.object({ count: z.number().min(1).max(20).default(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const knowledge = await ctx.env.DB.prepare(
        `SELECT id, title, content, summary FROM knowledge_base WHERE userId=? ORDER BY RANDOM() LIMIT 10`
      ).bind(ctx.userId).all<any>();

      if (!knowledge.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "ナレッジベースが空です" });

      const prompt = `以下のナレッジベースの内容から4択クイズを${input.count}問生成してください。

ナレッジ:
${(knowledge.results ?? []).map((k: any) => `[${k.title}] ${k.content || k.summary || ''}`).join('\n---\n')}

各問題は:
- ナレッジの内容に基づいた正確な問題
- 4つの選択肢（1つが正解、3つが誤答）
- 難易度（easy/normal/hard）
- 解説文

JSON配列で返してください:
[{
  "knowledgeId": ナレッジID(整数),
  "question": "問題文",
  "choices": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  "correctIndex": 正解インデックス(0-3),
  "explanation": "解説",
  "difficulty": "easy|normal|hard"
}]`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let quizzes: any[] = [];
      try {
        const p = JSON.parse(resp.content);
        quizzes = Array.isArray(p) ? p : p.quizzes || [];
      } catch {
        quizzes = [{
          knowledgeId: knowledge.results[0]?.id || null,
          question: "このナレッジの主要なテーマは何ですか？",
          choices: ["ビジネス戦略", "技術開発", "マーケティング", "人材育成"],
          correctIndex: 0,
          explanation: "ナレッジの内容を確認してください。",
          difficulty: "normal",
        }];
      }

      const inserted: any[] = [];
      for (const q of quizzes.slice(0, input.count)) {
        const res = await ctx.env.DB.prepare(
          `INSERT INTO knowledge_quizzes (userId, twinId, knowledgeId, question, choices, correctIndex, explanation, difficulty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          ctx.userId, twin.id, q.knowledgeId || null,
          q.question, toJson(q.choices), q.correctIndex,
          q.explanation || null, q.difficulty || "normal"
        ).run();
        inserted.push({ id: res.meta?.last_row_id, ...q });
      }

      return { quizzes: inserted };
    }),

  answerQuiz: protectedProcedure
    .input(z.object({ quizId: z.number(), selectedIndex: z.number(), timeTakenMs: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const quiz = await ctx.env.DB.prepare(
        `SELECT * FROM knowledge_quizzes WHERE id=? AND userId=?`
      ).bind(input.quizId, ctx.userId).first<any>();
      if (!quiz) throw new TRPCError({ code: "NOT_FOUND" });

      const correct = quiz.correctIndex === input.selectedIndex ? 1 : 0;
      await ctx.env.DB.prepare(
        `INSERT INTO quiz_attempts (userId, quizId, selectedIndex, correct, timeTakenMs) VALUES (?, ?, ?, ?, ?)`
      ).bind(ctx.userId, input.quizId, input.selectedIndex, correct, input.timeTakenMs || null).run();

      // Award points for correct answers
      if (correct) {
        try {
          await ctx.env.DB.prepare(
            `UPDATE user_points SET balance = balance + 5 WHERE userId=?`
          ).bind(ctx.userId).run();
          await ctx.env.DB.prepare(
            `INSERT INTO point_transactions (userId, amount, type, description) VALUES (?, 5, 'earn', 'クイズ正解ボーナス')`
          ).bind(ctx.userId).run();
        } catch { /* points table may not exist */ }
      }

      return {
        correct: !!correct,
        correctIndex: quiz.correctIndex,
        explanation: quiz.explanation,
        choices: parseJson<string[]>(quiz.choices),
        pointsEarned: correct ? 5 : 0,
      };
    }),

  getQuizHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const stats = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(correct) as correctCount, AVG(timeTakenMs) as avgTime
       FROM quiz_attempts WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const recent = await ctx.env.DB.prepare(
      `SELECT qa.*, kq.question, kq.difficulty FROM quiz_attempts qa
       JOIN knowledge_quizzes kq ON kq.id = qa.quizId
       WHERE qa.userId=?
       ORDER BY qa.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();

    const byDifficulty = await ctx.env.DB.prepare(
      `SELECT kq.difficulty, COUNT(*) as total, SUM(qa.correct) as correctCount
       FROM quiz_attempts qa JOIN knowledge_quizzes kq ON kq.id = qa.quizId
       WHERE qa.userId=?
       GROUP BY kq.difficulty`
    ).bind(ctx.userId).all<any>();

    return {
      totalAttempts: stats?.total || 0,
      correctCount: stats?.correctCount || 0,
      accuracy: stats?.total ? Math.round(((stats?.correctCount || 0) / stats.total) * 100) : 0,
      avgTimeMs: Math.round(stats?.avgTime || 0),
      recent: recent.results ?? [],
      byDifficulty: byDifficulty.results ?? [],
    };
  }),

  getWeakKnowledge: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const weak = await ctx.env.DB.prepare(
      `SELECT kq.knowledgeId, kb.title as knowledgeTitle,
              COUNT(*) as attempts, SUM(qa.correct) as correctCount,
              ROUND(CAST(SUM(qa.correct) AS REAL) / COUNT(*) * 100) as accuracy
       FROM quiz_attempts qa
       JOIN knowledge_quizzes kq ON kq.id = qa.quizId
       LEFT JOIN knowledge_base kb ON kb.id = kq.knowledgeId
       WHERE qa.userId=?
       GROUP BY kq.knowledgeId
       HAVING accuracy < 60
       ORDER BY accuracy ASC`
    ).bind(ctx.userId).all<any>();
    return weak.results ?? [];
  }),

  getQuizScoreTrend: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const trend = await ctx.env.DB.prepare(
      `SELECT DATE(qa.createdAt) as date, COUNT(*) as total, SUM(qa.correct) as correctCount,
              ROUND(CAST(SUM(qa.correct) AS REAL) / COUNT(*) * 100) as accuracy
       FROM quiz_attempts qa WHERE qa.userId=?
       GROUP BY DATE(qa.createdAt)
       ORDER BY date DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return trend.results ?? [];
  }),


  // ============ Persona A/B Test Automation ============

  runPersonaABTest: protectedProcedure
    .input(z.object({ theme: z.string(), personaIds: z.array(z.number()).min(2).max(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      // Get personas
      const personas = [];
      for (const pid of input.personaIds) {
        const p = await ctx.env.DB.prepare(`SELECT * FROM twin_personas WHERE id=? AND twinId=?`).bind(pid, twin.id).first<any>();
        if (p) personas.push(p);
      }
      if (personas.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "2つ以上のペルソナが必要です" });

      // Get a random friend's twin for opponent
      const friend = await ctx.env.DB.prepare(
        `SELECT dt.* FROM digital_twins dt JOIN friendships f ON (f.userId=? AND f.friendId=dt.userId AND f.status='accepted')
         OR (f.friendId=? AND f.userId=dt.userId AND f.status='accepted') LIMIT 1`
      ).bind(ctx.userId, ctx.userId).first<any>();

      const opponentPersonality = friend ? (friend.personality || "ビジネスプロフェッショナル") : "ビジネスプロフェッショナル";
      const opponentName = friend ? (friend.name || "対話相手") : "NPC対話相手";

      const results: any[] = [];
      for (const persona of personas) {
        const dialogueMessages: any[] = [];
        const twinPersonality = persona.personality || twin.personality || "ビジネスパーソン";
        const turns = 3;

        for (let t = 0; t < turns; t++) {
          // Twin's turn
          const twinPrompt = `あなたは「${persona.name || twin.name}」（${twinPersonality}）です。テーマ「${input.theme}」について対話してください。${dialogueMessages.length > 0 ? '\n前の対話:\n' + dialogueMessages.map((m: any) => `${m.speaker}: ${m.content}`).join('\n') : '最初の発言をしてください。'}`;
          const twinResp = await invokeLLM(llmConfig, [{ role: "user", content: twinPrompt }]);
          dialogueMessages.push({ speaker: persona.name || twin.name, content: twinResp.content });

          // Opponent's turn
          const oppPrompt = `あなたは「${opponentName}」（${opponentPersonality}）です。テーマ「${input.theme}」について対話してください。\n前の対話:\n${dialogueMessages.map((m: any) => `${m.speaker}: ${m.content}`).join('\n')}`;
          const oppResp = await invokeLLM(llmConfig, [{ role: "user", content: oppPrompt }]);
          dialogueMessages.push({ speaker: opponentName, content: oppResp.content });
        }

        // Score
        const scorePrompt = `以下のビジネス対話を100点満点で評価してください。テーマ: ${input.theme}\n\n対話:\n${dialogueMessages.map((m: any) => `${m.speaker}: ${m.content}`).join('\n')}\n\nJSON: {"score": 数値(0-100), "strengths": ["強み"], "weaknesses": ["弱み"]}`;
        const scoreResp = await invokeLLM(llmConfig, [{ role: "user", content: scorePrompt }]);
        let scored: any = { score: 50, strengths: [], weaknesses: [] };
        try { scored = JSON.parse(scoreResp.content); } catch {}

        results.push({
          personaId: persona.id,
          personaName: persona.name,
          score: scored.score || 50,
          strengths: scored.strengths || [],
          weaknesses: scored.weaknesses || [],
          dialogue: dialogueMessages,
        });
      }

      // Statistics
      const scores = results.map((r: any) => r.score);
      const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum: number, s: number) => sum + Math.pow(s - avg, 2), 0) / scores.length;
      const best = results.reduce((a: any, b: any) => a.score > b.score ? a : b);

      const testResult = { results, stats: { avg: Math.round(avg * 10) / 10, variance: Math.round(variance * 10) / 10, max: Math.max(...scores), min: Math.min(...scores) } };

      const res = await ctx.env.DB.prepare(
        `INSERT INTO persona_ab_tests (userId, twinId, theme, personaIds, results, bestPersonaId, status)
         VALUES (?, ?, ?, ?, ?, ?, 'completed')`
      ).bind(ctx.userId, twin.id, input.theme, toJson(input.personaIds), toJson(testResult), best.personaId).run();

      return { id: res.meta?.last_row_id, ...testResult, bestPersonaId: best.personaId, bestPersonaName: best.personaName };
    }),

  listPersonaABTests: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM persona_ab_tests WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      personaIds: parseJson<number[]>(r.personaIds),
      results: parseJson<any>(r.results),
    }));
  }),

  getPersonaABTest: protectedProcedure
    .input(z.object({ testId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM persona_ab_tests WHERE id=? AND userId=?`
      ).bind(input.testId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, personaIds: parseJson<number[]>(row.personaIds), results: parseJson<any>(row.results) };
    }),

  switchToPersona: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
      const persona = await ctx.env.DB.prepare(
        `SELECT * FROM twin_personas WHERE id=? AND twinId=?`
      ).bind(input.personaId, twin.id).first<any>();
      if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: "ペルソナが見つかりません" });

      await ctx.env.DB.prepare(
        `UPDATE digital_twins SET personality=?, description=?, systemPrompt=? WHERE id=?`
      ).bind(
        persona.personality || twin.personality,
        persona.description || twin.description,
        persona.systemPrompt || twin.systemPrompt,
        twin.id
      ).run();

      // Increment use count
      await ctx.env.DB.prepare(`UPDATE twin_personas SET useCount = useCount + 1 WHERE id=?`).bind(input.personaId).run();

      return { switched: true, personaName: persona.name };
    }),

  // ============ Weekly Review Auto-Generation ============

  generateWeeklyReview: protectedProcedure
    .input(z.object({ weekOffset: z.number().default(0) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM設定がありません" });

      // Calculate week range
      const nowDate = new Date();
      nowDate.setDate(nowDate.getDate() - (input.weekOffset * 7));
      const dayOfWeek = nowDate.getDay();
      const weekStart = new Date(nowDate);
      weekStart.setDate(nowDate.getDate() - dayOfWeek);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const startStr = weekStart.toISOString().split('T')[0];
      const endStr = weekEnd.toISOString().split('T')[0];

      // Gather week's data
      const matchings = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as count, AVG(mr.compatibilityScore) as avgScore, MAX(mr.compatibilityScore) as maxScore
         FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id
         WHERE ms.initiatorUserId=? AND ms.createdAt >= ? AND ms.createdAt <= ?`
      ).bind(ctx.userId, startStr, endStr + 'T23:59:59').first<any>();

      const chats = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as count FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId
         WHERE cs.userId=? AND cm.createdAt >= ? AND cm.createdAt <= ?`
      ).bind(ctx.userId, startStr, endStr + 'T23:59:59').first<any>();

      const goals = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
         FROM twin_goals WHERE userId=? AND updatedAt >= ? AND updatedAt <= ?`
      ).bind(ctx.userId, startStr, endStr + 'T23:59:59').first<any>();

      const emotions = await ctx.env.DB.prepare(
        `SELECT AVG(json_extract(emotions, '$.joy')) as avgJoy, AVG(json_extract(emotions, '$.confidence')) as avgConfidence,
                AVG(json_extract(emotions, '$.anxiety')) as avgAnxiety
         FROM emotion_journal_entries WHERE userId=? AND createdAt >= ? AND createdAt <= ?`
      ).bind(ctx.userId, startStr, endStr + 'T23:59:59').first<any>();

      // Previous week for comparison
      const prevStart = new Date(weekStart);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevEnd = new Date(weekEnd);
      prevEnd.setDate(prevEnd.getDate() - 7);
      const prevStartStr = prevStart.toISOString().split('T')[0];
      const prevEndStr = prevEnd.toISOString().split('T')[0];

      const prevMatchings = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as count, AVG(mr.compatibilityScore) as avgScore
         FROM matching_sessions ms LEFT JOIN matching_results mr ON mr.sessionId=ms.id
         WHERE ms.initiatorUserId=? AND ms.createdAt >= ? AND ms.createdAt <= ?`
      ).bind(ctx.userId, prevStartStr, prevEndStr + 'T23:59:59').first<any>();

      const stats = {
        matchingCount: matchings?.count || 0,
        avgScore: Math.round(matchings?.avgScore || 0),
        maxScore: matchings?.maxScore || 0,
        chatMessages: chats?.count || 0,
        goalsTotal: goals?.total || 0,
        goalsCompleted: goals?.completed || 0,
        avgJoy: Math.round((emotions?.avgJoy || 0) * 10) / 10,
        avgConfidence: Math.round((emotions?.avgConfidence || 0) * 10) / 10,
        avgAnxiety: Math.round((emotions?.avgAnxiety || 0) * 10) / 10,
        prevMatchingCount: prevMatchings?.count || 0,
        prevAvgScore: Math.round(prevMatchings?.avgScore || 0),
      };

      const prompt = `以下のユーザーの1週間の活動データからウィークリーレビューを生成してください。

期間: ${startStr} 〜 ${endStr}

今週の活動:
- マッチング: ${stats.matchingCount}回 (平均スコア: ${stats.avgScore}, 最高: ${stats.maxScore})
- チャットメッセージ: ${stats.chatMessages}件
- 目標: ${stats.goalsTotal}件中${stats.goalsCompleted}件達成
- 感情平均: 喜び${stats.avgJoy}, 自信${stats.avgConfidence}, 不安${stats.avgAnxiety}

前週比較:
- マッチング数: ${stats.prevMatchingCount}回 → ${stats.matchingCount}回
- 平均スコア: ${stats.prevAvgScore} → ${stats.avgScore}

JSON形式で返してください:
{
  "summary": "今週のサマリー（2-3文）",
  "improvements": [{"area": "改善エリア", "detail": "詳細", "change": "+10%など"}],
  "deteriorations": [{"area": "悪化エリア", "detail": "詳細", "change": "-5%など"}],
  "recommendations": [{"title": "推奨アクション", "description": "詳細", "priority": "high|medium|low"}]
}`;

      const resp = await invokeLLM(llmConfig, [{ role: "user", content: prompt }]);
      let review: any = {};
      try { review = JSON.parse(resp.content); } catch {
        review = {
          summary: `${startStr}〜${endStr}の活動レビュー: マッチング${stats.matchingCount}回、チャット${stats.chatMessages}件`,
          improvements: [],
          deteriorations: [],
          recommendations: [{ title: "マッチング頻度を増やす", description: "より多くの対話で経験を積みましょう", priority: "medium" }],
        };
      }

      await ctx.env.DB.prepare(
        `INSERT OR REPLACE INTO weekly_reviews (userId, weekStart, weekEnd, summary, improvements, deteriorations, recommendations, stats)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ctx.userId, startStr, endStr,
        review.summary || "",
        toJson(review.improvements || []),
        toJson(review.deteriorations || []),
        toJson(review.recommendations || []),
        toJson(stats)
      ).run();

      return { weekStart: startStr, weekEnd: endStr, ...review, stats };
    }),

  listWeeklyReviews: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM weekly_reviews WHERE userId=? ORDER BY weekStart DESC LIMIT 12`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      improvements: parseJson<any[]>(r.improvements),
      deteriorations: parseJson<any[]>(r.deteriorations),
      recommendations: parseJson<any[]>(r.recommendations),
      stats: parseJson<any>(r.stats),
    }));
  }),

  getWeeklyReview: protectedProcedure
    .input(z.object({ weekStart: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM weekly_reviews WHERE userId=? AND weekStart=?`
      ).bind(ctx.userId, input.weekStart).first<any>();
      if (!row) return null;
      return {
        ...row,
        improvements: parseJson<any[]>(row.improvements),
        deteriorations: parseJson<any[]>(row.deteriorations),
        recommendations: parseJson<any[]>(row.recommendations),
        stats: parseJson<any>(row.stats),
      };
    }),

  sendWeeklyReviewEmail: protectedProcedure
    .input(z.object({ weekStart: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const review = await ctx.env.DB.prepare(
        `SELECT * FROM weekly_reviews WHERE userId=? AND weekStart=?`
      ).bind(ctx.userId, input.weekStart).first<any>();
      if (!review) throw new TRPCError({ code: "NOT_FOUND" });

      const user = await ctx.env.DB.prepare(`SELECT email, name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      if (!user?.email) throw new TRPCError({ code: "BAD_REQUEST", message: "メールアドレスが設定されていません" });

      const improvements = parseJson<any[]>(review.improvements) || [];
      const deteriorations = parseJson<any[]>(review.deteriorations) || [];
      const recommendations = parseJson<any[]>(review.recommendations) || [];
      const reviewStats = parseJson<any>(review.stats) || {};

      const html = `<h2>ウィークリーレビュー: ${review.weekStart} 〜 ${review.weekEnd}</h2>
        <p>${review.summary}</p>
        <h3>統計</h3>
        <ul><li>マッチング: ${reviewStats.matchingCount || 0}回 (平均: ${reviewStats.avgScore || 0}点)</li>
        <li>チャット: ${reviewStats.chatMessages || 0}件</li>
        <li>目標: ${reviewStats.goalsCompleted || 0}/${reviewStats.goalsTotal || 0}達成</li></ul>
        ${improvements.length ? '<h3>改善ポイント</h3><ul>' + improvements.map((i: any) => `<li>${i.area}: ${i.detail}</li>`).join('') + '</ul>' : ''}
        ${deteriorations.length ? '<h3>注意ポイント</h3><ul>' + deteriorations.map((d: any) => `<li>${d.area}: ${d.detail}</li>`).join('') + '</ul>' : ''}
        <h3>来週の推奨アクション</h3>
        <ol>${recommendations.map((r: any) => `<li><strong>${r.title}</strong>: ${r.description}</li>`).join('')}</ol>`;

      if ((ctx.env as any).RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${(ctx.env as any).RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: (ctx.env as any).RESEND_FROM_EMAIL || 'noreply@bunshin-ai.com',
            to: user.email,
            subject: `【分身AI】ウィークリーレビュー ${review.weekStart}〜${review.weekEnd}`,
            html,
          }),
        });
      }

      await createNotification(ctx.env.DB, ctx.userId, 'weekly_review', 'ウィークリーレビュー', `${review.weekStart}の週次レビューが生成されました`, { link: '/weekly-review' });

      return { sent: true };
    }),




  // ============ Context Switcher ============

  createContextRule: protectedProcedure
    .input(z.object({
      ruleName: z.string(),
      conditionType: z.enum(["industry", "theme_keyword", "friend_attribute", "score_range", "time_of_day"]),
      conditionValue: z.string(),
      actionType: z.enum(["persona", "knowledge_set", "style", "system_prompt_append"]),
      actionValue: z.string(),
      priority: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO context_switch_rules (userId, twinId, ruleName, conditionType, conditionValue, actionType, actionValue, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ctx.userId, twin.id, input.ruleName, input.conditionType, input.conditionValue, input.actionType, input.actionValue, input.priority).run();

      return { id: res.meta?.last_row_id, created: true };
    }),

  listContextRules: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM context_switch_rules WHERE userId=? ORDER BY priority DESC, createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  updateContextRule: protectedProcedure
    .input(z.object({
      ruleId: z.number(),
      ruleName: z.string().optional(),
      conditionValue: z.string().optional(),
      actionValue: z.string().optional(),
      priority: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rule = await ctx.env.DB.prepare(`SELECT * FROM context_switch_rules WHERE id=? AND userId=?`).bind(input.ruleId, ctx.userId).first<any>();
      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });

      const updates: string[] = [];
      const values: any[] = [];
      if (input.ruleName !== undefined) { updates.push('ruleName=?'); values.push(input.ruleName); }
      if (input.conditionValue !== undefined) { updates.push('conditionValue=?'); values.push(input.conditionValue); }
      if (input.actionValue !== undefined) { updates.push('actionValue=?'); values.push(input.actionValue); }
      if (input.priority !== undefined) { updates.push('priority=?'); values.push(input.priority); }
      if (input.isActive !== undefined) { updates.push('isActive=?'); values.push(input.isActive ? 1 : 0); }

      if (updates.length > 0) {
        values.push(input.ruleId);
        await ctx.env.DB.prepare(`UPDATE context_switch_rules SET ${updates.join(', ')} WHERE id=?`).bind(...values).run();
      }
      return { updated: true };
    }),

  deleteContextRule: protectedProcedure
    .input(z.object({ ruleId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM context_switch_rules WHERE id=? AND userId=?`).bind(input.ruleId, ctx.userId).run();
      return { deleted: true };
    }),

  evaluateContextRules: protectedProcedure
    .input(z.object({ theme: z.string(), friendId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

      const rules = await ctx.env.DB.prepare(
        `SELECT * FROM context_switch_rules WHERE userId=? AND isActive=1 ORDER BY priority DESC`
      ).bind(ctx.userId).all<any>();

      let friendProfile: any = null;
      if (input.friendId) {
        friendProfile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(input.friendId).first<any>();
      }

      const appliedRules: any[] = [];
      for (const rule of (rules.results ?? []) as any[]) {
        let matched = false;

        if (rule.conditionType === 'theme_keyword') {
          matched = input.theme.includes(rule.conditionValue);
        } else if (rule.conditionType === 'industry' && friendProfile) {
          matched = (friendProfile.industry || '').includes(rule.conditionValue);
        } else if (rule.conditionType === 'friend_attribute' && friendProfile) {
          const attrs = JSON.stringify(friendProfile);
          matched = attrs.includes(rule.conditionValue);
        }

        if (matched) {
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            conditionType: rule.conditionType,
            conditionValue: rule.conditionValue,
            actionType: rule.actionType,
            actionValue: rule.actionValue,
          });

          // Log the application
          await ctx.env.DB.prepare(
            `INSERT INTO context_switch_logs (ruleId, sessionId, matchedCondition, appliedAction)
             VALUES (?, NULL, ?, ?)`
          ).bind(rule.id, `${rule.conditionType}:${rule.conditionValue}`, `${rule.actionType}:${rule.actionValue}`).run();

          // Increment apply count
          await ctx.env.DB.prepare(`UPDATE context_switch_rules SET applyCount = applyCount + 1 WHERE id=?`).bind(rule.id).run();
        }
      }

      return { appliedRules, totalEvaluated: rules.results?.length || 0 };
    }),

  getContextSwitchLogs: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT csl.*, csr.ruleName FROM context_switch_logs csl
       JOIN context_switch_rules csr ON csr.id = csl.ruleId
       WHERE csr.userId=?
       ORDER BY csl.createdAt DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // ============ Learning Curriculum ============

  generateCurriculum: protectedProcedure
    .input(z.object({ twinId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      // Collect weakness data
      const matchResults = await ctx.env.DB.prepare(
        `SELECT mr.scoreBreakdown, mr.recommendations FROM matching_results mr
         JOIN matching_sessions ms ON ms.id = mr.sessionId
         WHERE ms.initiatorUserId=? ORDER BY mr.createdAt DESC LIMIT 10`
      ).bind(ctx.userId).all<any>();

      const feedbacks = await ctx.env.DB.prepare(
        `SELECT df.rating, df.comment FROM dialogue_feedback df
         JOIN matching_sessions ms ON ms.id = df.sessionId
         WHERE ms.initiatorUserId=? AND df.rating='down' ORDER BY df.createdAt DESC LIMIT 20`
      ).bind(ctx.userId).all<any>();

      const weakKnowledge = await ctx.env.DB.prepare(
        `SELECT title, summary FROM knowledge_base WHERE userId=? ORDER BY createdAt DESC LIMIT 10`
      ).bind(ctx.userId).all<any>();

      const breakdowns = (matchResults.results || []).map((r: any) => parseJson<any>(r.scoreBreakdown)).filter(Boolean);
      const negFeedback = (feedbacks.results || []).map((f: any) => `${f.rating}: ${f.comment || "コメントなし"}`).join("\n");
      const knowledgeList = (weakKnowledge.results || []).map((k: any) => k.title).join(", ");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "curriculum_generation", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM APIキーが未設定です" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはAIツイン学習コーチです。ツインのマッチングスコア分析、ネガティブフィードバック、ナレッジベースを統合的に診断し、弱点を克服するための段階的な学習カリキュラムを生成してください。レッスンは5-10件で、各レッスンに目標・演習テーマ・評価基準を含めてください。" },
        { role: "user", content: `ツイン「${twin.name}」の診断データ:\n\nスコア内訳（直近10件）: ${JSON.stringify(breakdowns)}\n\nネガティブフィードバック:\n${negFeedback || "なし"}\n\nナレッジ: ${knowledgeList || "なし"}\n\nJSON形式で回答:\n{"title":"カリキュラムタイトル","diagnosis":"弱点診断の要約","lessons":[{"index":0,"title":"レッスンタイトル","goal":"目標","exerciseTheme":"演習テーマ","evaluationCriteria":"評価基準","difficulty":"easy|normal|hard"}]}` }
      ], { maxTokens: 3000, temperature: 0.5 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = {
          title: "基礎力強化カリキュラム",
          diagnosis: "データに基づく自動診断",
          lessons: [
            { index: 0, title: "コミュニケーション基礎", goal: "相手の意図を正確に理解する", exerciseTheme: "傾聴力向上", evaluationCriteria: "質問の的確さ", difficulty: "easy" },
            { index: 1, title: "論理的思考", goal: "主張を論理的に構成する", exerciseTheme: "論点整理", evaluationCriteria: "論理の一貫性", difficulty: "normal" },
            { index: 2, title: "提案力強化", goal: "具体的な提案ができる", exerciseTheme: "ソリューション提示", evaluationCriteria: "提案の実現可能性", difficulty: "normal" },
            { index: 3, title: "交渉テクニック", goal: "Win-Winの合意形成", exerciseTheme: "妥協点の発見", evaluationCriteria: "合意率", difficulty: "hard" },
            { index: 4, title: "総合演習", goal: "全スキルの統合", exerciseTheme: "実践マッチング", evaluationCriteria: "総合スコア80点以上", difficulty: "hard" },
          ]
        };
      }

      const lessons = (parsed.lessons || []).map((l: any, i: number) => ({ ...l, index: i }));

      const res = await ctx.env.DB.prepare(
        `INSERT INTO learning_curricula (twinId, userId, title, diagnosis, lessons, currentLessonIndex, status) VALUES (?,?,?,?,?,0,'active')`
      ).bind(twin.id, ctx.userId, parsed.title || "学習カリキュラム", parsed.diagnosis || "", toJson(lessons)).run();

      const curriculumId = res.meta?.last_row_id;
      // Create progress entries for each lesson
      if (curriculumId && lessons.length > 0) {
        const stmts = lessons.map((_: any, i: number) =>
          ctx.env.DB.prepare(`INSERT OR IGNORE INTO curriculum_progress (curriculumId, lessonIndex, status) VALUES (?,?,?)`)
            .bind(curriculumId, i, i === 0 ? "in_progress" : "pending")
        );
        await ctx.env.DB.batch(stmts);
      }

      return { id: curriculumId, title: parsed.title, diagnosis: parsed.diagnosis, lessons, currentLessonIndex: 0 };
    }),

  getCurriculum: protectedProcedure
    .input(z.object({ curriculumId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT * FROM learning_curricula WHERE id=? AND userId=?`
      ).bind(input.curriculumId, ctx.userId).first<any>();
      if (!row) return null;
      const progress = await ctx.env.DB.prepare(
        `SELECT * FROM curriculum_progress WHERE curriculumId=? ORDER BY lessonIndex`
      ).bind(input.curriculumId).all<any>();
      return {
        ...row,
        lessons: parseJson<any[]>(row.lessons) || [],
        progress: progress.results ?? [],
      };
    }),

  listCurricula: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT lc.*, dt.name as twinName FROM learning_curricula lc
       JOIN digital_twins dt ON dt.id = lc.twinId
       WHERE lc.userId=? ORDER BY lc.createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({
      ...r,
      lessons: parseJson<any[]>(r.lessons) || [],
    }));
  }),

  completeLesson: protectedProcedure
    .input(z.object({ curriculumId: z.number(), lessonIndex: z.number(), score: z.number().min(0).max(100).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const curriculum = await ctx.env.DB.prepare(
        `SELECT * FROM learning_curricula WHERE id=? AND userId=?`
      ).bind(input.curriculumId, ctx.userId).first<any>();
      if (!curriculum) throw new TRPCError({ code: "NOT_FOUND" });

      const lessons = parseJson<any[]>(curriculum.lessons) || [];

      // Mark current lesson as completed
      await ctx.env.DB.prepare(
        `UPDATE curriculum_progress SET status='completed', score=?, completedAt=datetime('now') WHERE curriculumId=? AND lessonIndex=?`
      ).bind(input.score ?? 0, input.curriculumId, input.lessonIndex).run();

      // Unlock next lesson
      const nextIndex = input.lessonIndex + 1;
      if (nextIndex < lessons.length) {
        await ctx.env.DB.prepare(
          `UPDATE curriculum_progress SET status='in_progress' WHERE curriculumId=? AND lessonIndex=?`
        ).bind(input.curriculumId, nextIndex).run();
        await ctx.env.DB.prepare(
          `UPDATE learning_curricula SET currentLessonIndex=?, updatedAt=datetime('now') WHERE id=?`
        ).bind(nextIndex, input.curriculumId).run();
      } else {
        // All lessons completed
        await ctx.env.DB.prepare(
          `UPDATE learning_curricula SET status='completed', updatedAt=datetime('now') WHERE id=?`
        ).bind(input.curriculumId).run();
      }

      // Update twin skill levels
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (twin) {
        const lesson = lessons[input.lessonIndex];
        if (lesson) {
          await ctx.env.DB.prepare(
            `INSERT OR REPLACE INTO twin_skill_levels (twinId, skillName, level, xp) VALUES (?,?, COALESCE((SELECT level FROM twin_skill_levels WHERE twinId=? AND skillName=?), 0) + 1, COALESCE((SELECT xp FROM twin_skill_levels WHERE twinId=? AND skillName=?), 0) + ?)`
          ).bind(twin.id, lesson.exerciseTheme || "general", twin.id, lesson.exerciseTheme || "general", twin.id, lesson.exerciseTheme || "general", input.score ?? 50).run();
        }
      }

      return { completed: true, nextLessonIndex: nextIndex < lessons.length ? nextIndex : null, allComplete: nextIndex >= lessons.length };
    }),

  deleteCurriculum: protectedProcedure
    .input(z.object({ curriculumId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM curriculum_progress WHERE curriculumId=?`).bind(input.curriculumId).run();
      await ctx.env.DB.prepare(`DELETE FROM learning_curricula WHERE id=? AND userId=?`).bind(input.curriculumId, ctx.userId).run();
      return { deleted: true };
    }),

  // ============ External Data Connectors ============

  createConnector: protectedProcedure
    .input(z.object({
      serviceType: z.enum(["google_calendar", "notion", "slack", "github", "custom"]),
      serviceName: z.string().min(1),
      config: z.record(z.string(), z.string()).optional(),
      syncSchedule: z.enum(["manual", "daily", "weekly"]).default("manual"),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO external_connectors (userId, twinId, serviceType, serviceName, config, syncSchedule) VALUES (?,?,?,?,?,?)`
      ).bind(ctx.userId, twin.id, input.serviceType, input.serviceName, toJson(input.config || {}), input.syncSchedule).run();

      return { id: res.meta?.last_row_id, serviceType: input.serviceType, serviceName: input.serviceName };
    }),

  listConnectors: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT * FROM external_connectors WHERE userId=? ORDER BY createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, config: parseJson<any>(r.config) || {} }));
  }),

  updateConnector: protectedProcedure
    .input(z.object({
      connectorId: z.number(),
      serviceName: z.string().optional(),
      config: z.record(z.string(), z.string()).optional(),
      syncSchedule: z.enum(["manual", "daily", "weekly"]).optional(),
      status: z.enum(["active", "paused"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const connector = await ctx.env.DB.prepare(`SELECT * FROM external_connectors WHERE id=? AND userId=?`).bind(input.connectorId, ctx.userId).first<any>();
      if (!connector) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.env.DB.prepare(
        `UPDATE external_connectors SET serviceName=COALESCE(?,serviceName), config=COALESCE(?,config), syncSchedule=COALESCE(?,syncSchedule), status=COALESCE(?,status) WHERE id=?`
      ).bind(input.serviceName ?? null, input.config ? toJson(input.config) : null, input.syncSchedule ?? null, input.status ?? null, input.connectorId).run();
      return { updated: true };
    }),

  deleteConnector: protectedProcedure
    .input(z.object({ connectorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM connector_sync_logs WHERE connectorId=?`).bind(input.connectorId).run();
      await ctx.env.DB.prepare(`DELETE FROM external_connectors WHERE id=? AND userId=?`).bind(input.connectorId, ctx.userId).run();
      return { deleted: true };
    }),

  syncConnector: protectedProcedure
    .input(z.object({ connectorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const connector = await ctx.env.DB.prepare(`SELECT * FROM external_connectors WHERE id=? AND userId=?`).bind(input.connectorId, ctx.userId).first<any>();
      if (!connector) throw new TRPCError({ code: "NOT_FOUND" });

      const config = parseJson<any>(connector.config) || {};
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      // Simulate sync based on service type - in production this would call actual APIs
      let itemsSynced = 0;
      let itemsAdded = 0;
      let syncStatus: string = "success";
      let errorMsg: string | null = null;

      try {
        // Generate sample knowledge entries based on connector type
        const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "connector_sync", ctx.env);
        if (!llmConfig) throw new TRPCError({ code: "BAD_REQUEST", message: "LLM APIキーが未設定です" });
        const serviceDescriptions: Record<string, string> = {
          google_calendar: "Googleカレンダーの予定やイベント情報",
          notion: "Notionのページやデータベースの内容",
          slack: "Slackチャンネルの重要なメッセージや決定事項",
          github: "GitHubリポジトリのREADME、Issue、PR情報",
          custom: "カスタムデータソースの情報",
        };

        const result = await invokeLLM(llmConfig, [
          { role: "system", content: "あなたは外部サービスデータの同期エージェントです。指定されたサービスからのデータを整理し、ナレッジベースエントリとして構造化してください。" },
          { role: "user", content: `サービス: ${connector.serviceName} (${connector.serviceType})\n設定: ${JSON.stringify(config)}\n\n${serviceDescriptions[connector.serviceType] || "外部データ"}から3件のナレッジエントリを生成してください。\n\nJSON形式:\n{"entries":[{"title":"タイトル","summary":"要約(200字以内)","tags":["tag1","tag2"]}]}` }
        ], { maxTokens: 1500, temperature: 0.5 });

        let entries: any[] = [];
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) entries = JSON.parse(jsonMatch[0]).entries || [];
        } catch { entries = [{ title: `${connector.serviceName}同期データ`, summary: "同期されたデータ", tags: [connector.serviceType] }]; }

        for (const entry of entries) {
          await ctx.env.DB.prepare(
            `INSERT INTO knowledge_base (userId, twinId, title, content, summary, source, tags, createdAt) VALUES (?,?,?,?,?,?,?,datetime('now'))`
          ).bind(ctx.userId, twin.id, entry.title, entry.summary, entry.summary, `connector:${connector.serviceType}`, toJson(entry.tags || [connector.serviceType])).run();
          itemsAdded++;
        }
        itemsSynced = entries.length;
      } catch (e: any) {
        syncStatus = "error";
        errorMsg = e.message || "同期中にエラーが発生しました";
      }

      // Record sync log
      await ctx.env.DB.prepare(
        `INSERT INTO connector_sync_logs (connectorId, userId, itemsSynced, itemsAdded, itemsUpdated, status, errorMessage) VALUES (?,?,?,?,0,?,?)`
      ).bind(input.connectorId, ctx.userId, itemsSynced, itemsAdded, syncStatus, errorMsg).run();

      // Update connector last sync time
      await ctx.env.DB.prepare(
        `UPDATE external_connectors SET lastSyncAt=datetime('now'), status=? WHERE id=?`
      ).bind(syncStatus === "error" ? "error" : "active", input.connectorId).run();

      return { itemsSynced, itemsAdded, status: syncStatus, error: errorMsg };
    }),

  getConnectorSyncLogs: protectedProcedure
    .input(z.object({ connectorId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT * FROM connector_sync_logs WHERE connectorId=? AND userId=? ORDER BY syncedAt DESC LIMIT 30`
      ).bind(input.connectorId, ctx.userId).all<any>();
      return rows.results ?? [];
    }),

  // ============ Learning Journal ============

  generateJournalEntry: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`
      ).bind(input.sessionId).all<any>();
      const dialogueText = (dialogues.results || []).map((d: any) => `[${d.speaker}]: ${d.content}`).join("\n");

      const result_row = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "journal_entry", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたはデジタルツイン「${twin.name}」です。マッチング対話を振り返り、自分の成長日記を書いてください。一人称（私）で、自分が何を学び、何を失敗し、次回どう改善するかを率直に記録してください。` },
        { role: "user", content: `テーマ: ${session.theme}\nスコア: ${result_row?.compatibilityScore || "不明"}\n\n対話内容:\n${dialogueText}\n\nJSON:\n{"title":"日記タイトル","content":"振り返り本文(200-400字)","lessons":["学び1","学び2","学び3"],"failures":["失敗1"],"improvements":["改善点1","改善点2"]}` }
      ], { maxTokens: 1500, temperature: 0.6 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = { title: `${session.theme}の振り返り`, content: result.content, lessons: [], failures: [], improvements: [] };
      }

      const res = await ctx.env.DB.prepare(
        `INSERT INTO learning_journal_entries (twinId, userId, sessionId, entryType, title, content, lessons, failures, improvements) VALUES (?,?,?,'reflection',?,?,?,?,?)`
      ).bind(
        twin.id, ctx.userId, input.sessionId,
        parsed.title || "振り返り", parsed.content || "",
        toJson(parsed.lessons || []), toJson(parsed.failures || []), toJson(parsed.improvements || [])
      ).run();

      return { id: res.meta?.last_row_id, ...parsed };
    }),

  listJournalEntries: protectedProcedure
    .input(z.object({ entryType: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];

      let query = `SELECT lje.*, ms.theme as sessionTheme FROM learning_journal_entries lje LEFT JOIN matching_sessions ms ON ms.id=lje.sessionId WHERE lje.twinId=?`;
      const binds: any[] = [twin.id];
      if (input?.entryType) { query += ` AND lje.entryType=?`; binds.push(input.entryType); }
      query += ` ORDER BY lje.createdAt DESC LIMIT 30`;

      const rows = await ctx.env.DB.prepare(query).bind(...binds).all<any>();
      return (rows.results ?? []).map((r: any) => ({
        ...r,
        lessons: parseJson<string[]>(r.lessons) || [],
        failures: parseJson<string[]>(r.failures) || [],
        improvements: parseJson<string[]>(r.improvements) || [],
      }));
    }),

  addJournalComment: protectedProcedure
    .input(z.object({ journalEntryId: z.number(), comment: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const entry = await ctx.env.DB.prepare(`SELECT * FROM learning_journal_entries WHERE id=? AND userId=?`).bind(input.journalEntryId, ctx.userId).first<any>();
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO journal_comments (journalEntryId, userId, comment) VALUES (?,?,?)`
      ).bind(input.journalEntryId, ctx.userId, input.comment).run();

      return { id: res.meta?.last_row_id, comment: input.comment };
    }),

  getJournalComments: protectedProcedure
    .input(z.object({ journalEntryId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT jc.*, u.name as userName FROM journal_comments jc JOIN users u ON u.id=jc.userId WHERE jc.journalEntryId=? ORDER BY jc.createdAt ASC`
      ).bind(input.journalEntryId).all<any>();
      return rows.results ?? [];
    }),

  applyJournalFeedback: protectedProcedure
    .input(z.object({ journalEntryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

      const entry = await ctx.env.DB.prepare(`SELECT * FROM learning_journal_entries WHERE id=? AND userId=?`).bind(input.journalEntryId, ctx.userId).first<any>();
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });

      const comments = await ctx.env.DB.prepare(
        `SELECT comment FROM journal_comments WHERE journalEntryId=? AND appliedToTwin=0`
      ).bind(input.journalEntryId).all<any>();

      if (!comments.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "未反映のコメントがありません" });

      const commentTexts = comments.results.map((c: any) => c.comment).join("\n");
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "journal_feedback", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "ユーザーのフィードバックコメントに基づいて、ツインの自己認識を改善するための追記文を生成してください。ツインの説明文(description)に追加する形式で、簡潔に（100字以内）。" },
        { role: "user", content: `現在のツイン説明: ${twin.description || "なし"}\n日記の内容: ${entry.content}\nユーザーコメント:\n${commentTexts}\n\n追記文を1文で:` }
      ], { maxTokens: 200, temperature: 0.3 });

      const addition = result.content.trim();
      const newDesc = (twin.description || "") + "\n" + addition;
      await ctx.env.DB.prepare(`UPDATE digital_twins SET description=? WHERE id=?`).bind(newDesc, twin.id).run();
      await ctx.env.DB.prepare(`UPDATE journal_comments SET appliedToTwin=1 WHERE journalEntryId=?`).bind(input.journalEntryId).run();

      return { applied: true, addition };
    }),

  generateMonthlyReport: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

    const entries = await ctx.env.DB.prepare(
      `SELECT * FROM learning_journal_entries WHERE twinId=? AND createdAt >= datetime('now', '-30 days') ORDER BY createdAt ASC`
    ).bind(twin.id).all<any>();

    if (!entries.results?.length) throw new TRPCError({ code: "BAD_REQUEST", message: "過去30日間の日記がありません" });

    const entrySummaries = entries.results.map((e: any) => `[${e.createdAt}] ${e.title}: ${(e.content || "").slice(0, 100)}`).join("\n");

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "monthly_report", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
    const result = await invokeLLM(llmConfig, [
      { role: "system", content: `デジタルツイン「${twin.name}」の月次成長レポートを生成してください。過去30日間の学習ジャーナルを分析し、成長の軌跡、主要な学び、残課題、来月の推奨目標をまとめてください。` },
      { role: "user", content: `日記一覧(${entries.results.length}件):\n${entrySummaries}\n\nJSON:\n{"title":"月次成長レポート","summary":"総括(200字)","growthAreas":["成長した点1","成長した点2"],"remainingChallenges":["課題1"],"nextMonthGoals":["目標1","目標2"],"overallGrowthScore":75}` }
    ], { maxTokens: 1500, temperature: 0.4 });

    let parsed: any = {};
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = { title: "月次成長レポート", summary: result.content, growthAreas: [], remainingChallenges: [], nextMonthGoals: [], overallGrowthScore: 50 };
    }

    const res = await ctx.env.DB.prepare(
      `INSERT INTO learning_journal_entries (twinId, userId, entryType, title, content, aiSummary) VALUES (?,?,'monthly_report',?,?,?)`
    ).bind(twin.id, ctx.userId, parsed.title || "月次レポート", toJson(parsed), parsed.summary || "").run();

    return { id: res.meta?.last_row_id, ...parsed };
  }),
  // ============ Roleplay Training ============

  startRoleplay: protectedProcedure
    .input(z.object({
      scene: z.enum(["sales", "presentation", "complaint", "interview"]),
      difficulty: z.enum(["beginner", "intermediate", "advanced"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const sceneLabels: Record<string, string> = { sales: "商談", presentation: "プレゼン", complaint: "クレーム対応", interview: "面接" };
      const difficultyLabels: Record<string, string> = { beginner: "初級", intermediate: "中級", advanced: "上級" };
      const roleNames: Record<string, string> = { sales: "見込み顧客", presentation: "審査員", complaint: "不満を持つ顧客", interview: "面接官" };

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "roleplay_training", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは${sceneLabels[input.scene]}シーンの${roleNames[input.scene]}を演じます。難易度: ${difficultyLabels[input.difficulty]}。ツイン「${twin.name}」（性格: ${twin.personality || "不明"}）が練習相手です。まず冒頭の発言を1つだけしてください。` },
        { role: "user", content: `${sceneLabels[input.scene]}シーン（${difficultyLabels[input.difficulty]}）を開始してください。相手役として最初の発言をしてください。\n\nJSON:\n{"opening":"最初の発言","coachingHint":"ツインへのコーチングヒント"}` }
      ], { maxTokens: 500, temperature: 0.7 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed = { opening: result.content, coachingHint: "相手の意図を読み取り、適切に応答しましょう" }; }

      const dialogue = [{ turn: 1, speaker: roleNames[input.scene], content: parsed.opening || result.content, isRole: true }];
      const hints = [{ turn: 1, hint: parsed.coachingHint || "" }];

      const res = await ctx.env.DB.prepare(
        `INSERT INTO roleplay_sessions (twinId, userId, scene, difficulty, roleName, dialogue, coachingHints, status) VALUES (?,?,?,?,?,?,?,'active')`
      ).bind(twin.id, ctx.userId, input.scene, input.difficulty, roleNames[input.scene], toJson(dialogue), toJson(hints)).run();

      return { id: res.meta?.last_row_id, dialogue, coachingHint: parsed.coachingHint || "" };
    }),

  respondRoleplay: protectedProcedure
    .input(z.object({ sessionId: z.number(), message: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM roleplay_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "このセッションは完了済みです" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      const dialogue = parseJson<any[]>(session.dialogue) || [];
      const hints = parseJson<any[]>(session.coachingHints) || [];
      const turnNum = dialogue.length + 1;

      // Add user's response
      dialogue.push({ turn: turnNum, speaker: twin?.name || "ツイン", content: input.message, isRole: false });

      const sceneLabels: Record<string, string> = { sales: "商談", presentation: "プレゼン", complaint: "クレーム対応", interview: "面接" };
      const dialogueText = dialogue.map((d: any) => `[${d.speaker}]: ${d.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "roleplay_training", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは${sceneLabels[session.scene]}シーンの${session.roleName}を演じています。難易度: ${session.difficulty}。会話を続けてください。` },
        { role: "user", content: `会話履歴:\n${dialogueText}\n\n次の応答とコーチングヒントをJSON:\n{"response":"相手役の応答","coachingHint":"次のターンへのヒント","shouldEnd":false}` }
      ], { maxTokens: 500, temperature: 0.6 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { parsed = { response: result.content, coachingHint: "", shouldEnd: dialogue.length >= 10 }; }

      dialogue.push({ turn: turnNum + 1, speaker: session.roleName, content: parsed.response || result.content, isRole: true });
      hints.push({ turn: turnNum + 1, hint: parsed.coachingHint || "" });

      await ctx.env.DB.prepare(
        `UPDATE roleplay_sessions SET dialogue=?, coachingHints=? WHERE id=?`
      ).bind(toJson(dialogue), toJson(hints), input.sessionId).run();

      return { dialogue, coachingHint: parsed.coachingHint || "", shouldEnd: parsed.shouldEnd || dialogue.length >= 12 };
    }),

  endRoleplay: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM roleplay_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      const dialogue = parseJson<any[]>(session.dialogue) || [];
      const sceneLabels: Record<string, string> = { sales: "商談", presentation: "プレゼン", complaint: "クレーム対応", interview: "面接" };
      const dialogueText = dialogue.map((d: any) => `[${d.speaker}]: ${d.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "roleplay_evaluation", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が取得できません" });
      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `${sceneLabels[session.scene]}ロールプレイの評価を行ってください。5軸で0-100点評価し、改善提案と模範回答を提示してください。` },
        { role: "user", content: `シーン: ${sceneLabels[session.scene]}（${session.difficulty}）\n\n対話:\n${dialogueText}\n\nJSON:\n{"scores":{"communication":80,"problemSolving":75,"empathy":70,"expertise":65,"adaptability":60},"overallScore":70,"strengths":["強み1"],"improvements":["改善点1"],"modelAnswer":"模範的な応答例（1ターン分）","summary":"総評"}` }
      ], { maxTokens: 2000, temperature: 0.3 });

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = { scores: { communication: 60, problemSolving: 60, empathy: 60, expertise: 60, adaptability: 60 }, overallScore: 60, strengths: [], improvements: [], modelAnswer: "", summary: result.content };
      }

      await ctx.env.DB.prepare(
        `UPDATE roleplay_sessions SET evaluation=?, status='completed' WHERE id=?`
      ).bind(toJson(parsed), input.sessionId).run();

      // Update twin skill levels
      if (twin) {
        const skillName = `roleplay_${session.scene}`;
        await ctx.env.DB.prepare(
          `INSERT OR REPLACE INTO twin_skill_levels (twinId, skillName, level, xp) VALUES (?, ?, COALESCE((SELECT level FROM twin_skill_levels WHERE twinId=? AND skillName=?), 0) + 1, COALESCE((SELECT xp FROM twin_skill_levels WHERE twinId=? AND skillName=?), 0) + ?)`
        ).bind(twin.id, skillName, twin.id, skillName, twin.id, skillName, parsed.overallScore || 50).run();
      }

      return parsed;
    }),

  getRoleplay: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM roleplay_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, dialogue: parseJson<any[]>(row.dialogue) || [], coachingHints: parseJson<any[]>(row.coachingHints) || [], evaluation: parseJson<any>(row.evaluation) || null };
    }),

  listRoleplays: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, scene, difficulty, roleName, status, createdAt FROM roleplay_sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // === Phase 36: Twin Clone & Fork ===
  cloneTwin: protectedProcedure
    .input(z.object({ twinId: z.number(), newName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=? AND userId=?`).bind(input.twinId, ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const cloneName = input.newName || `${twin.name} (クローン)`;
      const res = await ctx.env.DB.prepare(
        `INSERT INTO digital_twins (userId, name, description, personality, tags, systemPrompt, isPublic, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
      ).bind(ctx.userId, cloneName, twin.description, twin.personality, twin.tags, twin.systemPrompt, 0).run();

      const clonedTwinId = res.meta?.last_row_id;
      await ctx.env.DB.prepare(
        `INSERT INTO twin_clones (sourceType, sourceTwinId, sourceUserId, clonedTwinId, clonedByUserId, diffLog) VALUES (?,?,?,?,?,?)`
      ).bind("clone", input.twinId, ctx.userId, clonedTwinId, ctx.userId, "[]").run();

      return { clonedTwinId, name: cloneName };
    }),

  forkTwin: protectedProcedure
    .input(z.object({ twinId: z.number(), newName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=? AND isPublic=1`).bind(input.twinId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "公開ツインが見つかりません" });
      if (twin.userId === ctx.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分のツインはクローンを使ってください" });

      const forkName = input.newName || `${twin.name} (フォーク)`;
      const res = await ctx.env.DB.prepare(
        `INSERT INTO digital_twins (userId, name, description, personality, tags, systemPrompt, isPublic, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
      ).bind(ctx.userId, forkName, twin.description, twin.personality, twin.tags, twin.systemPrompt, 0).run();

      const clonedTwinId = res.meta?.last_row_id;
      await ctx.env.DB.prepare(
        `INSERT INTO twin_clones (sourceType, sourceTwinId, sourceUserId, clonedTwinId, clonedByUserId, diffLog) VALUES (?,?,?,?,?,?)`
      ).bind("fork", input.twinId, twin.userId, clonedTwinId, ctx.userId, "[]").run();

      // Notify source user
      const cloner = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      await createNotification(ctx.env.DB, twin.userId, "twin_forked", "ツインがフォークされました", `${cloner?.name || "ユーザー"}さんがあなたのツイン「${twin.name}」をフォークしました`, { link: `/twins/${input.twinId}` });

      return { clonedTwinId, name: forkName, sourceOwner: twin.userId };
    }),

  getCloneHistory: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT tc.*, dt_source.name as sourceName, dt_clone.name as cloneName,
        u_source.name as sourceUserName
      FROM twin_clones tc
      LEFT JOIN digital_twins dt_source ON dt_source.id = tc.sourceTwinId
      LEFT JOIN digital_twins dt_clone ON dt_clone.id = tc.clonedTwinId
      LEFT JOIN users u_source ON u_source.id = tc.sourceUserId
      WHERE tc.clonedByUserId=?
      ORDER BY tc.createdAt DESC LIMIT 20
    `).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, diffLog: parseJson<any[]>(r.diffLog) || [] }));
  }),

  getCloneDiff: protectedProcedure
    .input(z.object({ cloneId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const clone = await ctx.env.DB.prepare(`SELECT * FROM twin_clones WHERE id=? AND clonedByUserId=?`).bind(input.cloneId, ctx.userId).first<any>();
      if (!clone) throw new TRPCError({ code: "NOT_FOUND" });

      const source = await ctx.env.DB.prepare(`SELECT name, description, personality, tags, systemPrompt FROM digital_twins WHERE id=?`).bind(clone.sourceTwinId).first<any>();
      const cloned = await ctx.env.DB.prepare(`SELECT name, description, personality, tags, systemPrompt FROM digital_twins WHERE id=?`).bind(clone.clonedTwinId).first<any>();

      if (!source || !cloned) return { clone, diffs: [], source: null, cloned: null };

      const fields = ["name", "description", "personality", "tags", "systemPrompt"] as const;
      const diffs = fields.filter(f => (source as any)[f] !== (cloned as any)[f]).map(f => ({
        field: f,
        source: (source as any)[f]?.substring(0, 200) || "",
        cloned: (cloned as any)[f]?.substring(0, 200) || "",
      }));

      return { clone: { ...clone, diffLog: parseJson<any[]>(clone.diffLog) || [] }, diffs, source, cloned };
    }),

  sendForkFeedback: protectedProcedure
    .input(z.object({ cloneId: z.number(), message: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const clone = await ctx.env.DB.prepare(`SELECT * FROM twin_clones WHERE id=? AND clonedByUserId=? AND sourceType='fork'`).bind(input.cloneId, ctx.userId).first<any>();
      if (!clone) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.env.DB.prepare(`UPDATE twin_clones SET feedbackMessage=? WHERE id=?`).bind(input.message, input.cloneId).run();

      const sender = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      await createNotification(ctx.env.DB, clone.sourceUserId, "fork_feedback", "フォークからのフィードバック", `${sender?.name || "ユーザー"}さんからフィードバック: ${input.message.substring(0, 100)}`, { link: `/twins/${clone.sourceTwinId}` });

      return { success: true };
    }),

  listForkFeedback: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`
      SELECT tc.id, tc.sourceTwinId, tc.clonedTwinId, tc.feedbackMessage, tc.createdAt,
        dt.name as cloneName, u.name as forkerName
      FROM twin_clones tc
      JOIN digital_twins dt ON dt.id = tc.clonedTwinId
      JOIN users u ON u.id = tc.clonedByUserId
      WHERE tc.sourceUserId=? AND tc.sourceType='fork' AND tc.feedbackMessage IS NOT NULL
      ORDER BY tc.createdAt DESC LIMIT 20
    `).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),


  // === Phase 37: Rehearsal Mode ===
  startRehearsal: protectedProcedure
    .input(z.object({ theme: z.string().min(1), friendId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      let opponentContext = "ビジネスパートナー";
      if (input.friendId) {
        const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
        if (friendTwin) opponentContext = `${friendTwin.name}: ${friendTwin.description?.substring(0, 200) || ""}`;
      }

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "rehearsal", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは「${opponentContext}」の役割を演じてください。テーマ「${input.theme}」について、ビジネス対話の相手として現実的な発言をしてください。日本語で最初の発言を1つだけ返してください。` },
        { role: "user", content: `テーマ: ${input.theme}\nリハーサルを始めましょう。相手役として最初の発言をお願いします。` }
      ], { maxTokens: 500 });

      const dialogue = [{ turnNumber: 1, role: "opponent", message: result.content }];

      const res = await ctx.env.DB.prepare(
        `INSERT INTO rehearsal_sessions (userId, twinId, friendId, theme, dialogue, status) VALUES (?,?,?,?,?,?)`
      ).bind(ctx.userId, twin.id, input.friendId || null, input.theme, toJson(dialogue), "active").run();

      return { sessionId: res.meta?.last_row_id, dialogue };
    }),

  respondRehearsal: protectedProcedure
    .input(z.object({ sessionId: z.number(), message: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM rehearsal_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "セッションは終了しています" });

      const dialogue = parseJson<any[]>(session.dialogue) || [];
      const turnNumber = dialogue.length + 1;
      dialogue.push({ turnNumber, role: "user", message: input.message });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "rehearsal_respond", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const messages = dialogue.map((d: any) => ({
        role: d.role === "user" ? "user" as const : "assistant" as const,
        message: d.message
      }));

      const historyMessages = [
        { role: "system" as const, content: `あなたはビジネス対話の相手役です。テーマ「${session.theme}」について現実的で建設的な対話をしてください。日本語で応答してください。` },
        ...messages.map((m: any) => ({ role: m.role, content: m.message }))
      ];

      const result = await invokeLLM(llmConfig, historyMessages, { maxTokens: 500 });

      const opponentTurn = turnNumber + 1;
      dialogue.push({ turnNumber: opponentTurn, role: "opponent", message: result.content });

      await ctx.env.DB.prepare(`UPDATE rehearsal_sessions SET dialogue=? WHERE id=?`).bind(toJson(dialogue), input.sessionId).run();

      return { dialogue, opponentMessage: result.content };
    }),

  endRehearsal: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM rehearsal_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const dialogue = parseJson<any[]>(session.dialogue) || [];
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "rehearsal_evaluate", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const dialogueText = dialogue.map((d: any) => `${d.role === "user" ? "ユーザー" : "相手"}: ${d.message}`).join("\n");

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "あなたはビジネス対話コーチです。以下のリハーサル対話を評価してください。JSON形式: { \"readinessScore\": 0-100の準備度, \"strengths\": [\"強み1\",\"強み2\"], \"weaknesses\": [\"弱点1\",\"弱点2\"], \"improvements\": [\"改善1\",\"改善2\"], \"modelResponses\": [\"模範回答例1\"], \"strategyTips\": \"本番への戦略アドバイス\" }" },
        { role: "user", content: `テーマ: ${session.theme}\n\n対話:\n${dialogueText}` }
      ], { maxTokens: 1500 });

      let evaluation: any = { readinessScore: 50, strengths: [], weaknesses: [], improvements: [result.content], modelResponses: [], strategyTips: "" };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) evaluation = JSON.parse(jsonMatch[0]);
      } catch {}

      const score = evaluation.readinessScore || 50;
      await ctx.env.DB.prepare(
        `UPDATE rehearsal_sessions SET status='completed', readinessScore=?, evaluation=? WHERE id=?`
      ).bind(score, toJson(evaluation), input.sessionId).run();

      return { readinessScore: score, evaluation };
    }),

  getRehearsal: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM rehearsal_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!row) return null;
      return { ...row, dialogue: parseJson<any[]>(row.dialogue) || [], evaluation: parseJson<any>(row.evaluation) || null };
    }),

  listRehearsals: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, theme, status, readinessScore, friendId, createdAt FROM rehearsal_sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // === Phase 37: Emotion Calibration ===
  getEmotionCalibration: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    if (!twin) return [];
    const rows = await ctx.env.DB.prepare(
      `SELECT ec.*, u.name as friendName FROM emotion_calibration ec LEFT JOIN users u ON u.id = ec.targetFriendId WHERE ec.userId=? AND ec.twinId=? ORDER BY ec.updatedAt DESC`
    ).bind(ctx.userId, twin.id).all<any>();
    return rows.results ?? [];
  }),

  saveEmotionCalibration: protectedProcedure
    .input(z.object({
      empathy: z.number().min(0).max(100),
      aggression: z.number().min(0).max(100),
      optimism: z.number().min(0).max(100),
      caution: z.number().min(0).max(100),
      humor: z.number().min(0).max(100),
      presetName: z.string().optional(),
      targetFriendId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO emotion_calibration (userId, twinId, empathy, aggression, optimism, caution, humor, presetName, targetFriendId) VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(ctx.userId, twin.id, input.empathy, input.aggression, input.optimism, input.caution, input.humor, input.presetName || null, input.targetFriendId || null).run();

      return { id: res.meta?.last_row_id, success: true };
    }),

  previewEmotionCalibration: protectedProcedure
    .input(z.object({
      empathy: z.number().min(0).max(100),
      aggression: z.number().min(0).max(100),
      optimism: z.number().min(0).max(100),
      caution: z.number().min(0).max(100),
      humor: z.number().min(0).max(100),
      samplePrompt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "emotion_preview", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const emotionInstructions = `感情パラメータに基づいて応答してください:
- 共感度: ${input.empathy}/100 (${input.empathy > 70 ? "非常に共感的" : input.empathy > 40 ? "適度に共感" : "クール"})
- 攻撃性: ${input.aggression}/100 (${input.aggression > 70 ? "主張が強い" : input.aggression > 40 ? "適度に主張" : "穏やか"})
- 楽観度: ${input.optimism}/100 (${input.optimism > 70 ? "非常にポジティブ" : input.optimism > 40 ? "バランス型" : "慎重・現実的"})
- 慎重さ: ${input.caution}/100 (${input.caution > 70 ? "非常に慎重" : input.caution > 40 ? "適度に慎重" : "大胆"})
- ユーモア度: ${input.humor}/100 (${input.humor > 70 ? "ユーモアたっぷり" : input.humor > 40 ? "時々ユーモア" : "真面目"})`;

      const prompt = input.samplePrompt || "新しいビジネスパートナーシップについて提案されました。どう思いますか？";

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: `あなたは「${twin.name}」というデジタルツインです。${twin.description || ""}\n\n${emotionInstructions}\n\n上記の感情パラメータを反映した口調・内容で返答してください。` },
        { role: "user", content: prompt }
      ], { maxTokens: 500 });

      return { response: result.content, prompt };
    }),

  deleteEmotionCalibration: protectedProcedure
    .input(z.object({ calibrationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM emotion_calibration WHERE id=? AND userId=?`).bind(input.calibrationId, ctx.userId).run();
      return { success: true };
    }),

  applyEmotionCalibration: protectedProcedure
    .input(z.object({ calibrationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const cal = await ctx.env.DB.prepare(`SELECT * FROM emotion_calibration WHERE id=? AND userId=?`).bind(input.calibrationId, ctx.userId).first<any>();
      if (!cal) throw new TRPCError({ code: "NOT_FOUND" });

      const emotionPrompt = `\n[感情設定] 共感度:${cal.empathy} 攻撃性:${cal.aggression} 楽観度:${cal.optimism} 慎重さ:${cal.caution} ユーモア:${cal.humor}`;

      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=? AND userId=?`).bind(cal.twinId, ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND" });

      // Remove any existing emotion setting block and append new one
      let prompt = (twin.systemPrompt || "").replace(/\n\[感情設定\].*$/m, "");
      prompt += emotionPrompt;

      await ctx.env.DB.prepare(`UPDATE digital_twins SET systemPrompt=?, updatedAt=datetime('now') WHERE id=?`).bind(prompt, cal.twinId).run();

      return { success: true, appliedTo: twin.name };
    }),
  // === Phase 38: Knowledge Graph Builder ===
  buildKnowledgeGraph: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // Collect data sources
    const knowledge = await ctx.env.DB.prepare(`SELECT title, content, summary FROM knowledge_base WHERE twinId=? LIMIT 30`).bind(twin.id).all<any>();
    const chats = await ctx.env.DB.prepare(`SELECT message FROM chat_messages WHERE sessionId IN (SELECT id FROM chat_sessions WHERE userId=?) ORDER BY createdAt DESC LIMIT 50`).bind(ctx.userId).all<any>();
    const matchDialogues = await ctx.env.DB.prepare(`SELECT md.message FROM matching_dialogues md JOIN matching_sessions ms ON ms.id=md.sessionId WHERE ms.initiatorUserId=? ORDER BY md.createdAt DESC LIMIT 50`).bind(ctx.userId).all<any>();

    const knowledgeText = (knowledge.results ?? []).map((k: any) => `${k.title}: ${k.summary || k.content?.substring(0, 200)}`).join("\n");
    const chatText = (chats.results ?? []).map((c: any) => c.message?.substring(0, 100)).join("\n");
    const matchText = (matchDialogues.results ?? []).map((m: any) => m.message?.substring(0, 100)).join("\n");

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "knowledge_graph", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

    const result = await invokeLLM(llmConfig, [
      { role: "system", content: "あなたは知識構造化の専門家です。以下のデータからナレッジグラフを構築してください。JSON形式: { \"nodes\": [{ \"id\": \"node1\", \"label\": \"概念名\", \"type\": \"concept|person|skill|industry|topic\", \"weight\": 1-10 }], \"edges\": [{ \"source\": \"node1\", \"target\": \"node2\", \"relation\": \"関連|含む|必要|応用|類似\", \"strength\": 1-10 }], \"gaps\": [{ \"area\": \"知識の穴の領域\", \"severity\": \"high|medium|low\", \"recommendation\": \"学習推奨\" }], \"stats\": { \"totalNodes\": 0, \"totalEdges\": 0, \"densestArea\": \"最も密な領域\", \"sparsestArea\": \"最も疎な領域\" } }" },
      { role: "user", content: `ナレッジベース:\n${knowledgeText || "なし"}\n\nチャット履歴:\n${chatText || "なし"}\n\nマッチング対話:\n${matchText || "なし"}` }
    ], { maxTokens: 3000 });

    let parsed: any = { nodes: [], edges: [], gaps: [], stats: {} };
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { parsed.gaps = [{ area: "解析エラー", severity: "low", recommendation: result.content }]; }

    await ctx.env.DB.prepare(
      `INSERT OR REPLACE INTO twin_knowledge_graphs (userId, twinId, nodes, edges, gaps, recommendations, stats, updatedAt) VALUES (?,?,?,?,?,?,?,datetime('now'))`
    ).bind(ctx.userId, twin.id, toJson(parsed.nodes || []), toJson(parsed.edges || []), toJson(parsed.gaps || []), toJson(parsed.gaps?.map((g: any) => g.recommendation) || []), toJson(parsed.stats || {})).run();

    return parsed;
  }),

  getKnowledgeGraphData: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    if (!twin) return null;
    const row = await ctx.env.DB.prepare(`SELECT * FROM twin_knowledge_graphs WHERE userId=? AND twinId=?`).bind(ctx.userId, twin.id).first<any>();
    if (!row) return null;
    return {
      ...row,
      nodes: parseJson<any[]>(row.nodes) || [],
      edges: parseJson<any[]>(row.edges) || [],
      gaps: parseJson<any[]>(row.gaps) || [],
      recommendations: parseJson<any[]>(row.recommendations) || [],
      stats: parseJson<any>(row.stats) || {},
    };
  }),

  compareKnowledgeGraphs: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const myGraph = await ctx.env.DB.prepare(`SELECT * FROM twin_knowledge_graphs WHERE userId=?`).bind(ctx.userId).first<any>();
      const friendGraph = await ctx.env.DB.prepare(`SELECT * FROM twin_knowledge_graphs WHERE userId=?`).bind(input.friendId).first<any>();

      if (!myGraph || !friendGraph) throw new TRPCError({ code: "NOT_FOUND", message: "両者のナレッジグラフが必要です。先にグラフを構築してください" });

      const myNodes = parseJson<any[]>(myGraph.nodes) || [];
      const friendNodes = parseJson<any[]>(friendGraph.nodes) || [];

      const myLabels = new Set(myNodes.map((n: any) => n.label?.toLowerCase()));
      const friendLabels = new Set(friendNodes.map((n: any) => n.label?.toLowerCase()));

      const common = Array.from(myLabels).filter(l => friendLabels.has(l));
      const myOnly = Array.from(myLabels).filter(l => !friendLabels.has(l));
      const friendOnly = Array.from(friendLabels).filter(l => !myLabels.has(l));
      const overlapRate = myLabels.size > 0 ? Math.round((common.length / myLabels.size) * 100) : 0;

      return { common, myOnly, friendOnly, overlapRate, myNodeCount: myLabels.size, friendNodeCount: friendLabels.size };
    }),

  getKnowledgeGaps: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    if (!twin) return [];
    const row = await ctx.env.DB.prepare(`SELECT gaps FROM twin_knowledge_graphs WHERE userId=? AND twinId=?`).bind(ctx.userId, twin.id).first<any>();
    if (!row) return [];
    return parseJson<any[]>(row.gaps) || [];
  }),

  getKnowledgeGraphStats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    if (!twin) return null;
    const row = await ctx.env.DB.prepare(`SELECT stats, updatedAt FROM twin_knowledge_graphs WHERE userId=? AND twinId=?`).bind(ctx.userId, twin.id).first<any>();
    if (!row) return null;
    return { ...parseJson<any>(row.stats) || {}, updatedAt: row.updatedAt };
  }),



  // === Phase 39: Multimodal Input Learning ===
  processVoiceInput: protectedProcedure
    .input(z.object({ transcript: z.string().min(1), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "voice_process", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "音声メモのテキストを構造化してナレッジベースに追加できる形にまとめてください。JSON形式: { \"title\": \"タイトル\", \"summary\": \"要約（200文字以内）\", \"keyPoints\": [\"ポイント1\"], \"processedText\": \"整理されたテキスト\" }" },
        { role: "user", content: input.transcript }
      ], { maxTokens: 1000 });

      let processed: any = { title: input.title || "音声メモ", summary: input.transcript.substring(0, 200), keyPoints: [], processedText: input.transcript };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) processed = JSON.parse(jsonMatch[0]);
      } catch {}

      const kbRes = await ctx.env.DB.prepare(
        `INSERT INTO knowledge_base (twinId, title, content, summary, sourceType) VALUES (?,?,?,?,?)`
      ).bind(twin.id, processed.title || "音声メモ", processed.processedText || input.transcript, processed.summary || "", "voice").run();

      const mmRes = await ctx.env.DB.prepare(
        `INSERT INTO multimodal_inputs (userId, twinId, inputType, rawContent, processedText, knowledgeEntryId) VALUES (?,?,?,?,?,?)`
      ).bind(ctx.userId, twin.id, "voice", input.transcript, processed.processedText || input.transcript, kbRes.meta?.last_row_id || null).run();

      return { id: mmRes.meta?.last_row_id, knowledgeEntryId: kbRes.meta?.last_row_id, processed };
    }),

  processImageInput: protectedProcedure
    .input(z.object({ imageDescription: z.string().min(1), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "image_process", ctx.env);
      if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

      const result = await invokeLLM(llmConfig, [
        { role: "system", content: "画像から抽出されたテキスト/説明を構造化してナレッジベースに追加できる形にまとめてください。JSON形式: { \"title\": \"タイトル\", \"summary\": \"要約\", \"processedText\": \"整理テキスト\", \"tags\": [\"タグ\"] }" },
        { role: "user", content: input.imageDescription }
      ], { maxTokens: 1000 });

      let processed: any = { title: input.title || "画像メモ", summary: input.imageDescription.substring(0, 200), processedText: input.imageDescription, tags: [] };
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) processed = JSON.parse(jsonMatch[0]);
      } catch {}

      const kbRes = await ctx.env.DB.prepare(
        `INSERT INTO knowledge_base (twinId, title, content, summary, sourceType) VALUES (?,?,?,?,?)`
      ).bind(twin.id, processed.title || "画像メモ", processed.processedText || input.imageDescription, processed.summary || "", "image").run();

      const mmRes = await ctx.env.DB.prepare(
        `INSERT INTO multimodal_inputs (userId, twinId, inputType, rawContent, processedText, knowledgeEntryId) VALUES (?,?,?,?,?,?)`
      ).bind(ctx.userId, twin.id, "image", input.imageDescription, processed.processedText || input.imageDescription, kbRes.meta?.last_row_id || null).run();

      return { id: mmRes.meta?.last_row_id, knowledgeEntryId: kbRes.meta?.last_row_id, processed };
    }),

  getMultimodalStats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    if (!twin) return { voice: 0, image: 0, screenshot: 0, total: 0, avgAccuracy: null };

    const rows = await ctx.env.DB.prepare(`
      SELECT inputType, COUNT(*) as count, AVG(accuracy) as avgAcc
      FROM multimodal_inputs WHERE userId=? AND twinId=? GROUP BY inputType
    `).bind(ctx.userId, twin.id).all<any>();

    const stats: Record<string, number> = { voice: 0, image: 0, screenshot: 0 };
    let totalAcc = 0; let accCount = 0;
    for (const r of (rows.results ?? []) as any[]) {
      stats[r.inputType] = r.count || 0;
      if (r.avgAcc) { totalAcc += r.avgAcc * r.count; accCount += r.count; }
    }
    return { ...stats, total: Object.values(stats).reduce((a, b) => a + b, 0), avgAccuracy: accCount > 0 ? Math.round(totalAcc / accCount) : null };
  }),

  listMultimodalInputs: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT id, inputType, rawContent, processedText, accuracy, feedbackRating, createdAt FROM multimodal_inputs WHERE userId=? ORDER BY createdAt DESC LIMIT 30`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),

  // ============ FAQ Generation ============

  generateFaq: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // Gather knowledge + matching dialogues
    const knowledge = await ctx.env.DB.prepare(
      `SELECT title, content, summary FROM knowledge_base WHERE twinId=? LIMIT 20`
    ).bind(twin.id).all<any>();

    const dialogues = await ctx.env.DB.prepare(
      `SELECT md.content, md.speakerTwinId FROM matching_dialogues md
       JOIN matching_sessions ms ON md.sessionId=ms.id
       WHERE (ms.twin1Id=? OR ms.twin2Id=?) ORDER BY md.id DESC LIMIT 30`
    ).bind(twin.id, twin.id).all<any>();

    const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "faq_generation", ctx.env);
    if (!llmConfig) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM設定が見つかりません" });

    const knowledgeText = (knowledge.results ?? []).map((k: any) => `[${k.title}] ${k.summary || k.content?.slice(0, 200)}`).join("\n");
    const dialogueText = (dialogues.results ?? []).map((d: any) => d.content?.slice(0, 150)).join("\n");

    const result = await invokeLLM(llmConfig, [
      { role: "system", content: `あなたはFAQ生成の専門家です。ツインの知識ベースと対話パターンから、よく聞かれそうな質問と回答を10件生成してください。ビジネスマッチングの文脈で有用なFAQにしてください。JSON形式: { "faqs": [{ "question": "質問", "answer": "回答" }] }` },
      { role: "user", content: `ツイン名: ${twin.name}\n説明: ${twin.description || ""}\n人格: ${twin.personality || ""}\n\nナレッジ:\n${knowledgeText}\n\n対話パターン:\n${dialogueText}` }
    ], { maxTokens: 2000 });

    let faqs: { question: string; answer: string }[] = [];
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        faqs = (parsed.faqs || []).slice(0, 10);
      }
    } catch {}

    if (!faqs.length) {
      faqs = [{ question: "このツインは何ができますか？", answer: twin.description || "ビジネスマッチングのお手伝いをします。" }];
    }

    // Delete old FAQs and insert new ones
    await ctx.env.DB.prepare(`DELETE FROM twin_faqs WHERE twinId=? AND userId=?`).bind(twin.id, ctx.userId).run();

    for (let i = 0; i < faqs.length; i++) {
      await ctx.env.DB.prepare(
        `INSERT INTO twin_faqs (twinId, userId, question, answer, sortOrder) VALUES (?,?,?,?,?)`
      ).bind(twin.id, ctx.userId, faqs[i].question, faqs[i].answer, i).run();
    }

    return { count: faqs.length, faqs };
  }),

  getFaqs: protectedProcedure
    .input(z.object({ twinId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twinId = input?.twinId;
      let rows;
      if (twinId) {
        rows = await ctx.env.DB.prepare(
          `SELECT * FROM twin_faqs WHERE twinId=? AND isPublic=1 ORDER BY sortOrder ASC`
        ).bind(twinId).all<any>();
      } else {
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) return [];
        rows = await ctx.env.DB.prepare(
          `SELECT * FROM twin_faqs WHERE twinId=? AND userId=? ORDER BY sortOrder ASC`
        ).bind(twin.id, ctx.userId).all<any>();
      }
      return rows.results ?? [];
    }),

  toggleFaqPublic: protectedProcedure
    .input(z.object({ faqId: z.number(), isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE twin_faqs SET isPublic=? WHERE id=? AND userId=?`
      ).bind(input.isPublic ? 1 : 0, input.faqId, ctx.userId).run();
      return { updated: true };
    }),

  deleteFaq: protectedProcedure
    .input(z.object({ faqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM twin_faqs WHERE id=? AND userId=?`
      ).bind(input.faqId, ctx.userId).run();
      return { deleted: true };
    }),


  getPublicFaqs: protectedProcedure
    .input(z.object({ twinId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT id, question, answer, sortOrder FROM twin_faqs WHERE twinId=? AND isPublic=1 ORDER BY sortOrder ASC`
      ).bind(input.twinId).all<any>();
      return rows.results ?? [];
    }),


  // ============ Twin Template Gallery ============

  createTemplate: protectedProcedure
    .input(z.object({ name: z.string(), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: 'NOT_FOUND', message: 'ツインが見つかりません' });
      const stmt = await ctx.env.DB.prepare(
        `INSERT INTO twin_templates (userId, twinId, name, description, personality, systemPrompt, tags) VALUES (?,?,?,?,?,?,?)`
      ).bind(ctx.userId, twin.id, input.name, input.description || '', twin.personality || '', twin.systemPrompt || '', twin.tags || '').run();
      return { id: (stmt.meta as any)?.last_row_id, name: input.name };
    }),

  listTemplates: protectedProcedure
    .input(z.object({ publicOnly: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const publicOnly = input?.publicOnly ?? false;
      let rows;
      if (publicOnly) {
        rows = await ctx.env.DB.prepare(
          `SELECT tt.*, u.name as authorName FROM twin_templates tt LEFT JOIN users u ON u.id=tt.userId WHERE tt.isPublic=1 ORDER BY tt.useCount DESC, tt.createdAt DESC LIMIT 50`
        ).all<any>();
      } else {
        rows = await ctx.env.DB.prepare(
          `SELECT tt.*, u.name as authorName FROM twin_templates tt LEFT JOIN users u ON u.id=tt.userId WHERE tt.userId=? OR tt.isPublic=1 ORDER BY tt.useCount DESC, tt.createdAt DESC LIMIT 50`
        ).bind(ctx.userId).all<any>();
      }
      return rows.results ?? [];
    }),

  getTemplate: protectedProcedure
    .input(z.object({ templateId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(
        `SELECT tt.*, u.name as authorName FROM twin_templates tt LEFT JOIN users u ON u.id=tt.userId WHERE tt.id=?`
      ).bind(input.templateId).first<any>();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  applyTemplate: protectedProcedure
    .input(z.object({ templateId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const template = await ctx.env.DB.prepare(`SELECT * FROM twin_templates WHERE id=?`).bind(input.templateId).first<any>();
      if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'テンプレートが見つかりません' });
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: 'NOT_FOUND', message: 'ツインが見つかりません' });
      await ctx.env.DB.prepare(
        `UPDATE digital_twins SET personality=?, systemPrompt=?, tags=?, updatedAt=datetime('now') WHERE id=?`
      ).bind(template.personality || '', template.systemPrompt || '', template.tags || '', twin.id).run();
      await ctx.env.DB.prepare(`UPDATE twin_templates SET useCount=useCount+1 WHERE id=?`).bind(input.templateId).run();
      return { applied: true, templateName: template.name };
    }),

  toggleTemplatePublic: protectedProcedure
    .input(z.object({ templateId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const template = await ctx.env.DB.prepare(`SELECT * FROM twin_templates WHERE id=? AND userId=?`).bind(input.templateId, ctx.userId).first<any>();
      if (!template) throw new TRPCError({ code: 'NOT_FOUND' });
      const newVal = template.isPublic ? 0 : 1;
      await ctx.env.DB.prepare(`UPDATE twin_templates SET isPublic=?, updatedAt=datetime('now') WHERE id=?`).bind(newVal, input.templateId).run();
      return { isPublic: newVal === 1 };
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ templateId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`DELETE FROM twin_templates WHERE id=? AND userId=?`).bind(input.templateId, ctx.userId).run();
      return { deleted: true };
    }),


  // ============ Public Embed Card ============

  getEmbedCardData: protectedProcedure
    .input(z.object({ twinId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      let twin: any;
      if (input?.twinId) {
        twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(input.twinId).first<any>();
      } else {
        twin = await getMyTwin(ctx.env.DB, ctx.userId);
      }
      if (!twin) return null;
      const user = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(twin.userId).first<any>();
      const profile = await ctx.env.DB.prepare(`SELECT displayName, company, position, avatarUrl FROM user_profiles WHERE userId=?`).bind(twin.userId).first<any>();
      const faqCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM twin_faqs WHERE twinId=? AND isPublic=1`).bind(twin.id).first<any>();
      const matchCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`).bind(twin.userId).first<any>();

      return {
        twinId: twin.id,
        userId: twin.userId,
        twinName: twin.name || 'ツイン',
        userName: profile?.displayName || user?.name || 'ユーザー',
        company: profile?.company || '',
        position: profile?.position || '',
        avatarUrl: profile?.avatarUrl || '',
        description: (twin.description || '').substring(0, 120),
        tags: (twin.tags || '').split(',').filter(Boolean).slice(0, 5),
        faqCount: faqCount?.cnt || 0,
        matchCount: matchCount?.cnt || 0,
      };
    }),

  healthCheck: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const twin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

    // 1. Personality completeness (personality text length, bigFiveTraits, mbtiType, systemPrompt)
    const personalityLength = (twin.personality || "").length;
    const bigFive = parseJson<any>(twin.bigFiveTraits);
    const hasBigFive = bigFive && Object.keys(bigFive).length >= 5;
    const hasMbti = !!(twin.mbtiType && twin.mbtiType.length === 4);
    const hasSystemPrompt = (twin.systemPrompt || "").length > 50;
    const hasDescription = (twin.description || "").length > 20;
    const hasTags = (twin.tags || "").split(",").filter(Boolean).length >= 3;

    let personalityScore = 1;
    if (personalityLength > 30) personalityScore = 2;
    if (personalityLength > 100 && hasDescription) personalityScore = 3;
    if (personalityScore === 3 && (hasBigFive || hasMbti)) personalityScore = 4;
    if (hasBigFive && hasMbti && hasSystemPrompt && hasTags) personalityScore = 5;

    // 2. Knowledge count
    const knowledgeCount = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM knowledge_base WHERE userId=?`
    ).bind(ctx.userId).first<any>();
    const kCount = knowledgeCount?.cnt || 0;
    let knowledgeScore = 1;
    if (kCount >= 1) knowledgeScore = 2;
    if (kCount >= 3) knowledgeScore = 3;
    if (kCount >= 7) knowledgeScore = 4;
    if (kCount >= 15) knowledgeScore = 5;

    // 3. FAQ count (twin_faqs table)
    let faqCount = 0;
    try {
      const faqResult = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM twin_faqs WHERE twinId=?`
      ).bind(twin.id).first<any>();
      faqCount = faqResult?.cnt || 0;
    } catch {}
    let faqScore = 1;
    if (faqCount >= 1) faqScore = 2;
    if (faqCount >= 3) faqScore = 3;
    if (faqCount >= 5) faqScore = 4;
    if (faqCount >= 10) faqScore = 5;

    // 4. Matching experience count
    const matchResult = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=?`
    ).bind(ctx.userId).first<any>();
    const matchCount = matchResult?.cnt || 0;
    let matchingScore = 1;
    if (matchCount >= 1) matchingScore = 2;
    if (matchCount >= 5) matchingScore = 3;
    if (matchCount >= 15) matchingScore = 4;
    if (matchCount >= 30) matchingScore = 5;

    // 5. Feedback integration rate (dialogue_feedback where userId=ctx.userId)
    let feedbackTotal = 0;
    let feedbackApplied = 0;
    try {
      const fbResult = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM dialogue_feedback WHERE userId=?`
      ).bind(ctx.userId).first<any>();
      feedbackTotal = fbResult?.cnt || 0;
    } catch {}
    // Check if applyFeedback has been used (twin personality updated after feedback)
    // Use growth events as proxy
    try {
      const appliedResult = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM twin_evolution_events WHERE twinId=? AND eventType='feedback_applied'`
      ).bind(twin.id).first<any>();
      feedbackApplied = appliedResult?.cnt || 0;
    } catch {}
    const feedbackRate = feedbackTotal > 0 ? Math.round((feedbackApplied / Math.max(feedbackTotal, 1)) * 100) : 0;
    let feedbackScore = 1;
    if (feedbackTotal >= 1) feedbackScore = 2;
    if (feedbackTotal >= 5 && feedbackRate >= 20) feedbackScore = 3;
    if (feedbackTotal >= 10 && feedbackRate >= 40) feedbackScore = 4;
    if (feedbackTotal >= 20 && feedbackRate >= 60) feedbackScore = 5;

    // Overall score (average)
    const dimensions = [
      { key: "personality", label: "人格設定", score: personalityScore, max: 5 },
      { key: "knowledge", label: "ナレッジ", score: knowledgeScore, max: 5 },
      { key: "faq", label: "FAQ", score: faqScore, max: 5 },
      { key: "matching", label: "マッチング経験", score: matchingScore, max: 5 },
      { key: "feedback", label: "フィードバック反映", score: feedbackScore, max: 5 },
    ];
    const overallScore = Math.round((dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length) * 10) / 10;

    // Generate improvement actions
    const actions: Array<{ key: string; label: string; description: string; priority: "high" | "medium" | "low"; actionPath: string; completed: boolean }> = [];

    if (personalityScore < 3) {
      actions.push({ key: "add_personality", label: "人格設定を充実させる", description: "ツインの性格・説明文・タグを追加してください（100文字以上推奨）", priority: "high", actionPath: "/twins", completed: false });
    }
    if (!hasBigFive) {
      actions.push({ key: "run_bigfive", label: "Big Five診断を受ける", description: "人格診断を実行してBig Five特性をツインに反映", priority: personalityScore >= 3 ? "medium" : "high", actionPath: "/personality", completed: false });
    }
    if (!hasMbti) {
      actions.push({ key: "run_mbti", label: "MBTI診断を受ける", description: "MBTI診断でツインの行動パターンを明確化", priority: "medium", actionPath: "/personality", completed: false });
    }
    if (knowledgeScore < 3) {
      actions.push({ key: "add_knowledge", label: "ナレッジを追加する", description: `現在${kCount}件。3件以上でツインの回答品質が向上します`, priority: "high", actionPath: "/twins", completed: false });
    }
    if (faqScore < 3) {
      actions.push({ key: "add_faq", label: "FAQを追加する", description: `現在${faqCount}件。よくある質問を登録してツインの応答精度を向上`, priority: "medium", actionPath: "/twin-faq", completed: false });
    }
    if (matchingScore < 2) {
      actions.push({ key: "first_matching", label: "初回マッチングを実行", description: "友達とのマッチングでツインの実力を試しましょう", priority: "high", actionPath: "/matching", completed: false });
    } else if (matchingScore < 4) {
      actions.push({ key: "more_matching", label: "マッチングを増やす", description: `現在${matchCount}回。経験を積むことでツインが成長します`, priority: "low", actionPath: "/matching", completed: false });
    }
    if (feedbackScore < 3 && matchCount >= 1) {
      actions.push({ key: "give_feedback", label: "対話にフィードバックする", description: "マッチング対話のターンに👍/👎評価をつけてツインを改善", priority: "medium", actionPath: "/matching", completed: false });
    }
    if (feedbackTotal >= 5 && feedbackApplied === 0) {
      actions.push({ key: "apply_feedback", label: "フィードバックを反映する", description: `${feedbackTotal}件のフィードバックが未反映。ツインページで「フィードバック反映」を実行`, priority: "high", actionPath: "/twins", completed: false });
    }
    if (!hasTags && personalityScore >= 2) {
      actions.push({ key: "add_tags", label: "タグを3つ以上追加", description: "スキルや専門分野のタグを追加して発見されやすくする", priority: "low", actionPath: "/twins", completed: false });
    }

    // Health grade
    let grade = "D";
    if (overallScore >= 2) grade = "C";
    if (overallScore >= 3) grade = "B";
    if (overallScore >= 4) grade = "A";
    if (overallScore >= 4.5) grade = "S";

    return {
      twinId: twin.id,
      twinName: twin.name || "ツイン",
      overallScore,
      grade,
      dimensions,
      actions: actions.sort((a, b) => {
        const p = { high: 0, medium: 1, low: 2 };
        return p[a.priority] - p[b.priority];
      }),
      stats: {
        personalityLength,
        hasBigFive: !!hasBigFive,
        hasMbti: !!hasMbti,
        hasSystemPrompt,
        hasDescription,
        hasTags: (twin.tags || "").split(",").filter(Boolean).length >= 3,
        knowledgeCount: kCount,
        faqCount,
        matchingCount: matchCount,
        feedbackTotal,
        feedbackApplied,
        feedbackRate,
      },
    };
  }),

  twinComparison: protectedProcedure
    .input(z.object({ friendId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Get my twin
      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "自分のツインが見つかりません" });

      // Get friend's twin
      const friendTwin = await ctx.env.DB.prepare(
        `SELECT dt.*, up.displayName, up.company, up.avatarUrl FROM digital_twins dt LEFT JOIN user_profiles up ON up.userId=dt.userId WHERE dt.userId=?`
      ).bind(input.friendId).first<any>();
      if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達のツインが見つかりません" });

      // Verify friendship
      const friendship = await ctx.env.DB.prepare(
        `SELECT id FROM friendships WHERE ((userId=? AND friendId=?) OR (userId=? AND friendId=?)) AND status='accepted'`
      ).bind(ctx.userId, input.friendId, input.friendId, ctx.userId).first<any>();
      if (!friendship) throw new TRPCError({ code: "FORBIDDEN", message: "友達関係がありません" });

      // Helper: compute personality completeness (0-100)
      function personalityCompleteness(twin: any): number {
        let score = 0;
        if ((twin.personality || "").length > 30) score += 20;
        if ((twin.description || "").length > 20) score += 15;
        if ((twin.systemPrompt || "").length > 50) score += 15;
        const bf = parseJson<any>(twin.bigFiveTraits);
        if (bf && Object.keys(bf).length >= 5) score += 25;
        if (twin.mbtiType && twin.mbtiType.length === 4) score += 15;
        if ((twin.tags || "").split(",").filter(Boolean).length >= 3) score += 10;
        return Math.min(score, 100);
      }

      // Helper: get Big Five trait or default
      function getBigFive(twin: any, trait: string): number {
        const bf = parseJson<any>(twin.bigFiveTraits);
        return bf?.[trait] ?? 50;
      }

      // Get knowledge counts
      const myKnowledge = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM knowledge_base WHERE userId=?`
      ).bind(ctx.userId).first<any>();
      const friendKnowledge = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM knowledge_base WHERE userId=?`
      ).bind(input.friendId).first<any>();

      // Get matching counts
      const myMatching = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`
      ).bind(ctx.userId).first<any>();
      const friendMatching = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`
      ).bind(input.friendId).first<any>();

      // Normalize knowledge (cap at 20 -> 100)
      function normalizeKnowledge(cnt: number): number {
        return Math.min(Math.round((cnt / 20) * 100), 100);
      }

      // Normalize matching (cap at 30 -> 100)
      function normalizeMatching(cnt: number): number {
        return Math.min(Math.round((cnt / 30) * 100), 100);
      }

      // Build 6-axis data
      const axes = [
        { key: "personality", label: "人格設定" },
        { key: "knowledge", label: "ナレッジ" },
        { key: "matching", label: "マッチング実績" },
        { key: "openness", label: "創造性" },
        { key: "extraversion", label: "外向性" },
        { key: "agreeableness", label: "協調性" },
      ];

      const myScores: Record<string, number> = {
        personality: personalityCompleteness(myTwin),
        knowledge: normalizeKnowledge(myKnowledge?.cnt ?? 0),
        matching: normalizeMatching(myMatching?.cnt ?? 0),
        openness: getBigFive(myTwin, "openness"),
        extraversion: getBigFive(myTwin, "extraversion"),
        agreeableness: getBigFive(myTwin, "agreeableness"),
      };

      const friendScores: Record<string, number> = {
        personality: personalityCompleteness(friendTwin),
        knowledge: normalizeKnowledge(friendKnowledge?.cnt ?? 0),
        matching: normalizeMatching(friendMatching?.cnt ?? 0),
        openness: getBigFive(friendTwin, "openness"),
        extraversion: getBigFive(friendTwin, "extraversion"),
        agreeableness: getBigFive(friendTwin, "agreeableness"),
      };

      // Compute diff highlights
      const diffs = axes.map(a => ({
        key: a.key,
        label: a.label,
        myScore: myScores[a.key],
        friendScore: friendScores[a.key],
        diff: myScores[a.key] - friendScores[a.key],
      }));

      // Predicted compatibility: average closeness across all axes (100 = identical)
      const totalDiff = diffs.reduce((sum, d) => sum + Math.abs(d.diff), 0);
      const avgDiff = totalDiff / diffs.length;
      const compatibilityScore = Math.round(Math.max(0, 100 - avgDiff));

      // Check if there's a real matching result between these two
      const existingMatch = await ctx.env.DB.prepare(
        `SELECT mr.compatibilityScore FROM matching_results mr JOIN matching_sessions ms ON ms.id=mr.sessionId WHERE ((ms.twin1Id=? AND ms.twin2Id=?) OR (ms.twin1Id=? AND ms.twin2Id=?)) AND ms.status='completed' ORDER BY ms.completedAt DESC LIMIT 1`
      ).bind(myTwin.id, friendTwin.id, friendTwin.id, myTwin.id).first<any>();

      return {
        myTwin: {
          id: myTwin.id,
          name: myTwin.name,
          avatarUrl: null as string | null,
          scores: myScores,
        },
        friendTwin: {
          id: friendTwin.id,
          name: friendTwin.name,
          displayName: friendTwin.displayName || null,
          avatarUrl: friendTwin.avatarUrl || null,
          company: friendTwin.company || null,
          scores: friendScores,
        },
        axes,
        diffs,
        compatibilityScore,
        actualMatchScore: existingMatch ? parseFloat(existingMatch.compatibilityScore) : null,
      };
    }),

});
