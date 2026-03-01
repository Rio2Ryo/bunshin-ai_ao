import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin, normalizeTwin, addTrustAction } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { createNotification, notifyMatchingComplete } from "../notifications";

// ============ Web Search (Tavily) ============

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

type TavilyResponse = {
  answer?: string;
  query: string;
  results: TavilySearchResult[];
};

/** Search the web using Tavily API */
async function searchWithTavily(
  query: string,
  apiKey: string,
  options?: { maxResults?: number; searchDepth?: "basic" | "advanced" }
): Promise<TavilyResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: options?.searchDepth || "basic",
      max_results: options?.maxResults || 5,
      include_answer: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily API error ${res.status}: ${err}`);
  }
  return res.json() as Promise<TavilyResponse>;
}

/** Generate search queries from dialogue context using LLM */
async function generateSearchQueries(
  llmConfig: any,
  theme: string,
  dialogueContext: string,
): Promise<string[]> {
  const result = await invokeLLM(llmConfig, [
    {
      role: "system",
      content: `あなたはビジネスマッチングの対話を分析し、有用な情報を検索するためのクエリを生成する専門家です。
対話の文脈から、具体的なビジネス提案や協業に役立つ情報を検索するためのクエリを2つ生成してください。
JSON形式で出力: {"queries":["クエリ1","クエリ2"]}`,
    },
    {
      role: "user",
      content: `テーマ: ${theme}\n\n対話内容:\n${dialogueContext}\n\nJSONのみ出力してください。`,
    },
  ], { maxTokens: 256, temperature: 0.3 });

  try {
    const match = result.content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return (parsed.queries || []).slice(0, 2);
    }
  } catch { /* ignore parse errors */ }
  // Fallback: just use the theme
  return [theme];
}

/** Format search results into context for LLM dialogue */
function formatSearchContext(results: TavilyResponse[]): string {
  if (!results.length) return "";
  const lines: string[] = ["【Web検索結果（リアルタイム情報）】"];
  for (const r of results) {
    if (r.answer) lines.push(`■ ${r.query}: ${r.answer}`);
    for (const item of (r.results || []).slice(0, 3)) {
      lines.push(`・${item.title}: ${item.content.slice(0, 200)}`);
    }
  }
  lines.push("\n上記の検索結果を参考に、具体的な数字や事例を含めて発言してください。");
  return lines.join("\n");
}

// ============ Matching Router ============

export const matchingRouter = router({
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
    return (rows.results ?? []).map((r: any) => ({
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
      compatibilityScore: r.compatibilityScore ?? null,
      resultSummary: r.resultSummary ?? null,
    }));
  }),
  getSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.id).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const dialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.id).all<any>();
      const result = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.id).first<any>();
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
      const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
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
          const variantIdx = Math.floor(Math.random() * fallbackDialogues[twinKey].length);
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

        const analysisPrompt = `以下は「${twins[0].name}」と「${twins[1].name}」のビジネスマッチング対話です。テーマ: ${input.theme}

参加者情報:
- ${profileSummaries[0]}
- ${profileSummaries[1]}
${webSearchSummary}

${dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n")}

以下のJSON形式で分析結果を返してください（日本語で）:
{
  "compatibilityScore": (0-100の数値),
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
    "complementaryStrengths": {"score": (0-20), "reason": "理由"}
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
          // Validate and fix score consistency: 5 sub-scores (0-20 each) must sum to compatibilityScore
          if (analysis.scoreBreakdown) {
            const dims = ["skillMatch", "valueAlignment", "communicationStyle", "businessGoalFit", "complementaryStrengths"];
            let computedTotal = 0;
            for (const dim of dims) {
              const sub = analysis.scoreBreakdown[dim];
              if (sub && typeof sub.score === "number") {
                sub.score = Math.max(0, Math.min(20, Math.round(sub.score)));
                computedTotal += sub.score;
              }
            }
            // Use computed sum (more reliable than LLM self-reported total)
            if (computedTotal > 0) {
              analysis.compatibilityScore = computedTotal;
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
          const defaultAnalysis = {
            compatibilityScore: isNpcMatch ? 75 : 65,
            summary: "対話を通じて、双方に協業の可能性が見つかりました。共通の関心分野があり、互いの強みを活かせる領域が確認できました。",
            collaborationPotential: "お互いのスキルセットが補完的であり、段階的な協業から始めることで大きな成果が期待できます。",
            strengths: ["共通の関心テーマがある", "コミュニケーションスタイルが建設的", "互いの専門分野が補完的"],
            challenges: ["具体的な協業プランの策定が必要", "リソース配分の合意形成"],
            recommendations: ["月次の定期ミーティングを設定する", "小規模なPoCプロジェクトから開始する", "成果指標を明確にして進捗を共有する"],
            scoreBreakdown: { skillMatch: { score: isNpcMatch ? 16 : 13, reason: "関連するスキルセットを持っている" }, valueAlignment: { score: isNpcMatch ? 15 : 13, reason: "基本的な価値観が一致している" }, communicationStyle: { score: isNpcMatch ? 15 : 13, reason: "建設的な対話ができている" }, businessGoalFit: { score: isNpcMatch ? 14 : 13, reason: "ビジネス目標に一定の親和性がある" }, complementaryStrengths: { score: isNpcMatch ? 15 : 13, reason: "相互補完的な強みがある" } },
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

      // Send matching completion notification
      try {
        const result = await ctx.env.DB.prepare(`SELECT compatibilityScore FROM matching_results WHERE sessionId=?`).bind(sessionId).first<any>();
        const score = result?.compatibilityScore ? parseFloat(result.compatibilityScore) : 0;
        await notifyMatchingComplete(ctx.env.DB, ctx.userId, input.theme, score, ctx.env);
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
      const friendTwin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(input.friendId).first<any>();
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

      return { sessionId };
    }),
  runDialogue: protectedProcedure
    .input(z.object({ sessionId: z.number(), turns: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      if (!twin1 || !twin2) throw new TRPCError({ code: "NOT_FOUND", message: "ツインが見つかりません" });

      const existingDialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
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
      const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const dialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
      if (!dialogues.results?.length) {
        return { compatibilityScore: 0, summary: "分析にはマッチング対話の生成が必要です", strengths: [], challenges: [], recommendations: [] };
      }
      const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const twin1Name = twin1?.name || `Twin #${session.twin1Id}`;
      const twin2Name = twin2?.name || `Twin #${session.twin2Id}`;
      const transcript = dialogues.results.map((d: any) => `Turn ${d.turnNumber} (Twin ${d.speakerTwinId}): ${d.content}`).join("\n");

      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "matching", ctx.env);
      const analysisPrompt = `以下のビジネスマッチング対話を分析してください。\nテーマ: ${session.theme}\n参加者: ${twin1Name} vs ${twin2Name}\n\n対話:\n${transcript}\n\n以下のJSON形式で出力してください:\n{"compatibilityScore":0-100,"summary":"","strengths":[""],"challenges":[""],"recommendations":[""],"scoreBreakdown":{"skillMatch":{"score":0,"reason":""},"valueAlignment":{"score":0,"reason":""},"communicationStyle":{"score":0,"reason":""},"businessGoalFit":{"score":0,"reason":""},"complementaryStrengths":{"score":0,"reason":""}}}`;
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
      const session = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(input.sessionId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const twin1 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const dialogues = await ctx.env.DB.prepare(`SELECT * FROM matching_dialogues WHERE sessionId=? ORDER BY turnNumber`).bind(input.sessionId).all<any>();
      const result = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();
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

      const breakdownRows = [
        { label: "スキルマッチ度", key: "skillMatch" },
        { label: "価値観の一致度", key: "valueAlignment" },
        { label: "コミュニケーション", key: "communicationStyle" },
        { label: "ビジネス目標適合度", key: "businessGoalFit" },
        { label: "相互補完性", key: "complementaryStrengths" },
      ].map(({ label, key }) => {
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
      const result = await ctx.env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(input.sessionId).first<any>();

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
});
