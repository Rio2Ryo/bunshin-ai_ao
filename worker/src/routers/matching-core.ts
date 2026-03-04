import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin, normalizeTwin, addTrustAction, recordFriendActivity } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { createNotification, notifyMatchingComplete, notifyMatchingInvite, sendMatchingReportEmail } from "../notifications";
import { updateMatchingStreakForUser, searchWithTavily, generateSearchQueries, formatSearchContext, type TavilyResponse } from "./matching-shared";

export const matchingCoreRouter = router({
  sessions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT ms.*,
        t1.id as t1Id, t1.name as t1Name, t1.userId as t1UserId,
        t2.id as t2Id, t2.name as t2Name, t2.userId as t2UserId,
        u1.isNpc as u1IsNpc, u2.isNpc as u2IsNpc,
        mr.compatibilityScore, mr.summary as resultSummary
      FROM matching_sessions ms
      LEFT JOIN digital_twins t1 ON t1.id = ms.twin1Id
      LEFT JOIN digital_twins t2 ON t2.id = ms.twin2Id
      LEFT JOIN users u1 ON u1.id = t1.userId
      LEFT JOIN users u2 ON u2.id = t2.userId
      LEFT JOIN matching_results mr ON mr.sessionId = ms.id
      WHERE ms.initiatorUserId = ?
      ORDER BY ms.createdAt DESC`
    ).bind(ctx.userId).all<any>();
    return (rows.results ?? []).map((r: any) => {
      const settings = parseJson<any>(r.settings) || {};
      return {
        id: r.id,
        initiatorUserId: r.initiatorUserId,
        twin1Id: r.twin1Id,
        twin2Id: r.twin2Id,
        theme: r.theme,
        status: r.status,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        twin1: r.t1Id ? { id: r.t1Id, name: r.t1Name, userId: r.t1UserId } : { id: r.twin1Id, name: `Twin #${r.twin1Id}` },
        twin2: r.t2Id ? { id: r.t2Id, name: r.t2Name, userId: r.t2UserId } : { id: r.twin2Id, name: `Twin #${r.twin2Id}` },
        isNpcSession: r.u1IsNpc === 1 || r.u2IsNpc === 1,
        isGroup: settings.type === "group",
        participantCount: settings.participantCount ?? 2,
        compatibilityScore: r.compatibilityScore ?? null,
        resultSummary: r.resultSummary ?? null,
      };
    });
  }),
  getSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.id).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const twin1 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const dialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.id).all<any>();
      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(input.id).first<any>();
      return {
        session: { ...session, settings: parseJson<any>(session.settings) },
        twin1: normalizeTwin(twin1),
        twin2: normalizeTwin(twin2),
        dialogues: dialogues.results ?? [],
        result: result ? { ...result, scoreBreakdown: parseJson<any>(result.scoreBreakdown), strengths: parseJson<string[]>(result.strengths), challenges: parseJson<string[]>(result.challenges), recommendations: parseJson<string[]>(result.recommendations), webSearchData: parseJson<any>(result.webSearchData) } : null,
      };
    }),
  webSearch: protectedProcedure
    .input(z.object({ query: z.string().min(1), sessionId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tavilyKey = ctx.env.TAVILY_API_KEY;
      if (!tavilyKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Web検索APIキーが設定されていません（TAVILY_API_KEY）" });
      const result = await searchWithTavily(input.query, tavilyKey, { maxResults: 5, searchDepth: "advanced" });
      return {
        query: result.query,
        answer: result.answer || null,
        results: (result.results || []).map(r => ({ title: r.title, url: r.url, content: r.content.slice(0, 300), score: r.score })),
      };
    }),
  availableFriends: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB
      .prepare(`SELECT f.id as fshipId, f.status as fshipStatus, f.createdAt as fshipCreatedAt,
        u.id as fId, u.name as fName,
        dt.id as twinId, dt.name as twinName, dt.description as twinDesc, dt.personality as twinPersonality,
        dt.isPublic as twinIsPublic, dt.tags as twinTags, dt.systemPrompt as twinSystemPrompt,
        dt.bigFiveTraits as twinBigFive, dt.mbtiType as twinMbti
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END
        JOIN digital_twins dt ON dt.userId = u.id
        WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
      .bind(ctx.userId, ctx.userId, ctx.userId)
      .all<any>();
    return (rows.results ?? []).map(r => ({
      friendship: { id: r.fshipId, status: r.fshipStatus, createdAt: r.fshipCreatedAt },
      friend: { id: r.fId, name: r.fName },
      twin: normalizeTwin({
        id: r.twinId, name: r.twinName, description: r.twinDesc, personality: r.twinPersonality,
        isPublic: r.twinIsPublic, tags: r.twinTags, systemPrompt: r.twinSystemPrompt,
        bigFiveTraits: r.twinBigFive, mbtiType: r.twinMbti, userId: r.fId,
      }),
    }));
  }),
  suggestedCandidates: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
    if (!myTwin) return [];

    const myTags: string[] = myTwin.tags || [];

    // Get my profile once (not in loop)
    const myProfile = await ctx.env.DB.prepare(`SELECT industry FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

    // Get all friends with twins AND profiles in a single query
    const friendRows = await ctx.env.DB
      .prepare(`SELECT f.*, u.id as fId, u.name as fName, u.isNpc as fIsNpc,
        dt.id as twinId, dt.name as twinName, dt.description as twinDesc, dt.personality as twinPersonality,
        dt.isPublic as twinIsPublic, dt.tags as twinTags, dt.bigFiveTraits as twinBigFive, dt.mbtiType as twinMbti,
        up.industry as fIndustry
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END
        LEFT JOIN digital_twins dt ON dt.userId = u.id
        LEFT JOIN user_profiles up ON up.userId = u.id
        WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`)
      .bind(ctx.userId, ctx.userId, ctx.userId)
      .all<any>();

    const candidates = [];

    for (const r of friendRows.results ?? []) {
      if (!r.twinId) continue;

      const twin = { id: r.twinId, name: r.twinName, description: r.twinDesc, personality: r.twinPersonality, isPublic: r.twinIsPublic, tags: r.twinTags, bigFiveTraits: r.twinBigFive, mbtiType: r.twinMbti, userId: r.fId };
      const normalized = normalizeTwin(twin);
      const twinTags: string[] = normalized?.tags || [];

      // These still need per-friend queries (depend on twin.id)
      const bestResult = await ctx.env.DB.prepare(
        `SELECT mr.compatibilityScore, mr.summary, ms.id as sessionId, ms.theme FROM matching_sessions ms JOIN matching_results mr ON mr.sessionId = ms.id WHERE ms.initiatorUserId=? AND (ms.twin1Id=? OR ms.twin2Id=?) AND ms.status='completed' ORDER BY mr.compatibilityScore DESC LIMIT 1`
      ).bind(ctx.userId, r.twinId, r.twinId).first<any>();

      const matchCount = await ctx.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND (twin1Id=? OR twin2Id=?)`
      ).bind(ctx.userId, r.twinId, r.twinId).first<any>();

      let score: number;
      let scoreSource: string;

      if (bestResult?.compatibilityScore != null) {
        score = bestResult.compatibilityScore;
        scoreSource = "actual";
      } else {
        // Heuristic score: profile completeness + tag overlap + industry match
        score = 45;
        if (twin.description) score += 6;
        if (twin.personality) score += 4;
        if (twinTags.length > 0) score += Math.min(twinTags.length * 2, 8);
        // Tag overlap (high weight — indicates real compatibility)
        const overlap = myTags.filter((t: string) => twinTags.map((s: string) => s.toLowerCase()).includes(t.toLowerCase())).length;
        score += Math.min(overlap * 7, 21);
        // Industry match bonus
        if (r.fIndustry && myProfile?.industry && r.fIndustry.toLowerCase() === myProfile.industry.toLowerCase()) score += 8;
        if (r.fIsNpc === 1) score += 5;
        if (twin.bigFiveTraits) score += 3;
        score = Math.min(score, 95);
        scoreSource = "estimated";
      }

      candidates.push({
        friend: { id: r.fId, name: r.fName, isNpc: r.fIsNpc === 1 },
        twin: { id: twin.id, name: twin.name, description: twin.description, personality: twin.personality, tags: twinTags },
        score: Math.round(score),
        scoreSource,
        matchCount: matchCount?.cnt ?? 0,
        bestResult: bestResult ? {
          score: bestResult.compatibilityScore,
          summary: bestResult.summary,
          sessionId: bestResult.sessionId,
          theme: bestResult.theme,
        } : null,
      });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }),
  create: protectedProcedure
    .input(z.object({ friendId: z.number(), theme: z.string().min(1).max(500), turns: z.number().min(1).max(20).default(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Check plan limits
      const userRow = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      const userPlan = userRow?.plan || "free";
      const monthlyLimits: Record<string, number> = { free: 3, premium: 30, enterprise: -1 };
      const maxMatchings = monthlyLimits[userPlan] ?? 3;
      if (maxMatchings !== -1) {
        const usageRow = await ctx.env.DB.prepare(`SELECT matchingsThisMonth FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
        if ((usageRow?.matchingsThisMonth ?? 0) >= maxMatchings) {
          throw new TRPCError({ code: "FORBIDDEN", message: `月間マッチング上限（${maxMatchings}回）に達しました。プランをアップグレードしてください。` });
        }
      }

      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const friendTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
      if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIがありません" });

      // Check trust score threshold (NPC friends are exempt)
      const friendUser = await ctx.env.DB.prepare(`SELECT isNpc FROM users WHERE id=?`).bind(input.friendId).first<any>();
      const isNpcMatch = friendUser?.isNpc === 1;
      if (!isNpcMatch) {
        const trustRow = await ctx.env.DB.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();
        const trustScore = trustRow?.score ?? 0;
        if (trustScore < 30) {
          throw new TRPCError({ code: "FORBIDDEN", message: `マッチングには信頼度スコア30以上が必要です（現在: ${trustScore}）。プロフィールの充実や会話を続けてスコアを上げましょう。` });
        }
      }

      // Create session in 'running' status
      const sessionRes = await ctx.env.DB.prepare(
        `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status) VALUES (?,?,?,?,'running')`
      ).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme).run();
      const sessionId = Number(sessionRes.meta.last_row_id);

      // Increment matching usage counter
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`INSERT OR IGNORE INTO usage_tracking (userId, matchingsThisMonth) VALUES (?, 0)`).bind(ctx.userId),
        ctx.env.DB.prepare(`UPDATE usage_tracking SET matchingsThisMonth = matchingsThisMonth + 1, updatedAt = datetime('now') WHERE userId = ?`).bind(ctx.userId),
      ]);

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      if (!llmConfig) {
        // No LLM config - insert placeholder and mark completed
        await ctx.env.DB.prepare(`INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber) VALUES (?,?,?,?)`)
          .bind(sessionId, myTwin.id, `AI APIキーが未設定のため、対話を生成できません。「AI API設定」でキーを登録してください。`, 0).run();
        await ctx.env.DB.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
        return { id: sessionId, dialogues: [] };
      }

      // Fetch profiles for richer dialogue context
      const myProfile = await ctx.env.DB.prepare(`SELECT company, industry, position, skills, expertise, bio FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      const friendProfile = await ctx.env.DB.prepare(`SELECT company, industry, position, skills, expertise, bio FROM user_profiles WHERE userId=?`).bind(input.friendId).first<any>();

      // Fetch personality profiles for both users (for personality compatibility dimension)
      const myPersonality = await ctx.env.DB.prepare(
        `SELECT bigFive, mbti, mbtiScores, valueProfile FROM personality_profiles WHERE userId=? AND status='completed'`
      ).bind(ctx.userId).first<any>();
      const friendPersonality = await ctx.env.DB.prepare(
        `SELECT bigFive, mbti, mbtiScores, valueProfile FROM personality_profiles WHERE userId=? AND status='completed'`
      ).bind(input.friendId).first<any>();
      const hasPersonalityData = !!(myPersonality && friendPersonality);

      // Fetch knowledge base for both twins (top 5 entries each for matching context)
      const myKnowledge = (await ctx.env.DB.prepare(
        `SELECT title, summary, content FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 5`
      ).bind(myTwin.id).all<any>()).results ?? [];
      const friendKnowledge = (await ctx.env.DB.prepare(
        `SELECT title, summary, content FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 5`
      ).bind(friendTwin.id).all<any>()).results ?? [];

      // Generate real dialogue between twins
      const twins = [
        { id: myTwin.id, name: myTwin.name, desc: myTwin.description || "", personality: myTwin.personality || "", profile: myProfile, knowledge: myKnowledge },
        { id: friendTwin.id, name: normalizeTwin(friendTwin)?.name || "Twin", desc: friendTwin.description || "", personality: friendTwin.personality || "", profile: friendProfile, knowledge: friendKnowledge },
      ];
      const dialogueHistory: { speaker: string; content: string }[] = [];
      const turnsToRun = Math.min(input.turns, 10);
      let webSearchContext = "";
      let webSearchResults: TavilyResponse[] = [];

      // Run Tavily web search for the theme (if API key configured)
      if (ctx.env.TAVILY_API_KEY) {
        try {
          const queries = await generateSearchQueries(llmConfig, input.theme, "");
          for (const q of queries.slice(0, 2)) {
            const sr = await searchWithTavily(q, ctx.env.TAVILY_API_KEY, { maxResults: 3 });
            webSearchResults.push(sr);
          }
          webSearchContext = formatSearchContext(webSearchResults);
        } catch { /* search failed — continue without it */ }
      }

      for (let turn = 0; turn < turnsToRun; turn++) {
        const speakerIdx = turn % 2;
        const speaker = twins[speakerIdx];
        const other = twins[1 - speakerIdx];

        let profileContext = "";
        if (speaker.profile) {
          const p = speaker.profile;
          if (p.company) profileContext += `所属: ${p.company}。`;
          if (p.industry) profileContext += `業界: ${p.industry}。`;
          if (p.position) profileContext += `役職: ${p.position}。`;
          if (p.skills || p.expertise) profileContext += `得意分野: ${p.skills || p.expertise}。`;
        }

        const searchSuffix = webSearchContext
          ? `\n\n${webSearchContext}`
          : "";

        // Build knowledge context for this speaker
        let knowledgeContext = "";
        if (speaker.knowledge && speaker.knowledge.length > 0) {
          knowledgeContext = "\n知識ベース: " + speaker.knowledge.map((k: any) => {
            const label = k.title || "";
            const body = k.summary || (k.content ? k.content.slice(0, 300) : "");
            return label ? `${label}: ${body}` : body;
          }).filter(Boolean).join("; ");
        }

        const systemPrompt = `あなたは「${speaker.name}」というデジタル分身AIです。${speaker.desc ? `説明: ${speaker.desc}。` : ""}${speaker.personality ? `性格: ${speaker.personality}。` : ""}${profileContext}${knowledgeContext}
テーマ「${input.theme}」について「${other.name}」と建設的なビジネス対話をしています。
相手の意見を尊重しつつ、自分の専門性や経験・知識ベースに基づいた具体的な提案や考えを述べてください。
簡潔で具体的な発言（150〜300文字程度）をしてください。${searchSuffix}`;

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
        ];
        // Add dialogue history as context
        for (const d of dialogueHistory) {
          messages.push({
            role: d.speaker === speaker.name ? "assistant" : "user",
            content: `${d.speaker}: ${d.content}`,
          });
        }
        if (turn === 0) {
          messages.push({ role: "user", content: `テーマ「${input.theme}」について話し始めてください。` });
        }

        // Mid-dialogue search: after turn 2, search again with dialogue context for deeper insights
        if (turn === 2 && ctx.env.TAVILY_API_KEY && dialogueHistory.length >= 2) {
          try {
            const contextText = dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n");
            const midQueries = await generateSearchQueries(llmConfig, input.theme, contextText);
            for (const q of midQueries.slice(0, 2)) {
              const sr = await searchWithTavily(q, ctx.env.TAVILY_API_KEY, { maxResults: 3, searchDepth: "advanced" });
              webSearchResults.push(sr);
            }
            webSearchContext = formatSearchContext(webSearchResults);
          } catch { /* continue */ }
        }

        let content = "";
        let provider = "";
        let model = "";
        try {
          const result = await invokeLLM(llmConfig, messages, { maxTokens: 512, temperature: 0.8 });
          content = result.content.replace(new RegExp(`^${speaker.name}:\\s*`, "i"), "").trim();
          provider = result.provider;
          model = result.model;
        } catch { /* LLM failed */ }

        // Fallback: generate scripted dialogue if LLM returned empty/very short
        if (!content || content.length < 10) {
          const fallbackDialogues: Record<string, string[][]> = {
            twin1: [
              [`「${input.theme}」について、ぜひお話しさせてください。${speaker.desc ? speaker.desc.slice(0, 60) + "として、" : ""}この分野での協業には大きな可能性を感じています。具体的には、お互いの強みを活かした共同プロジェクトが考えられますね。`, `私の経験から言うと、${input.theme}に関しては段階的なアプローチが効果的です。まずは小さな成功事例を作り、そこから拡大していく戦略が良いと思います。`, `とても興味深い視点ですね。${speaker.desc ? "私は" + speaker.desc.slice(0, 40) + "の経験があるので、" : ""}技術面でのサポートができると思います。ぜひ具体的なプランを一緒に考えましょう。`],
              [`「${input.theme}」は非常に面白いテーマですね。${speaker.desc ? speaker.desc.slice(0, 50) + "として" : ""}最近のトレンドを踏まえると、デジタル技術を活用した新しいアプローチが有望だと考えています。`, `なるほど、その考えは賛同できます。${speaker.personality ? speaker.personality.slice(0, 30) + "なので、" : ""}お互いの得意分野を組み合わせることで、より大きな価値を生み出せるはずです。`, `素晴らしい提案ですね。まずは月次のミーティングから始めて、具体的なアクションプランを策定しましょう。短期・中期・長期の目標設定が重要だと思います。`],
            ],
            twin2: [
              [`こちらこそ、よろしくお願いします。${speaker.desc ? speaker.desc.slice(0, 60) + "の立場から、" : ""}「${input.theme}」には私も強い関心を持っています。特にユーザー体験の向上とスケーラビリティの両立が鍵だと考えています。`, `同意です。段階的なアプローチは理にかなっていますね。${speaker.personality ? speaker.personality.slice(0, 30) + "なので、" : ""}まずはPoCから始めて、データに基づいた意思決定をしていきたいです。`, `ぜひやりましょう！お互いの強みを活かせば、1+1が3以上になる協業ができると確信しています。具体的なスケジュールを詰めていきましょう。`],
              [`「${input.theme}」について、とても共感します。${speaker.desc ? speaker.desc.slice(0, 50) + "から見ても、" : ""}このテーマは今後ますます重要になってくると思います。`, `その通りですね。${speaker.personality ? speaker.personality.slice(0, 30) + "という点で、" : ""}私たちは相性が良いと感じています。リソースの相互補完ができる関係を築けると思います。`, `実行に移しましょう。まずは双方の強みと弱みを洗い出して、具体的な役割分担を決めるのが良いかと思います。楽しみです！`],
            ],
          };
          const twinKey = speakerIdx === 0 ? "twin1" : "twin2";
          const _idx = new Uint32Array(1);
          crypto.getRandomValues(_idx);
          const variantIdx = _idx[0] % fallbackDialogues[twinKey].length;
          const turnIdx = Math.min(turn, fallbackDialogues[twinKey][variantIdx].length - 1);
          content = fallbackDialogues[twinKey][variantIdx][turnIdx];
          provider = "scripted-fallback";
          model = "matching-dialogue-v1";
        }

        dialogueHistory.push({ speaker: speaker.name, content });
        await ctx.env.DB.prepare(
          `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES (?,?,?,?,?,?)`
        ).bind(sessionId, speaker.id, content, turn, provider, model).run();
      }

      // Save web search results metadata in session
      if (webSearchResults.length > 0) {
        try {
          await ctx.env.DB.prepare(
            `UPDATE matching_sessions SET settings=? WHERE id=?`
          ).bind(toJson({ webSearchResults: webSearchResults.map(r => ({ query: r.query, answer: r.answer, resultCount: r.results?.length || 0, sources: (r.results || []).slice(0, 5).map(s => ({ title: s.title, url: s.url })) })) }), sessionId).run();
        } catch { /* column might not exist yet */ }
      }

      // Run analysis after dialogue
      try {
        // Build profile summaries for analysis context
        const profileSummaries = twins.map(t => {
          const parts = [t.name];
          if (t.profile?.company) parts.push(`所属: ${t.profile.company}`);
          if (t.profile?.industry) parts.push(`業界: ${t.profile.industry}`);
          if (t.profile?.position) parts.push(`役職: ${t.profile.position}`);
          if (t.profile?.skills || t.profile?.expertise) parts.push(`得意分野: ${t.profile.skills || t.profile.expertise}`);
          if (t.desc) parts.push(`説明: ${t.desc}`);
          return parts.join("、");
        });

        const webSearchSummary = webSearchResults.length > 0
          ? `\n\n【Web検索で得られた市場情報】\n${webSearchResults.map(r => r.answer ? `• ${r.query}: ${r.answer}` : "").filter(Boolean).join("\n")}`
          : "";

        // Build personality context if both users have completed profiles
        let personalityContext = "";
        if (hasPersonalityData) {
          const myBF = parseJson<any>(myPersonality.bigFive) || {};
          const friendBF = parseJson<any>(friendPersonality.bigFive) || {};
          const formatBF = (bf: any) => `開放性:${bf.openness ?? "?"},誠実性:${bf.conscientiousness ?? "?"},外向性:${bf.extraversion ?? "?"},協調性:${bf.agreeableness ?? "?"},情緒安定性:${100 - (bf.neuroticism ?? 50)}`;
          personalityContext = `\n\n【人格プロファイル情報】
- ${twins[0].name}: Big Five (${formatBF(myBF)}), MBTI: ${myPersonality.mbti || "未判定"}
- ${twins[1].name}: Big Five (${formatBF(friendBF)}), MBTI: ${friendPersonality.mbti || "未判定"}
※ 上記の人格プロファイルデータも考慮して、personalityCompatibility次元のスコアと理由を算出してください。`;
        }

        const personalityDimension = hasPersonalityData
          ? `\n    "personalityCompatibility": {"score": (0-20), "reason": "人格特性の互換性に基づく理由"}`
          : "";
        const totalNote = hasPersonalityData ? "6次元合計を100点満点に換算" : "5次元合計";

        const analysisPrompt = `以下は「${twins[0].name}」と「${twins[1].name}」のビジネスマッチング対話です。テーマ: ${input.theme}

参加者情報:
- ${profileSummaries[0]}
- ${profileSummaries[1]}
${webSearchSummary}${personalityContext}

${dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n")}

以下のJSON形式で分析結果を返してください（日本語で）:
{
  "compatibilityScore": (0-100の数値, ${totalNote}),
  "summary": "(総合評価の要約)",
  "collaborationPotential": "(協業可能性の詳細な説明)",
  "strengths": ["強み1", "強み2", "強み3"],
  "challenges": ["課題1", "課題2"],
  "recommendations": ["提案1", "提案2", "提案3"],
  "scoreBreakdown": {
    "skillMatch": {"score": (0-20), "reason": "理由"},
    "valueAlignment": {"score": (0-20), "reason": "理由"},
    "communicationStyle": {"score": (0-20), "reason": "理由"},
    "businessGoalFit": {"score": (0-20), "reason": "理由"},
    "complementaryStrengths": {"score": (0-20), "reason": "理由"}${personalityDimension}
  },
  "detailedAnalysis": "(詳細分析のマークダウン)",
  "roleDistribution": "(役割分担の提案マークダウン)",
  "timeline": "(タイムライン提案のマークダウン)",
  "resources": "(必要リソースのマークダウン)",
  "kpis": "(期待成果・KPIのマークダウン)",
  "nextSteps": "(明日からできるアクションのマークダウン)"
}

JSONのみ出力し、他の説明は不要です。`;

        const analysisResult = await invokeLLM(llmConfig, [
          { role: "system", content: "あなたはビジネスマッチングの専門アナリストです。" },
          { role: "user", content: analysisPrompt },
        ], { maxTokens: 4096, temperature: 0.5 });

        // Parse JSON from response
        let analysis: any;
        try {
          const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
          analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch { analysis = null; }

        if (analysis) {
          // Validate and fix score consistency: sub-scores (0-20 each) must sum to compatibilityScore
          if (analysis.scoreBreakdown) {
            const baseDims = ["skillMatch", "valueAlignment", "communicationStyle", "businessGoalFit", "complementaryStrengths"];
            const dims = hasPersonalityData ? [...baseDims, "personalityCompatibility"] : baseDims;
            let computedTotal = 0;
            for (const dim of dims) {
              const sub = analysis.scoreBreakdown[dim];
              if (sub && typeof sub.score === "number") {
                sub.score = Math.max(0, Math.min(20, Math.round(sub.score)));
                computedTotal += sub.score;
              }
            }
            // Use computed sum — normalize 6-dim total (max 120) to 0-100 scale
            if (computedTotal > 0) {
              analysis.compatibilityScore = hasPersonalityData
                ? Math.round(computedTotal * 100 / 120)
                : computedTotal;
            }
          }

          await ctx.env.DB.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            sessionId,
            analysis.compatibilityScore ?? 50,
            toJson(analysis.scoreBreakdown),
            analysis.collaborationPotential ?? "",
            toJson(analysis.strengths),
            toJson(analysis.challenges),
            toJson(analysis.recommendations),
            analysis.summary ?? "",
            analysis.detailedAnalysis ?? "",
            analysis.roleDistribution ?? "",
            analysis.timeline ?? "",
            analysis.resources ?? "",
            analysis.kpis ?? "",
            analysis.nextSteps ?? "",
          ).run();
        } else {
          // LLM returned non-parseable analysis — insert scripted default
          const defaultBreakdown: Record<string, { score: number; reason: string }> = {
            skillMatch: { score: isNpcMatch ? 16 : 13, reason: "関連するスキルセットを持っている" },
            valueAlignment: { score: isNpcMatch ? 15 : 13, reason: "基本的な価値観が一致している" },
            communicationStyle: { score: isNpcMatch ? 15 : 13, reason: "建設的な対話ができている" },
            businessGoalFit: { score: isNpcMatch ? 14 : 13, reason: "ビジネス目標に一定の親和性がある" },
            complementaryStrengths: { score: isNpcMatch ? 15 : 13, reason: "相互補完的な強みがある" },
          };
          if (hasPersonalityData) {
            defaultBreakdown.personalityCompatibility = { score: isNpcMatch ? 14 : 12, reason: "人格プロファイルに基づく互換性がある" };
          }
          const rawTotal = Object.values(defaultBreakdown).reduce((s, d) => s + d.score, 0);
          const defaultAnalysis = {
            compatibilityScore: hasPersonalityData ? Math.round(rawTotal * 100 / 120) : rawTotal,
            summary: "対話を通じて、双方に協業の可能性が見つかりました。共通の関心分野があり、互いの強みを活かせる領域が確認できました。",
            collaborationPotential: "お互いのスキルセットが補完的であり、段階的な協業から始めることで大きな成果が期待できます。",
            strengths: ["共通の関心テーマがある", "コミュニケーションスタイルが建設的", "互いの専門分野が補完的"],
            challenges: ["具体的な協業プランの策定が必要", "リソース配分の合意形成"],
            recommendations: ["月次の定期ミーティングを設定する", "小規模なPoCプロジェクトから開始する", "成果指標を明確にして進捗を共有する"],
            scoreBreakdown: defaultBreakdown,
          };
          await ctx.env.DB.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary) VALUES (?,?,?,?,?,?,?,?)`
          ).bind(sessionId, defaultAnalysis.compatibilityScore, toJson(defaultAnalysis.scoreBreakdown), defaultAnalysis.collaborationPotential, toJson(defaultAnalysis.strengths), toJson(defaultAnalysis.challenges), toJson(defaultAnalysis.recommendations), defaultAnalysis.summary).run();
        }
      } catch {
        // Analysis failed entirely — insert scripted default to ensure results are always shown
        try {
          await ctx.env.DB.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, summary, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?)`
          ).bind(sessionId, isNpcMatch ? 72 : 60, "対話分析の結果、協業の可能性があります。", toJson(["共通の関心分野"]), toJson(["具体的な連携方法の検討が必要"]), toJson(["定期的な情報交換の場を設ける"])).run();
        } catch { /* ignore if duplicate */ }
      }

      await ctx.env.DB.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();

      // Award trust points for matching completion
      await addTrustAction(ctx.env.DB, ctx.userId, "matching_complete", 5, `マッチング完了: ${input.theme}`);

      // Update matching streak & unlock achievements
      try {
        await updateMatchingStreakForUser(ctx.env.DB, ctx.userId);
      } catch { /* streak update should not block matching completion */ }

      // Record friend activity for timeline
      await recordFriendActivity(ctx.env.DB, ctx.userId, "matching_complete", `マッチング完了: ${input.theme}`, undefined, { sessionId, friendId: input.friendId });

      // Send matching completion notification + report email
      try {
        const result = await ctx.env.DB.prepare(`SELECT compatibilityScore FROM matching_results WHERE sessionId=?`).bind(sessionId).first<any>();
        const score = result?.compatibilityScore ? parseFloat(result.compatibilityScore) : 0;
        await notifyMatchingComplete(ctx.env.DB, ctx.userId, input.theme, score, ctx.env);
        // Send HTML report email to both participants
        if (ctx.env.RESEND_API_KEY) {
          try {
            // Reuse the exportReport logic inline to generate HTML
            const twin1Row = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE id=?`).bind(myTwin.id).first<any>();
            const twin2Row = await ctx.env.DB.prepare(`SELECT name FROM digital_twins WHERE id=?`).bind(friendTwin.id).first<any>();
            const t1Name = twin1Row?.name || "Twin 1";
            const t2Name = twin2Row?.name || "Twin 2";
            const date = new Date().toISOString().slice(0, 10);
            const dialogueHtml = dialogueHistory.map((d, i) => `<div style="margin:8px 0;padding:12px;background:${i % 2 === 0 ? '#f0f4ff' : '#f0fff4'};border-radius:8px"><strong>${d.speaker}</strong><p style="margin:4px 0 0">${d.content}</p></div>`).join("");
            const reportHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>マッチングレポート</title></head><body style="font-family:-apple-system,sans-serif;max-width:800px;margin:0 auto;padding:24px"><h1 style="color:#6366f1">マッチングレポート</h1><p>テーマ: <strong>${input.theme}</strong><br>${t1Name} × ${t2Name}<br>日付: ${date}</p><h2>相性スコア: <span style="color:#6366f1">${score}%</span></h2><h2>対話</h2>${dialogueHtml}</body></html>`;
            await sendMatchingReportEmail(ctx.env.DB, ctx.userId, input.theme, score, reportHtml, ctx.env);
            await sendMatchingReportEmail(ctx.env.DB, input.friendId, input.theme, score, reportHtml, ctx.env);
          } catch { /* email failure is non-critical */ }
        }
      } catch { /* notification failure is non-critical */ }

      return { id: sessionId, dialogues: dialogueHistory };
    }),
  /** Create a streaming session — returns immediately with sessionId. Client then connects to SSE endpoint. */
  startStreaming: protectedProcedure
    .input(z.object({ friendId: z.number(), theme: z.string().min(1).max(500), turns: z.number().min(1).max(20).default(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Check plan limits (same as matching.create)
      const userRow = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      const userPlan = userRow?.plan || "free";
      const monthlyLimits: Record<string, number> = { free: 3, premium: 30, enterprise: -1 };
      const maxMatchings = monthlyLimits[userPlan] ?? 3;
      if (maxMatchings !== -1) {
        const usageRow = await ctx.env.DB.prepare(`SELECT matchingsThisMonth FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
        if ((usageRow?.matchingsThisMonth ?? 0) >= maxMatchings) {
          throw new TRPCError({ code: "FORBIDDEN", message: `月間マッチング上限（${maxMatchings}回）に達しました。プランをアップグレードしてください。` });
        }
      }

      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const friendTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
      if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: "友達の分身AIがありません" });

      // Trust score check
      const friendUser = await ctx.env.DB.prepare(`SELECT isNpc FROM users WHERE id=?`).bind(input.friendId).first<any>();
      const isNpcMatch = friendUser?.isNpc === 1;
      if (!isNpcMatch) {
        const trustRow = await ctx.env.DB.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();
        const trustScore = trustRow?.score ?? 0;
        if (trustScore < 30) {
          throw new TRPCError({ code: "FORBIDDEN", message: `マッチングには信頼度スコア30以上が必要です（現在: ${trustScore}）。` });
        }
      }

      // Create session in 'running' state with turns/friendId in settings
      const sessionRes = await ctx.env.DB.prepare(
        `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'running',?)`
      ).bind(ctx.userId, myTwin.id, friendTwin.id, input.theme, toJson({ turns: input.turns, friendId: input.friendId })).run();
      const sessionId = Number(sessionRes.meta.last_row_id);

      // Increment matching usage counter
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`INSERT OR IGNORE INTO usage_tracking (userId, matchingsThisMonth) VALUES (?, 0)`).bind(ctx.userId),
        ctx.env.DB.prepare(`UPDATE usage_tracking SET matchingsThisMonth = matchingsThisMonth + 1, updatedAt = datetime('now') WHERE userId = ?`).bind(ctx.userId),
      ]);

      return { sessionId };
    }),
  runDialogue: protectedProcedure
    .input(z.object({ sessionId: z.number(), turns: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      const twin1 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      if (!twin1 || !twin2) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const existingDialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
      const startTurn = (existingDialogues.results?.length ?? 0) + 1;
      const turns = input.turns ?? 5;
      const dialogues: any[] = [];

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);

      // Web search for context enrichment
      let searchContext = "";
      if (ctx.env.TAVILY_API_KEY && llmConfig) {
        try {
          const existingContext = (existingDialogues.results || []).map((d: any) => d.content).join("\n");
          const queries = await generateSearchQueries(llmConfig, session.theme, existingContext);
          const results: TavilyResponse[] = [];
          for (const q of queries.slice(0, 2)) {
            results.push(await searchWithTavily(q, ctx.env.TAVILY_API_KEY, { maxResults: 3 }));
          }
          searchContext = formatSearchContext(results);
        } catch { /* continue without search */ }
      }

      for (let i = 0; i < turns; i++) {
        const turnNumber = startTurn + i;
        const isTwin1 = turnNumber % 2 === 1;
        const speaker = isTwin1 ? twin1 : twin2;
        const speakerName = speaker.name || `Twin #${speaker.id}`;
        const context = dialogues.map(d => `${d.speakerName}: ${d.content}`).join("\n");

        let content = `${speakerName}として、「${session.theme}」について${isTwin1 ? "議論を始めます" : "応答します"}。`;
        try {
          if (llmConfig) {
            const searchSuffix = searchContext ? `\n\n${searchContext}` : "";
            const msgs = [
              { role: "system" as const, content: `あなたは「${speakerName}」です。性格: ${speaker.personality || "プロフェッショナル"}。テーマ「${session.theme}」について対話してください。${searchSuffix}` },
              ...(context ? [{ role: "user" as const, content: `これまでの対話:\n${context}\n\n${speakerName}として次の発言をしてください。` }] : [{ role: "user" as const, content: `テーマ「${session.theme}」について最初の発言をしてください。` }]),
            ];
            const result = await invokeLLM(llmConfig, msgs, { maxTokens: 512, temperature: 0.8 });
            if (result.content) content = result.content;
          }
        } catch { /* use fallback */ }

        await ctx.env.DB.prepare(
          `INSERT INTO matching_dialogues (sessionId, turnNumber, speakerTwinId, content, createdAt) VALUES (?,?,?,?,datetime('now'))`
        ).bind(input.sessionId, turnNumber, speaker.id, content).run();
        dialogues.push({ turnNumber, speakerTwinId: speaker.id, speakerName, content });
      }

      return { dialogues };
    }),
  analyze: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const dialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) {
        return { compatibilityScore: 0, summary: "分析にはマッチング対話の生成が必要です", strengths: [], challenges: [], recommendations: [] };
      }
      const twin1 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const twin1Name = twin1?.name || `Twin #${session.twin1Id}`;
      const twin2Name = twin2?.name || `Twin #${session.twin2Id}`;
      const transcript = dialogues.results.map((d: any) => `Turn ${d.turnNumber} (Twin ${d.speakerTwinId}): ${d.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);

      // Check personality profiles for both participants
      const initiatorUserId = session.initiatorUserId;
      const friendTwinUserId = twin2?.userId;
      let analyzeHasPersonality = false;
      let analyzePersonalityDim = "";
      if (initiatorUserId && friendTwinUserId) {
        const p1 = await ctx.env.DB.prepare(`SELECT bigFive, mbti FROM personality_profiles WHERE userId=? AND status='completed'`).bind(initiatorUserId).first<any>();
        const p2 = await ctx.env.DB.prepare(`SELECT bigFive, mbti FROM personality_profiles WHERE userId=? AND status='completed'`).bind(friendTwinUserId).first<any>();
        if (p1 && p2) {
          analyzeHasPersonality = true;
          analyzePersonalityDim = `,"personalityCompatibility":{"score":0,"reason":""}`;
        }
      }

      const analysisPrompt = `以下のビジネスマッチング対話を分析してください。\nテーマ: ${session.theme}\n参加者: ${twin1Name} vs ${twin2Name}\n\n対話:\n${transcript}\n\n以下のJSON形式で出力してください:\n{"compatibilityScore":0-100,"summary":"","strengths":[""],"challenges":[""],"recommendations":[""],"scoreBreakdown":{"skillMatch":{"score":0,"reason":""},"valueAlignment":{"score":0,"reason":""},"communicationStyle":{"score":0,"reason":""},"businessGoalFit":{"score":0,"reason":""},"complementaryStrengths":{"score":0,"reason":""}${analyzePersonalityDim}}}`;
      let analysis: any = { compatibilityScore: 65, summary: "対話分析の結果、一定の協業可能性があります。", strengths: ["共通の関心分野がある"], challenges: ["具体的な連携方法の検討が必要"], recommendations: ["定期的な情報交換の場を設ける"] };

      try {
        if (llmConfig) {
          const result = await invokeLLM(llmConfig, [{ role: "system", content: "あなたはビジネスマッチング分析の専門家です。JSON形式で回答してください。" }, { role: "user", content: analysisPrompt }], { maxTokens: 2048 });
          if (result.content) {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
          }
        }
      } catch { /* use fallback */ }

      // Upsert result
      const existing = await ctx.env.DB.prepare(`SELECT id FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
      if (existing) {
        await ctx.env.DB.prepare(
          `UPDATE matching_results SET compatibilityScore=?, summary=?, scoreBreakdown=?, strengths=?, challenges=?, recommendations=?, updatedAt=datetime('now') WHERE sessionId=?`
        ).bind(String(analysis.compatibilityScore), analysis.summary, toJson(analysis.scoreBreakdown || {}), toJson(analysis.strengths || []), toJson(analysis.challenges || []), toJson(analysis.recommendations || []), input.sessionId).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO matching_results (sessionId, compatibilityScore, summary, scoreBreakdown, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?,?)`
        ).bind(input.sessionId, String(analysis.compatibilityScore), analysis.summary, toJson(analysis.scoreBreakdown || {}), toJson(analysis.strengths || []), toJson(analysis.challenges || []), toJson(analysis.recommendations || [])).run();
      }

      return analysis;
    }),
  exportReport: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const twin1 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const dialogues = await ctx.env.DB.prepare(`SELECT id, sessionId, speakerTwinId, content, aiProvider, aiModel, turnNumber, createdAt FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
      const parsedResult = result ? {
        ...result,
        scoreBreakdown: parseJson<any>(result.scoreBreakdown),
        strengths: parseJson<string[]>(result.strengths),
        challenges: parseJson<string[]>(result.challenges),
        recommendations: parseJson<string[]>(result.recommendations),
      } : null;

      const score = parsedResult?.compatibilityScore ? parseFloat(parsedResult.compatibilityScore) : 0;
      const twin1Name = twin1?.name || `Twin #${session.twin1Id}`;
      const twin2Name = twin2?.name || `Twin #${session.twin2Id}`;
      const date = session.createdAt?.slice(0, 10) || "";
      const sb = parsedResult?.scoreBreakdown || {};

      const escHtml = (s: string | null | undefined) => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

      const breakdownDims: { label: string; key: string }[] = [
        { label: "スキルマッチ度", key: "skillMatch" },
        { label: "価値観の一致度", key: "valueAlignment" },
        { label: "コミュニケーション", key: "communicationStyle" },
        { label: "ビジネス目標適合度", key: "businessGoalFit" },
        { label: "相互補完性", key: "complementaryStrengths" },
      ];
      // Include personality compatibility row if it exists in the stored breakdown
      if (sb.personalityCompatibility) {
        breakdownDims.push({ label: "人格互換性", key: "personalityCompatibility" });
      }
      const breakdownRows = breakdownDims.map(({ label, key }) => {
        const d = sb[key] || {};
        return `<tr><td>${label}</td><td style="text-align:center;font-weight:bold">${d.score || 0}/20</td><td>${escHtml(d.reason)}</td></tr>`;
      }).join("");

      const listItems = (arr: string[] | null | undefined) =>
        arr && arr.length > 0 ? arr.map(s => `<li>${escHtml(s)}</li>`).join("") : "<li>データなし</li>";

      const dialogueHtml = (dialogues.results ?? []).map((d: any) => {
        const isTwin1 = d.speakerTwinId === session.twin1Id;
        const name = isTwin1 ? twin1Name : twin2Name;
        const bg = isTwin1 ? "#f0f4ff" : "#f0fff4";
        return `<div style="margin:8px 0;padding:12px;background:${bg};border-radius:8px"><strong>${escHtml(name)}</strong><p style="margin:4px 0 0">${escHtml(d.content)}</p></div>`;
      }).join("");

      const sectionHtml = (title: string, content: string | null | undefined) =>
        content ? `<div style="margin:16px 0"><h3>${title}</h3><div style="white-space:pre-wrap">${escHtml(content)}</div></div>` : "";

      const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>マッチングレポート - ${escHtml(session.theme)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1a1a2e;line-height:1.6}
  h1{color:#6366f1;border-bottom:3px solid #6366f1;padding-bottom:8px}
  h2{color:#4f46e5;margin-top:32px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  h3{color:#374151;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th,td{padding:8px 12px;border:1px solid #e5e7eb;text-align:left}
  th{background:#f8fafc;font-weight:600}
  .score-bar{background:#e5e7eb;border-radius:4px;height:24px;position:relative;overflow:hidden}
  .score-fill{background:linear-gradient(90deg,#6366f1,#818cf8);height:100%;border-radius:4px;transition:width 0.3s}
  .score-text{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-weight:bold;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3)}
  .meta{color:#6b7280;font-size:14px}
  ul{padding-left:20px}
  li{margin:4px 0}
  @media print{body{padding:0}h1{font-size:20px}h2{font-size:16px}}
</style></head><body>
<h1>マッチングレポート</h1>
<p class="meta">テーマ: <strong>${escHtml(session.theme)}</strong><br>
${escHtml(twin1Name)} × ${escHtml(twin2Name)}<br>
日付: ${date}</p>

<h2>相性スコア</h2>
<div style="text-align:center;font-size:48px;font-weight:bold;color:#6366f1;margin:16px 0">${score}%</div>
<div class="score-bar"><div class="score-fill" style="width:${score}%"></div><div class="score-text">${score}%</div></div>
${parsedResult?.summary ? `<p style="margin-top:12px"><strong>総合評価:</strong> ${escHtml(parsedResult.summary)}</p>` : ""}

<h2>スコア内訳</h2>
<table><thead><tr><th>観点</th><th style="width:80px">スコア</th><th>理由</th></tr></thead><tbody>${breakdownRows}</tbody></table>

<h2>強み</h2><ul>${listItems(parsedResult?.strengths)}</ul>
<h2>課題</h2><ul>${listItems(parsedResult?.challenges)}</ul>
<h2>提案</h2><ol>${parsedResult?.recommendations && parsedResult.recommendations.length > 0 ? parsedResult.recommendations.map((r: string) => `<li>${escHtml(r)}</li>`).join("") : "<li>データなし</li>"}</ol>

${parsedResult?.collaborationPotential ? `<h2>協業可能性</h2><p>${escHtml(parsedResult.collaborationPotential)}</p>` : ""}
${sectionHtml("役割分担", parsedResult?.roleDistribution)}
${sectionHtml("タイムライン", parsedResult?.timeline)}
${sectionHtml("必要リソース", parsedResult?.resources)}
${sectionHtml("期待成果・KPI", parsedResult?.kpis)}
${sectionHtml("明日からできるアクション", parsedResult?.nextSteps)}
${parsedResult?.detailedAnalysis ? `<h2>詳細分析</h2><div style="white-space:pre-wrap">${escHtml(parsedResult.detailedAnalysis)}</div>` : ""}

<h2>対話履歴（${(dialogues.results ?? []).length}ターン）</h2>
${dialogueHtml || "<p>対話がまだ行われていません</p>"}

<hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
<p class="meta" style="text-align:center">分身AI マッチングレポート | ${date}</p>
</body></html>`;

      return { html };
    }),
  exportData: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const ms = await ctx.env.DB.prepare(
        `SELECT ms.*, t1.name as twin1Name, t2.name as twin2Name
         FROM matching_sessions ms
         LEFT JOIN digital_twins t1 ON t1.id=ms.twin1Id
         LEFT JOIN digital_twins t2 ON t2.id=ms.twin2Id
         WHERE ms.id=? AND ms.initiatorUserId=?`
      ).bind(input.sessionId, ctx.userId).first<any>();
      if (!ms) throw new TRPCError({ code: "NOT_FOUND" });

      const dialogues = await ctx.env.DB.prepare(
        `SELECT md.*, dt.name as speakerName FROM matching_dialogues md LEFT JOIN digital_twins dt ON dt.id=md.speakerTwinId WHERE md.sessionId=? ORDER BY md.turnNumber`
      ).bind(input.sessionId).all<any>();
      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();

      return {
        session: { id: ms.id, theme: ms.theme, twin1: ms.twin1Name, twin2: ms.twin2Name, createdAt: ms.createdAt, completedAt: ms.completedAt },
        dialogues: (dialogues.results ?? []).map((d: any) => ({ turn: d.turnNumber, speaker: d.speakerName, content: d.content, createdAt: d.createdAt })),
        result: result ? {
          score: result.compatibilityScore,
          summary: result.summary,
          strengths: parseJson(result.strengths),
          challenges: parseJson(result.challenges),
          recommendations: parseJson(result.recommendations),
        } : null,
      };
    }),
  // ---- Score-based candidate discovery (+-20 trust score) ----
  discoverCandidates: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const myTrust = await ctx.env.DB.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();
    const myScore = myTrust?.score ?? 0;
    const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
    const myTags: string[] = myTwin?.tags || [];

    // Bulk fetch friend IDs
    const friendRows = await ctx.env.DB.prepare(
      `SELECT CASE WHEN userId=? THEN friendId ELSE userId END as fId
       FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
    ).bind(ctx.userId, ctx.userId, ctx.userId).all<any>();
    const friendIdSet = new Set((friendRows.results ?? []).map((r: any) => r.fId));

    // Bulk fetch active matching requests
    const reqRows = await ctx.env.DB.prepare(
      `SELECT id, status, senderUserId, receiverUserId FROM matching_requests
       WHERE (senderUserId=? OR receiverUserId=?) AND status != 'rejected'
       ORDER BY createdAt DESC`
    ).bind(ctx.userId, ctx.userId).all<any>();
    const reqByUser = new Map<number, any>();
    for (const r of reqRows.results ?? []) {
      const otherId = r.senderUserId === ctx.userId ? r.receiverUserId : r.senderUserId;
      if (!reqByUser.has(otherId)) reqByUser.set(otherId, r);
    }

    // Single enriched query with JOINs
    const rows = await ctx.env.DB.prepare(
      `SELECT u.id, u.name, u.friendCode, ts.score as trustScore,
        dt.id as twinId, dt.name as twinName, dt.description as twinDesc, dt.tags as twinTags,
        up.displayName, up.bio, up.company, up.industry, up.position
       FROM users u
       LEFT JOIN trust_scores ts ON ts.userId = u.id
       LEFT JOIN digital_twins dt ON dt.userId = u.id
       LEFT JOIN user_profiles up ON up.userId = u.id
       WHERE u.id != ? AND u.isNpc = 0
         AND ABS(COALESCE(ts.score, 0) - ?) <= 20
       ORDER BY ABS(COALESCE(ts.score, 0) - ?) ASC
       LIMIT 30`
    ).bind(ctx.userId, myScore, myScore).all<any>();

    // Get my profile for industry matching
    const myProfile = await ctx.env.DB.prepare(`SELECT industry FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

    const candidates = (rows.results ?? []).map((r: any) => {
      const twinTags: string[] = parseJson<string[]>(r.twinTags) ?? [];
      const commonTags = myTags.filter((t: string) => twinTags.map((s: string) => s.toLowerCase()).includes(t.toLowerCase()));
      const req = reqByUser.get(r.id);

      // Compute relevance score for sorting
      let relevance = 0;
      relevance += commonTags.length * 10;  // tag overlap is strongest signal
      if (r.industry && myProfile?.industry && r.industry.toLowerCase() === myProfile.industry.toLowerCase()) relevance += 15;
      if (r.twinId) relevance += 5;  // has a twin
      if (r.bio) relevance += 3;
      if (r.company) relevance += 2;
      relevance -= Math.abs((r.trustScore ?? 0) - myScore);  // closer trust score = better

      return {
        userId: r.id,
        name: r.displayName || r.name,
        company: r.company || null,
        industry: r.industry || null,
        bio: r.bio || null,
        trustScore: r.trustScore ?? 0,
        scoreDiff: (r.trustScore ?? 0) - myScore,
        isFriend: friendIdSet.has(r.id),
        twin: r.twinId ? { id: r.twinId, name: r.twinName, description: r.twinDesc, tags: twinTags } : null,
        commonTags,
        requestStatus: req?.status ?? null,
        requestDirection: req ? (req.senderUserId === ctx.userId ? "sent" : "received") : null,
        requestId: req?.id ?? null,
        relevance,
      };
    });

    // Sort by relevance (best matches first)
    candidates.sort((a, b) => b.relevance - a.relevance);
    return candidates;
  }),
  sendRequest: protectedProcedure
    .input(z.object({ receiverUserId: z.number(), message: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (input.receiverUserId === ctx.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "自分にはリクエストを送れません" });

      // Check target exists and is not NPC
      const target = await ctx.env.DB.prepare(`SELECT id, isNpc FROM users WHERE id=?`).bind(input.receiverUserId).first<any>();
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "ユーザーが見つかりません" });
      if (target.isNpc === 1) throw new TRPCError({ code: "BAD_REQUEST", message: "NPCにはリクエストを送れません" });

      // Check for existing pending request
      const existing = await ctx.env.DB.prepare(
        `SELECT id FROM matching_requests WHERE senderUserId=? AND receiverUserId=? AND status='pending'`
      ).bind(ctx.userId, input.receiverUserId).first<any>();
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "すでにリクエストを送信済みです" });

      const res = await ctx.env.DB.prepare(
        `INSERT INTO matching_requests (senderUserId, receiverUserId, status, message) VALUES (?,?,'pending',?)`
      ).bind(ctx.userId, input.receiverUserId, input.message || null).run();

      await addTrustAction(ctx.env.DB, ctx.userId, "matching_request_sent", 2, "マッチングリクエスト送信");

      // Notify receiver
      const senderName = ctx.user?.name || "ユーザー";
      await createNotification(ctx.env.DB, input.receiverUserId, "matching_request", "マッチングリクエスト", `${senderName}さんからマッチングリクエストが届きました`, { link: "/matching" });

      return { id: Number(res.meta.last_row_id) };
    }),
  receivedRequests: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const myTrust = await ctx.env.DB.prepare(`SELECT score FROM trust_scores WHERE userId=?`).bind(ctx.userId).first<any>();
    const myScore = myTrust?.score ?? 0;

    const rows = await ctx.env.DB.prepare(
      `SELECT mr.id, mr.senderUserId, mr.message, mr.createdAt,
        u.name as senderName, ts.score as senderTrustScore,
        up.displayName, up.bio, up.company, up.industry,
        dt.name as twinName, dt.description as twinDesc, dt.tags as twinTags
       FROM matching_requests mr
       JOIN users u ON u.id = mr.senderUserId
       LEFT JOIN trust_scores ts ON ts.userId = mr.senderUserId
       LEFT JOIN user_profiles up ON up.userId = mr.senderUserId
       LEFT JOIN digital_twins dt ON dt.userId = mr.senderUserId
       WHERE mr.receiverUserId = ? AND mr.status = 'pending'
       ORDER BY mr.createdAt DESC`
    ).bind(ctx.userId).all<any>();

    return (rows.results ?? []).map((r: any) => ({
      id: r.id,
      senderUserId: r.senderUserId,
      senderName: r.displayName || r.senderName,
      senderCompany: r.company || null,
      senderIndustry: r.industry || null,
      senderBio: r.bio || null,
      senderTrustScore: r.senderTrustScore ?? 0,
      scoreDiff: (r.senderTrustScore ?? 0) - myScore,
      message: r.message,
      twin: r.twinName ? { name: r.twinName, description: r.twinDesc, tags: parseJson<string[]>(r.twinTags) ?? [] } : null,
      createdAt: r.createdAt,
    }));
  }),
  sentRequests: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT mr.id, mr.receiverUserId, mr.status, mr.message, mr.createdAt,
        u.name as receiverName, ts.score as receiverTrustScore,
        up.displayName, up.company
       FROM matching_requests mr
       JOIN users u ON u.id = mr.receiverUserId
       LEFT JOIN trust_scores ts ON ts.userId = mr.receiverUserId
       LEFT JOIN user_profiles up ON up.userId = mr.receiverUserId
       WHERE mr.senderUserId = ?
       ORDER BY mr.createdAt DESC`
    ).bind(ctx.userId).all<any>();

    return (rows.results ?? []).map((r: any) => ({
      id: r.id,
      receiverUserId: r.receiverUserId,
      receiverName: r.displayName || r.receiverName,
      receiverCompany: r.company || null,
      receiverTrustScore: r.receiverTrustScore ?? 0,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
    }));
  }),
  acceptRequest: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const req = await ctx.env.DB.prepare(
        `SELECT * FROM matching_requests WHERE id=? AND receiverUserId=? AND status='pending'`
      ).bind(input.requestId, ctx.userId).first<any>();
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "リクエストが見つかりません" });

      await ctx.env.DB.prepare(
        `UPDATE matching_requests SET status='accepted', updatedAt=datetime('now') WHERE id=?`
      ).bind(input.requestId).run();

      // Auto-create friendship if not already friends
      const existingFriend = await ctx.env.DB.prepare(
        `SELECT id FROM friendships WHERE ((userId=? AND friendId=?) OR (userId=? AND friendId=?)) AND status='accepted'`
      ).bind(ctx.userId, req.senderUserId, req.senderUserId, ctx.userId).first<any>();
      if (!existingFriend) {
        await ctx.env.DB.prepare(
          `INSERT INTO friendships (userId, friendId, status) VALUES (?,?,'accepted')`
        ).bind(req.senderUserId, ctx.userId).run();
      }

      await addTrustAction(ctx.env.DB, ctx.userId, "matching_request_accepted", 3, "マッチングリクエスト承認");
      await addTrustAction(ctx.env.DB, req.senderUserId, "matching_request_accepted", 3, "マッチングリクエストが承認されました");

      // Notify sender that request was accepted
      const accepterName = ctx.user?.name || "ユーザー";
      await createNotification(ctx.env.DB, req.senderUserId, "matching_accepted", "マッチングリクエスト承認", `${accepterName}さんがマッチングリクエストを承認しました`, { link: "/matching" });

      return { success: true };
    }),
  rejectRequest: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE matching_requests SET status='rejected', updatedAt=datetime('now') WHERE id=? AND receiverUserId=?`
      ).bind(input.requestId, ctx.userId).run();
      return { success: true };
    }),

  // ============ Feature 1: Friend Invite ============
  inviteFriend: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.initiatorUserId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN", message: "招待はセッション作成者のみ可能です" });
      const settings = parseJson<any>(session.settings) || {};
      const friendId = settings.friendId;
      if (!friendId) throw new TRPCError({ code: "BAD_REQUEST", message: "友達IDが設定されていません" });
      const initiator = await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      await notifyMatchingInvite(ctx.env.DB, friendId, initiator?.name || "ユーザー", session.theme, input.sessionId, ctx.env);
      return { sent: true, friendId };
    }),

  // ============ Group Matching (3-5 participants) ============
  createGroup: protectedProcedure
    .input(z.object({
      friendIds: z.array(z.number()).min(2).max(4),
      theme: z.string().min(1).max(500),
      turns: z.number().min(1).max(20).default(5),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Plan limits
      const userRow = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      const userPlan = userRow?.plan || "free";
      const monthlyLimits: Record<string, number> = { free: 3, premium: 30, enterprise: -1 };
      const maxMatchings = monthlyLimits[userPlan] ?? 3;
      if (maxMatchings !== -1) {
        const usageRow = await ctx.env.DB.prepare(`SELECT matchingsThisMonth FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
        if ((usageRow?.matchingsThisMonth ?? 0) >= maxMatchings) {
          throw new TRPCError({ code: "FORBIDDEN", message: `月間マッチング上限（${maxMatchings}回）に達しました。` });
        }
      }

      const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!myTwin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });

      // Gather all participant twins
      const participants: { userId: number; twinId: number; twinName: string; twinDesc: string; twinPersonality: string; profile: any }[] = [
        { userId: ctx.userId, twinId: myTwin.id, twinName: myTwin.name, twinDesc: myTwin.description || "", twinPersonality: myTwin.personality || "", profile: null },
      ];

      const myProfile = await ctx.env.DB.prepare(`SELECT company, industry, position, skills, expertise FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
      participants[0].profile = myProfile;

      for (const friendId of input.friendIds) {
        const friendTwin = await ctx.env.DB.prepare(`SELECT id, userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, virtueWaveform, mineWaveform, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, avatarUrl, visibility, allowedViewerIds, createdAt, updatedAt FROM digital_twins WHERE userId=? LIMIT 1`).bind(friendId).first<any>();
        if (!friendTwin) throw new TRPCError({ code: "NOT_FOUND", message: `友達 #${friendId} の分身AIがありません` });
        const friendProfile = await ctx.env.DB.prepare(`SELECT company, industry, position, skills, expertise FROM user_profiles WHERE userId=?`).bind(friendId).first<any>();
        const nt = normalizeTwin(friendTwin);
        participants.push({
          userId: friendId,
          twinId: friendTwin.id,
          twinName: nt?.name || friendTwin.name,
          twinDesc: friendTwin.description || "",
          twinPersonality: friendTwin.personality || "",
          profile: friendProfile,
        });
      }

      // Create session — twin1Id/twin2Id = first two, rest in participants table
      const sessionRes = await ctx.env.DB.prepare(
        `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'running',?)`
      ).bind(ctx.userId, participants[0].twinId, participants[1].twinId, input.theme,
        toJson({ type: "group", turns: input.turns, friendIds: input.friendIds, participantCount: participants.length })).run();
      const sessionId = Number(sessionRes.meta.last_row_id);

      // Increment matching usage counter
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`INSERT OR IGNORE INTO usage_tracking (userId, matchingsThisMonth) VALUES (?, 0)`).bind(ctx.userId),
        ctx.env.DB.prepare(`UPDATE usage_tracking SET matchingsThisMonth = matchingsThisMonth + 1, updatedAt = datetime('now') WHERE userId = ?`).bind(ctx.userId),
      ]);

      // Insert all participants
      for (let i = 0; i < participants.length; i++) {
        await ctx.env.DB.prepare(
          `INSERT INTO matching_session_participants (sessionId, userId, twinId, position) VALUES (?,?,?,?)`
        ).bind(sessionId, participants[i].userId, participants[i].twinId, i).run();
      }

      // Generate round-robin dialogue
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      const dialogueHistory: { speaker: string; content: string }[] = [];
      const turnsToRun = Math.min(input.turns * participants.length, 30); // total turn count

      for (let turn = 0; turn < turnsToRun; turn++) {
        const speakerIdx = turn % participants.length;
        const speaker = participants[speakerIdx];

        let profileCtx = "";
        if (speaker.profile) {
          const p = speaker.profile;
          if (p.company) profileCtx += `所属: ${p.company}。`;
          if (p.industry) profileCtx += `業界: ${p.industry}。`;
          if (p.position) profileCtx += `役職: ${p.position}。`;
          if (p.skills || p.expertise) profileCtx += `得意分野: ${p.skills || p.expertise}。`;
        }

        const otherNames = participants.filter((_, i) => i !== speakerIdx).map(p => p.twinName).join("、");
        const systemPrompt = `あなたは「${speaker.twinName}」というデジタル分身AIです。${speaker.twinDesc ? `説明: ${speaker.twinDesc}。` : ""}${speaker.twinPersonality ? `性格: ${speaker.twinPersonality}。` : ""}${profileCtx}
テーマ「${input.theme}」について${otherNames}とグループディスカッションをしています。
他の参加者の発言を踏まえ、建設的な意見を述べてください。簡潔に（100〜250文字程度）。`;

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
        ];
        for (const d of dialogueHistory.slice(-10)) {
          messages.push({
            role: d.speaker === speaker.twinName ? "assistant" : "user",
            content: `${d.speaker}: ${d.content}`,
          });
        }
        if (turn === 0) {
          messages.push({ role: "user", content: `テーマ「${input.theme}」についてグループディスカッションを始めてください。` });
        }

        let content = `${speaker.twinName}として、「${input.theme}」についてコメントします。`;
        let provider = "scripted-fallback";
        let model = "group-dialogue-v1";

        try {
          if (llmConfig) {
            const result = await invokeLLM(llmConfig, messages, { maxTokens: 400, temperature: 0.8 });
            if (result.content && result.content.length >= 10) {
              content = result.content.replace(new RegExp(`^${speaker.twinName}:\\s*`, "i"), "").trim();
              provider = result.provider;
              model = result.model;
            }
          }
        } catch { /* use fallback */ }

        dialogueHistory.push({ speaker: speaker.twinName, content });
        await ctx.env.DB.prepare(
          `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES (?,?,?,?,?,?)`
        ).bind(sessionId, speaker.twinId, content, turn, provider, model).run();
      }

      // Group analysis — pairwise compatibility + overall
      try {
        if (llmConfig) {
          const participantSummaries = participants.map(p => {
            const parts = [p.twinName];
            if (p.profile?.company) parts.push(`所属: ${p.profile.company}`);
            if (p.profile?.industry) parts.push(`業界: ${p.profile.industry}`);
            if (p.twinDesc) parts.push(`説明: ${p.twinDesc}`);
            return parts.join("、");
          });

          const dialogueText = dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n");

          const pairNames: string[] = [];
          for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
              pairNames.push(`"${participants[i].twinName} × ${participants[j].twinName}": {"score": (0-100), "summary": "一言評価"}`);
            }
          }

          const analysisPrompt = `以下は${participants.length}人によるグループマッチング対話です。テーマ: ${input.theme}

参加者:
${participantSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}

対話内容:
${dialogueText}

以下のJSON形式で分析結果を返してください（日本語で）:
{
  "overallScore": (0-100),
  "summary": "グループ全体の相性評価",
  "pairwise": {
    ${pairNames.join(",\n    ")}
  },
  "strengths": ["強み1", "強み2", "強み3"],
  "challenges": ["課題1", "課題2"],
  "recommendations": ["提案1", "提案2", "提案3"],
  "groupDynamics": "グループダイナミクスの分析マークダウン"
}

JSONのみ出力してください。`;

          const analysisResult = await invokeLLM(llmConfig, [
            { role: "system", content: "あなたはグループビジネスマッチングの専門アナリストです。" },
            { role: "user", content: analysisPrompt },
          ], { maxTokens: 4096, temperature: 0.5 });

          let analysis: any;
          try {
            const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
            analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          } catch { analysis = null; }

          if (analysis) {
            await ctx.env.DB.prepare(
              `INSERT INTO matching_results (sessionId, compatibilityScore, summary, strengths, challenges, recommendations, detailedAnalysis, scoreBreakdown) VALUES (?,?,?,?,?,?,?,?)`
            ).bind(
              sessionId,
              analysis.overallScore ?? 60,
              analysis.summary ?? "",
              toJson(analysis.strengths),
              toJson(analysis.challenges),
              toJson(analysis.recommendations),
              analysis.groupDynamics ?? "",
              toJson(analysis.pairwise || {}),
            ).run();
          } else {
            await ctx.env.DB.prepare(
              `INSERT INTO matching_results (sessionId, compatibilityScore, summary, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?)`
            ).bind(sessionId, 65, "グループ対話の結果、複数の協業可能性が見つかりました。", toJson(["多様な視点がある"]), toJson(["合意形成に時間が必要"]), toJson(["定期的なグループミーティングを設定する"])).run();
          }
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, summary, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?)`
          ).bind(sessionId, 65, "グループ対話の結果、協業の可能性があります。", toJson(["共通の関心分野"]), toJson(["役割分担の検討が必要"]), toJson(["まずは小規模プロジェクトから"])).run();
        }
      } catch {
        try {
          await ctx.env.DB.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, summary) VALUES (?,?,?)`
          ).bind(sessionId, 60, "グループ分析が完了しました。").run();
        } catch { /* ignore duplicate */ }
      }

      await ctx.env.DB.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
      await addTrustAction(ctx.env.DB, ctx.userId, "group_matching_complete", 8, `グループマッチング完了: ${input.theme}`);

      return { sessionId, participantCount: participants.length };
    }),
  getGroupSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id, initiatorUserId, twin1Id, twin2Id, theme, status, settings, createdAt, completedAt FROM matching_sessions WHERE id=?`).bind(input.id).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const settings = parseJson<any>(session.settings) || {};
      if (settings.type !== "group") throw new TRPCError({ code: "BAD_REQUEST", message: "グループセッションではありません" });

      const participantRows = await ctx.env.DB.prepare(
        `SELECT msp.*, u.name as userName, dt.name as twinName, dt.description as twinDesc, up.avatarUrl
         FROM matching_session_participants msp
         JOIN users u ON u.id = msp.userId
         JOIN digital_twins dt ON dt.id = msp.twinId
         LEFT JOIN user_profiles up ON up.userId = msp.userId
         WHERE msp.sessionId = ?
         ORDER BY msp.position`
      ).bind(input.id).all<any>();

      const dialogues = await ctx.env.DB.prepare(
        `SELECT md.*, dt.name as speakerName FROM matching_dialogues md
         LEFT JOIN digital_twins dt ON dt.id = md.speakerTwinId
         WHERE md.sessionId = ? ORDER BY md.turnNumber`
      ).bind(input.id).all<any>();

      const result = await ctx.env.DB.prepare(`SELECT id, sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, roleDistribution, timeline, resources, kpis, nextSteps, webSearchData, createdAt FROM matching_results WHERE sessionId=?`).bind(input.id).first<any>();

      return {
        session: { ...session, settings },
        participants: (participantRows.results ?? []).map((p: any) => ({
          userId: p.userId,
          twinId: p.twinId,
          position: p.position,
          userName: p.userName,
          twinName: p.twinName,
          twinDesc: p.twinDesc,
          avatarUrl: p.avatarUrl || null,
        })),
        dialogues: dialogues.results ?? [],
        result: result ? {
          ...result,
          scoreBreakdown: parseJson<any>(result.scoreBreakdown),
          strengths: parseJson<string[]>(result.strengths),
          challenges: parseJson<string[]>(result.challenges),
          recommendations: parseJson<string[]>(result.recommendations),
        } : null,
      };
    }),
  getComments: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT mc.*, u.name as userName FROM matching_comments mc LEFT JOIN users u ON u.id = mc.userId WHERE mc.sessionId=? ORDER BY mc.createdAt ASC`
      ).bind(input.sessionId).all<any>();
      return rows.results ?? [];
    }),
  getReactions: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT mr.*, u.name as userName FROM matching_reactions mr LEFT JOIN users u ON u.id = mr.userId WHERE mr.sessionId=? ORDER BY mr.createdAt ASC`
      ).bind(input.sessionId).all<any>();
      return rows.results ?? [];
    }),
  quickStart: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);

    // 1. Check if user qualifies for quick start (0-3 completed matchings)
    const countResult = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`
    ).bind(ctx.userId).first<any>();
    const completedCount = countResult?.cnt || 0;
    if (completedCount > 3) {
      return { eligible: false, completedCount, friends: [], suggestedThemes: [] };
    }

    // 2. Get friends with twins
    const friendRows = await ctx.env.DB.prepare(
      `SELECT u.id as friendId, u.name as friendName, u.isNpc as isNpc,
        dt.id as twinId, dt.name as twinName, dt.description as twinDesc, dt.tags as twinTags,
        up.avatarUrl as avatarUrl, up.company as company, up.position as position
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END
        LEFT JOIN digital_twins dt ON dt.userId = u.id
        LEFT JOIN user_profiles up ON up.userId = u.id
        WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted' AND dt.id IS NOT NULL
        ORDER BY u.isNpc DESC, f.createdAt DESC
        LIMIT 10`
    ).bind(ctx.userId, ctx.userId, ctx.userId).all();
    const friends = (friendRows.results || []).map((r: any) => ({
      friendId: r.friendId,
      friendName: r.friendName,
      isNpc: !!r.isNpc,
      twinId: r.twinId,
      twinName: r.twinName,
      twinDesc: (r.twinDesc || "").substring(0, 80),
      twinTags: (r.twinTags || "").split(",").filter(Boolean).slice(0, 3),
      avatarUrl: r.avatarUrl || "",
      company: r.company || "",
      position: r.position || "",
    }));

    // 3. Suggest themes based on user profile + twin data
    const myTwin = await getMyTwin(ctx.env.DB, ctx.userId);
    const profile = await ctx.env.DB.prepare(`SELECT id, userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position, avatarUrl, createdAt, updatedAt FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();
    const industry = profile?.industry || "";
    const skills = (myTwin?.tags || "").split(",").filter(Boolean);

    const baseThemes = [
      "AI活用による業務効率化の可能性について",
      "新規事業のアイデアブレインストーミング",
      "お互いの強みを活かしたコラボレーション提案",
      "業界トレンドと今後のビジネス機会について",
      "リーダーシップと組織マネジメントの課題共有",
    ];
    const industryThemes: Record<string, string[]> = {
      "IT": ["最新テクノロジートレンドと事業への応用", "DX推進の課題と成功事例"],
      "金融": ["フィンテック活用の未来", "リスク管理とイノベーションの両立"],
      "製造": ["製造業DXの最前線", "サプライチェーン最適化戦略"],
      "医療": ["ヘルステック最新動向", "医療AIの可能性と課題"],
      "教育": ["EdTech活用の最前線", "次世代の学習体験デザイン"],
      "不動産": ["不動産テック活用戦略", "都市開発と持続可能性"],
    };
    const suggestedThemes = [...baseThemes];
    if (industry && industryThemes[industry]) {
      suggestedThemes.unshift(...industryThemes[industry]);
    }
    if (skills.length > 0) {
      suggestedThemes.unshift(`${skills[0]}分野での協業可能性について`);
    }
    // Deduplicate and limit to 8
    const uniqueThemes = Array.from(new Set(suggestedThemes)).slice(0, 8);

    return {
      eligible: true,
      completedCount,
      friends,
      suggestedThemes: uniqueThemes,
      defaultTurns: completedCount === 0 ? 3 : 5,
    };
  }),

});
