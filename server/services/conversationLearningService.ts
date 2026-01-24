/**
 * 会話学習サービス
 * Clawdbot経由の会話を分析して分身AIの人格を自動構築
 */

import { getDb } from "../db";
import { 
  conversationLearning, 
  conversationSnippets, 
  groupConversationObservations,
  digitalTwins,
  clawdbotMessageLogs,
  type LearnedPersonalityTraits
} from "../../drizzle/schema";
import { eq, and, desc, sql, lt } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

// デフォルトの学習済み特性
const DEFAULT_LEARNED_TRAITS: LearnedPersonalityTraits = {
  likes: [],
  dislikes: [],
  values: [],
  priorities: [],
  communicationStyle: {
    formality: 50,
    verbosity: 50,
    emotionality: 50,
    directness: 50,
  },
  catchphrases: [],
  frequentExpressions: [],
  interests: [],
  expertise: [],
  decisionMakingStyle: "未分析",
  conflictResolutionStyle: "未分析",
  emotionalTriggers: {
    positive: [],
    negative: [],
  },
  lastAnalyzedAt: new Date().toISOString(),
  totalConversationsAnalyzed: 0,
};

/**
 * 会話学習データを取得または初期化
 */
export async function getOrCreateConversationLearning(userId: number, twinId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [existing] = await db
    .select()
    .from(conversationLearning)
    .where(eq(conversationLearning.userId, userId))
    .limit(1);

  if (existing) {
    return existing;
  }

  // 新規作成
  const [result] = await db.insert(conversationLearning).values({
    userId,
    twinId,
    learnedTraits: DEFAULT_LEARNED_TRAITS,
  });

  const [created] = await db
    .select()
    .from(conversationLearning)
    .where(eq(conversationLearning.id, result.insertId))
    .limit(1);

  return created;
}

/**
 * 会話スニペットを保存
 */
export async function saveConversationSnippet(
  userId: number,
  twinId: number,
  source: "clawdbot" | "web_chat" | "matching" | "group",
  userMessage: string,
  context?: string,
  sourceId?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // スニペットを保存
  await db.insert(conversationSnippets).values({
    userId,
    twinId,
    source,
    sourceId,
    userMessage,
    context,
  });

  // 未分析会話数をインクリメント
  await db
    .update(conversationLearning)
    .set({
      pendingConversations: sql`${conversationLearning.pendingConversations} + 1`,
      totalConversations: sql`${conversationLearning.totalConversations} + 1`,
    })
    .where(eq(conversationLearning.userId, userId));

  // 閾値チェック
  const learning = await getOrCreateConversationLearning(userId, twinId);
  if (learning.autoLearnEnabled && learning.pendingConversations >= learning.learningThreshold) {
    // 非同期で人格分析を実行
    analyzeAndUpdatePersonality(userId, twinId).catch(err => 
      console.error("[ConversationLearning] Analysis error:", err)
    );
  }
}

/**
 * グループ会話を観察記録
 */
export async function recordGroupConversation(
  userId: number,
  twinId: number,
  groupId: string,
  groupName: string | undefined,
  speakerType: "self" | "other",
  message: string,
  speakerName?: string,
  replyToId?: number,
  threadContext?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(groupConversationObservations).values({
    userId,
    twinId,
    groupId,
    groupName,
    speakerType,
    speakerName,
    message,
    replyToId,
    threadContext,
    isRelevantForLearning: speakerType === "self" ? 1 : 0,
  });

  // 自分の発言の場合は会話スニペットとしても保存
  if (speakerType === "self") {
    await saveConversationSnippet(
      userId,
      twinId,
      "group",
      message,
      threadContext,
      `group_${result.insertId}`
    );
  }

  return result.insertId;
}

/**
 * Clawdbotメッセージログから会話を同期
 */
