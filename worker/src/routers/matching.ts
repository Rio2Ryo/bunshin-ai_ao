import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin, normalizeTwin, addTrustAction, recordFriendActivity } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";
import { createNotification, notifyMatchingComplete, notifyMatchingInvite, sendMatchingReportEmail } from "../notifications";

// ============ Matching Streak Helper ============

async function updateMatchingStreakForUser(db: D1Database, userId: number): Promise<{ currentStreak: number; bonusAwarded: number }> {
  const today = new Date().toISOString().slice(0, 10);
  let streak = await db.prepare(
    `SELECT * FROM matching_streaks WHERE userId=?`
  ).bind(userId).first<any>();
  if (!streak) {
    await db.prepare(
      `INSERT INTO matching_streaks (userId, currentStreak, longestStreak, lastMatchDate, totalBonusEarned) VALUES (?, 1, 1, ?, 0)`
    ).bind(userId, today).run();
    // Auto-unlock first_matching achievement
    await db.prepare(
      `INSERT OR IGNORE INTO matching_achievements (userId, achievementKey) VALUES (?, 'first_matching')`
    ).bind(userId).run();
    return { currentStreak: 1, bonusAwarded: 0 };
  }
  // Already recorded today
  if (streak.lastMatchDate === today) {
    return { currentStreak: streak.currentStreak, bonusAwarded: 0 };
  }
  const lastDate = streak.lastMatchDate ? new Date(streak.lastMatchDate) : null;
  const todayDate = new Date(today);
  let newStreak = 1;
  if (lastDate) {
    const diffMs = todayDate.getTime() - lastDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      newStreak = (streak.currentStreak || 0) + 1;
    }
  }
  const longestStreak = Math.max(newStreak, streak.longestStreak || 0);
  // Check streak bonuses
  const STREAK_BONUSES = [
    { days: 3, bonus: 10 },
    { days: 7, bonus: 30 },
    { days: 30, bonus: 100 },
  ];
  let bonusAwarded = 0;
  for (const sb of STREAK_BONUSES) {
    if (newStreak >= sb.days && (streak.currentStreak || 0) < sb.days) {
      bonusAwarded += sb.bonus;
    }
  }
  const totalBonusEarned = (streak.totalBonusEarned || 0) + bonusAwarded;
  await db.prepare(
    `UPDATE matching_streaks SET currentStreak=?, longestStreak=?, lastMatchDate=?, totalBonusEarned=?, updatedAt=datetime('now') WHERE userId=?`
  ).bind(newStreak, longestStreak, today, totalBonusEarned, userId).run();
  // Award bonus points if any
  if (bonusAwarded > 0) {
    try {
      await db.prepare(
        `UPDATE user_points SET balance = balance + ?, totalEarned = totalEarned + ? WHERE userId=?`
      ).bind(bonusAwarded, bonusAwarded, userId).run();
      await db.prepare(
        `INSERT INTO point_transactions (userId, type, amount, description, balanceAfter, createdAt) VALUES (?, 'earn', ?, ?, (SELECT balance FROM user_points WHERE userId=?), datetime('now'))`
      ).bind(userId, bonusAwarded, `ストリークボーナス: ${newStreak}日連続`, userId).run();
    } catch { /* user_points row may not exist */ }
    // Record streak milestone activity
    await recordFriendActivity(db, userId, "streak_milestone", `${newStreak}日連続マッチング達成！ +${bonusAwarded}pt`, undefined, { streak: newStreak, bonus: bonusAwarded });
  }
  // Auto-unlock streak achievements
  for (const sb of STREAK_BONUSES) {
    if (newStreak >= sb.days) {
      const key = `streak_${sb.days}`;
      await db.prepare(
        `INSERT OR IGNORE INTO matching_achievements (userId, achievementKey) VALUES (?, ?)`
      ).bind(userId, key).run();
    }
  }
  // Auto-unlock count achievements
  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM matching_sessions WHERE initiatorUserId=? AND status='completed'`
  ).bind(userId).first<any>();
  const total = countResult?.total ?? 0;
  const COUNT_THRESHOLDS = [
    { count: 1, key: "first_matching" },
    { count: 10, key: "matching_10" },
    { count: 50, key: "matching_50" },
    { count: 100, key: "matching_100" },
  ];
  for (const ct of COUNT_THRESHOLDS) {
    if (total >= ct.count) {
      await db.prepare(
        `INSERT OR IGNORE INTO matching_achievements (userId, achievementKey) VALUES (?, ?)`
      ).bind(userId, ct.key).run();
    }
  }
  return { currentStreak: newStreak, bonusAwarded };
}

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

  dismissBriefing: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE daily_briefings SET isDismissed=1 WHERE id=? AND userId=?`
      ).bind(input.id, ctx.userId).run();
      return { dismissed: true };
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
