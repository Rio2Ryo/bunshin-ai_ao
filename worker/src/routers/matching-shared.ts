import { invokeLLM } from "../llm";
import { recordFriendActivity } from "../db-helpers";

// ============ Matching Streak Helper ============

export async function updateMatchingStreakForUser(db: D1Database, userId: number): Promise<{ currentStreak: number; bonusAwarded: number }> {
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

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilyResponse = {
  answer?: string;
  query: string;
  results: TavilySearchResult[];
};

/** Search the web using Tavily API */
export async function searchWithTavily(
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
export async function generateSearchQueries(
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
export function formatSearchContext(results: TavilyResponse[]): string {
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