export async function syncClawdbotConversations(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // ユーザーの分身AIを取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.userId, userId))
    .limit(1);

  if (!twin) {
    console.log("[ConversationLearning] No twin found for user:", userId);
    return { synced: 0 };
  }

  // 最後に同期したメッセージIDを取得
  const [lastSnippet] = await db
    .select({ sourceId: conversationSnippets.sourceId })
    .from(conversationSnippets)
    .where(
      and(
        eq(conversationSnippets.userId, userId),
        eq(conversationSnippets.source, "clawdbot")
      )
    )
    .orderBy(desc(conversationSnippets.createdAt))
    .limit(1);

  const lastSyncedId = lastSnippet?.sourceId 
    ? parseInt(lastSnippet.sourceId.replace("clawdbot_", ""), 10) 
    : 0;

  // 未同期のClawdbotメッセージを取得
  const messages = await db
    .select()
    .from(clawdbotMessageLogs)
    .where(
      and(
        eq(clawdbotMessageLogs.userId, userId),
        eq(clawdbotMessageLogs.direction, "to_clawdbot"),
        sql`${clawdbotMessageLogs.id} > ${lastSyncedId}`
      )
    )
    .orderBy(clawdbotMessageLogs.createdAt)
    .limit(100);

  let synced = 0;
  for (const msg of messages) {
    // 対応する応答を取得（文脈として）
    const [response] = await db
      .select()
      .from(clawdbotMessageLogs)
      .where(
        and(
          eq(clawdbotMessageLogs.userId, userId),
          eq(clawdbotMessageLogs.direction, "from_clawdbot"),
          sql`${clawdbotMessageLogs.createdAt} > ${msg.createdAt}`
        )
      )
      .orderBy(clawdbotMessageLogs.createdAt)
      .limit(1);

    const context = response ? `AI応答: ${response.content}` : undefined;

    await saveConversationSnippet(
      userId,
      twin.id,
      "clawdbot",
      msg.content,
      context,
      `clawdbot_${msg.id}`
    );
    synced++;
  }

  return { synced };
}

/**
 * 会話を分析して人格特性を抽出
 */
async function extractPersonalityFromConversations(
  snippets: { userMessage: string; context: string | null }[]
): Promise<Partial<LearnedPersonalityTraits>> {
  const conversationsText = snippets
    .map((s, i) => `会話${i + 1}:\nユーザー: ${s.userMessage}${s.context ? `\n文脈: ${s.context}` : ""}`)
    .join("\n\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたは心理学と言語分析の専門家です。ユーザーの会話履歴から人格特性を抽出してください。

以下の観点で分析してください：
1. 好きなこと・嫌いなこと
2. 価値観・優先事項
3. コミュニケーションスタイル（フォーマル度、詳細度、感情的/論理的、直接的/婉曲）
4. 口癖・よく使う表現
5. 興味・専門分野
6. 意思決定スタイル
7. 感情のトリガー（喜ぶこと、怒ること）

会話の内容から読み取れる特徴のみを抽出し、推測は最小限にしてください。`,
      },
      {
        role: "user",
        content: `以下の会話履歴を分析してください：\n\n${conversationsText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "personality_extraction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            likes: {
              type: "array",
              items: { type: "string" },
              description: "好きなこと・興味があること",
            },
            dislikes: {
              type: "array",
              items: { type: "string" },
              description: "嫌いなこと・避けたいこと",
            },
            values: {
              type: "array",
              items: { type: "string" },
              description: "大切にしている価値観",
            },
            priorities: {
              type: "array",
              items: { type: "string" },
              description: "優先事項",
            },
            communicationStyle: {
              type: "object",
              properties: {
                formality: { type: "number", description: "0=カジュアル, 100=フォーマル" },
                verbosity: { type: "number", description: "0=簡潔, 100=詳細" },
                emotionality: { type: "number", description: "0=論理的, 100=感情的" },
                directness: { type: "number", description: "0=婉曲, 100=直接的" },
              },
              required: ["formality", "verbosity", "emotionality", "directness"],
              additionalProperties: false,
            },
            catchphrases: {
              type: "array",
              items: { type: "string" },
              description: "口癖",
            },
            frequentExpressions: {
              type: "array",
              items: { type: "string" },
              description: "よく使う表現",
            },
            interests: {
              type: "array",
              items: { type: "string" },
              description: "興味・関心分野",
            },
            expertise: {
              type: "array",
              items: { type: "string" },
              description: "専門分野",
            },
            decisionMakingStyle: {
              type: "string",
              description: "意思決定スタイル（慎重/即断/相談型など）",
            },
            conflictResolutionStyle: {
              type: "string",
              description: "対立解決スタイル（回避/対決/妥協など）",
            },
            emotionalTriggers: {
              type: "object",
              properties: {
                positive: {
                  type: "array",
                  items: { type: "string" },
                  description: "喜ぶこと",
                },
                negative: {
                  type: "array",
                  items: { type: "string" },
                  description: "怒ること・悲しむこと",
                },
              },
              required: ["positive", "negative"],
              additionalProperties: false,
            },
          },
          required: [
            "likes", "dislikes", "values", "priorities", "communicationStyle",
            "catchphrases", "frequentExpressions", "interests", "expertise",
            "decisionMakingStyle", "conflictResolutionStyle", "emotionalTriggers"
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Failed to extract personality from conversations");
  }

  return JSON.parse(content);
}

/**
 * 既存の特性と新しい特性をマージ
 */
function mergePersonalityTraits(
  existing: LearnedPersonalityTraits,
  newTraits: Partial<LearnedPersonalityTraits>
): LearnedPersonalityTraits {
  // 配列フィールドはユニークにマージ
  const mergeArrays = (a: string[], b: string[] | undefined): string[] => {
    if (!b) return a;
    return Array.from(new Set([...a, ...b])).slice(0, 20); // 最大20個
  };

  // コミュニケーションスタイルは平均化
  const avgStyle = (a: number, b: number | undefined, weight: number = 0.7): number => {
    if (b === undefined) return a;
    return Math.round(a * weight + b * (1 - weight));
  };

  return {
    likes: mergeArrays(existing.likes, newTraits.likes),
    dislikes: mergeArrays(existing.dislikes, newTraits.dislikes),
    values: mergeArrays(existing.values, newTraits.values),
    priorities: mergeArrays(existing.priorities, newTraits.priorities),
    communicationStyle: {
      formality: avgStyle(existing.communicationStyle.formality, newTraits.communicationStyle?.formality),
      verbosity: avgStyle(existing.communicationStyle.verbosity, newTraits.communicationStyle?.verbosity),
      emotionality: avgStyle(existing.communicationStyle.emotionality, newTraits.communicationStyle?.emotionality),
      directness: avgStyle(existing.communicationStyle.directness, newTraits.communicationStyle?.directness),
    },
    catchphrases: mergeArrays(existing.catchphrases, newTraits.catchphrases),
    frequentExpressions: mergeArrays(existing.frequentExpressions, newTraits.frequentExpressions),
    interests: mergeArrays(existing.interests, newTraits.interests),
    expertise: mergeArrays(existing.expertise, newTraits.expertise),
    decisionMakingStyle: newTraits.decisionMakingStyle || existing.decisionMakingStyle,
    conflictResolutionStyle: newTraits.conflictResolutionStyle || existing.conflictResolutionStyle,
    emotionalTriggers: {
      positive: mergeArrays(existing.emotionalTriggers.positive, newTraits.emotionalTriggers?.positive),
      negative: mergeArrays(existing.emotionalTriggers.negative, newTraits.emotionalTriggers?.negative),
    },
    lastAnalyzedAt: new Date().toISOString(),
    totalConversationsAnalyzed: existing.totalConversationsAnalyzed + 1,
  };
}

/**
 * 人格分析を実行して分身AIを更新
 */
export async function analyzeAndUpdatePersonality(userId: number, twinId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  console.log(`[ConversationLearning] Starting analysis for user ${userId}`);

  // 未分析のスニペットを取得
  const snippets = await db
    .select()
    .from(conversationSnippets)
    .where(
      and(
        eq(conversationSnippets.userId, userId),
        eq(conversationSnippets.isAnalyzed, 0)
      )
    )
    .orderBy(desc(conversationSnippets.createdAt))
    .limit(50);

  if (snippets.length === 0) {
    console.log("[ConversationLearning] No snippets to analyze");
    return { analyzed: 0 };
  }

  // 人格特性を抽出
  const newTraits = await extractPersonalityFromConversations(
    snippets.map(s => ({ userMessage: s.userMessage, context: s.context }))
  );

  // 既存の学習データを取得
  const learning = await getOrCreateConversationLearning(userId, twinId);
  const existingTraits = (learning.learnedTraits as LearnedPersonalityTraits) || DEFAULT_LEARNED_TRAITS;

  // マージ
  const mergedTraits = mergePersonalityTraits(existingTraits, newTraits);

  // 学習データを更新
  await db
    .update(conversationLearning)
    .set({
      learnedTraits: mergedTraits,
      lastAnalysisAt: new Date(),
      analysisCount: sql`${conversationLearning.analysisCount} + 1`,
      pendingConversations: 0,
    })
    .where(eq(conversationLearning.userId, userId));

  // スニペットを分析済みにマーク
  const snippetIds = snippets.map(s => s.id);
  await db
    .update(conversationSnippets)
    .set({
      isAnalyzed: 1,
      analyzedAt: new Date(),
    })
    .where(sql`${conversationSnippets.id} IN (${snippetIds.join(",")})`);

  // 分身AIのpersonalityフィールドを更新
  await updateTwinPersonalityFromLearning(userId, twinId, mergedTraits);

  console.log(`[ConversationLearning] Analyzed ${snippets.length} snippets for user ${userId}`);

  return { analyzed: snippets.length, traits: mergedTraits };
}

/**
 * 学習した特性を分身AIのpersonalityに反映
 */
async function updateTwinPersonalityFromLearning(
  userId: number,
  twinId: number,
  traits: LearnedPersonalityTraits
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 現在の分身AIを取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, twinId))
    .limit(1);

  if (!twin) return;

  // 学習した特性からpersonality文を生成
  const learnedPersonality = generatePersonalityText(traits);

  // 既存のpersonalityと学習した特性をマージ
  const existingPersonality = twin.personality || "";
  const separator = "\n\n【会話から学習した特性】\n";
  
  // 既存のpersonalityから学習部分を除去
  const basePersonality = existingPersonality.split(separator)[0];
  
  // 新しいpersonalityを構築
  const newPersonality = basePersonality + separator + learnedPersonality;

  await db
    .update(digitalTwins)
    .set({
      personality: newPersonality,
    })
    .where(eq(digitalTwins.id, twinId));
}

/**
 * 学習した特性からpersonality文を生成
 */
function generatePersonalityText(traits: LearnedPersonalityTraits): string {
  const lines: string[] = [];

  if (traits.likes.length > 0) {
    lines.push(`好きなこと: ${traits.likes.join("、")}`);
  }
  if (traits.dislikes.length > 0) {
    lines.push(`苦手なこと: ${traits.dislikes.join("、")}`);
  }
  if (traits.values.length > 0) {
    lines.push(`大切にしている価値観: ${traits.values.join("、")}`);
  }
  if (traits.interests.length > 0) {
    lines.push(`興味・関心: ${traits.interests.join("、")}`);
  }
  if (traits.expertise.length > 0) {
    lines.push(`専門分野: ${traits.expertise.join("、")}`);
  }
  if (traits.catchphrases.length > 0) {
    lines.push(`口癖: ${traits.catchphrases.join("、")}`);
  }
  if (traits.decisionMakingStyle !== "未分析") {
    lines.push(`意思決定スタイル: ${traits.decisionMakingStyle}`);
  }

  // コミュニケーションスタイルの説明
  const style = traits.communicationStyle;
  const styleDesc: string[] = [];
  if (style.formality > 70) styleDesc.push("フォーマル");
  else if (style.formality < 30) styleDesc.push("カジュアル");
  if (style.verbosity > 70) styleDesc.push("詳細に説明する");
  else if (style.verbosity < 30) styleDesc.push("簡潔");
  if (style.emotionality > 70) styleDesc.push("感情豊か");
  else if (style.emotionality < 30) styleDesc.push("論理的");
  if (style.directness > 70) styleDesc.push("直接的");
  else if (style.directness < 30) styleDesc.push("婉曲的");
  
  if (styleDesc.length > 0) {
    lines.push(`コミュニケーションスタイル: ${styleDesc.join("、")}`);
  }

  return lines.join("\n");
}

/**
 * 学習状況を取得
 */
export async function getLearningStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const learning = await db
    .select()
    .from(conversationLearning)
    .where(eq(conversationLearning.userId, userId))
    .limit(1);

  const snippetCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(conversationSnippets)
    .where(eq(conversationSnippets.userId, userId));

  const analyzedCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(conversationSnippets)
    .where(
      and(
        eq(conversationSnippets.userId, userId),
        eq(conversationSnippets.isAnalyzed, 1)
      )
    );

  return {
    learning: learning[0] || null,
    totalSnippets: snippetCount[0]?.count || 0,
    analyzedSnippets: analyzedCount[0]?.count || 0,
  };
}

/**
 * 学習設定を更新
 */
export async function updateLearningSettings(
  userId: number,
  settings: {
    autoLearnEnabled?: boolean;
    learningThreshold?: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, unknown> = {};
  if (settings.autoLearnEnabled !== undefined) {
    updateData.autoLearnEnabled = settings.autoLearnEnabled ? 1 : 0;
  }
  if (settings.learningThreshold !== undefined) {
    updateData.learningThreshold = settings.learningThreshold;
  }

  await db
    .update(conversationLearning)
    .set(updateData)
    .where(eq(conversationLearning.userId, userId));

  return { success: true };
}
