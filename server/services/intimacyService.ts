/**
 * 親密度計算サービス
 * 会話量と予測精度に基づいて友達間の親密度を計算・更新する
 */

import { getDb } from "../db";
import { intimacyScores, friendPredictions, chatMessages, chatSessions } from "../../drizzle/schema";
import { eq, and, sql, count } from "drizzle-orm";

// 親密度レベルの定義
export const INTIMACY_LEVELS = {
  stranger: { min: 0, max: 20, label: "知らない人" },
  acquaintance: { min: 20, max: 40, label: "知り合い" },
  friend: { min: 40, max: 60, label: "友達" },
  close_friend: { min: 60, max: 80, label: "親しい友達" },
  best_friend: { min: 80, max: 100, label: "親友" },
} as const;

export type IntimacyLevel = keyof typeof INTIMACY_LEVELS;

/**
 * 親密度レベルを判定
 */
export function getIntimacyLevel(score: number): IntimacyLevel {
  if (score >= 80) return "best_friend";
  if (score >= 60) return "close_friend";
  if (score >= 40) return "friend";
  if (score >= 20) return "acquaintance";
  return "stranger";
}

/**
 * 会話量から初期親密度スコアを計算
 * - メッセージ数: 最大50点
 * - 会話日数: 最大30点
 * - 直近の会話: 最大20点
 */
export function calculateConversationScore(
  messageCount: number,
  conversationDays: number,
  lastConversationAt: Date | null
): number {
  // メッセージ数スコア（100メッセージで最大50点）
  const messageScore = Math.min(50, (messageCount / 100) * 50);
  
  // 会話日数スコア（30日で最大30点）
  const daysScore = Math.min(30, (conversationDays / 30) * 30);
  
  // 直近の会話スコア（7日以内なら最大20点、30日以上前なら0点）
  let recencyScore = 0;
  if (lastConversationAt) {
    const daysSinceLastConversation = Math.floor(
      (Date.now() - lastConversationAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceLastConversation <= 7) {
      recencyScore = 20;
    } else if (daysSinceLastConversation <= 30) {
      recencyScore = 20 * (1 - (daysSinceLastConversation - 7) / 23);
    }
  }
  
  return messageScore + daysScore + recencyScore;
}

/**
 * 予測精度から親密度ボーナスを計算
 * 精度が高いほど「相手をよく知っている」とみなす
 */
export function calculatePredictionBonus(
  totalPredictions: number,
  correctPredictions: number
): number {
  if (totalPredictions < 3) {
    // 予測回数が少ない場合はボーナスなし
    return 0;
  }
  
  const accuracy = correctPredictions / totalPredictions;
  // 精度50%以上でボーナス開始、100%で最大30点のボーナス
  if (accuracy >= 0.5) {
    return (accuracy - 0.5) * 60; // 50%→0点、100%→30点
  }
  return 0;
}

/**
 * 総合親密度スコアを計算
 */
export function calculateIntimacyScore(
  conversationScore: number,
  predictionBonus: number
): number {
  // 会話スコア（最大100点）+ 予測ボーナス（最大30点）= 最大130点
  // 100点にスケーリング
  const rawScore = conversationScore + predictionBonus;
  return Math.min(100, rawScore * (100 / 130));
}

/**
 * ユーザー間の会話統計を取得
 */
export async function getConversationStats(
  userId: number,
  friendId: number
): Promise<{
  messageCount: number;
  conversationDays: number;
  lastConversationAt: Date | null;
}> {
  const db = await getDb();
  if (!db) return { messageCount: 0, conversationDays: 0, lastConversationAt: null };
  
  // 双方のチャットセッションを取得
  const sessions = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      sql`(${chatSessions.userId} = ${userId} AND ${chatSessions.twinId} IN (
        SELECT id FROM digital_twins WHERE userId = ${friendId}
      )) OR (${chatSessions.userId} = ${friendId} AND ${chatSessions.twinId} IN (
        SELECT id FROM digital_twins WHERE userId = ${userId}
      ))`
    );
  
  if (sessions.length === 0) {
    return { messageCount: 0, conversationDays: 0, lastConversationAt: null };
  }
  
  const sessionIds = sessions.map((s: { id: number }) => s.id);
  
  // メッセージ数をカウント
  const messageCountResult = await db
    .select({ count: count() })
    .from(chatMessages)
    .where(sql`${chatMessages.sessionId} IN (${sessionIds.join(",")})`);
  
  const messageCount = messageCountResult[0]?.count || 0;
  
  // 会話した日数をカウント（ユニークな日付）
  const conversationDaysResult = await db.execute(
    sql`SELECT COUNT(DISTINCT DATE(createdAt)) as days FROM chat_messages WHERE sessionId IN (${sql.raw(sessionIds.join(","))})`
  );
  const conversationDays = (conversationDaysResult as any)[0]?.days || 0;
  
  // 最後の会話日時
  const lastMessageResult = await db.execute(
    sql`SELECT MAX(createdAt) as lastAt FROM chat_messages WHERE sessionId IN (${sql.raw(sessionIds.join(","))})`
  );
  const lastConversationAt = (lastMessageResult as any)[0]?.lastAt 
    ? new Date((lastMessageResult as any)[0].lastAt) 
    : null;
  
  return { messageCount, conversationDays, lastConversationAt };
}

/**
 * 予測統計を取得
 */
export async function getPredictionStats(
  predictorUserId: number,
  targetUserId: number
): Promise<{
  totalPredictions: number;
  correctPredictions: number;
}> {
  const db = await getDb();
  if (!db) return { totalPredictions: 0, correctPredictions: 0 };
  
  const result = await db
    .select({
      total: count(),
      correct: sql<number>`SUM(CASE WHEN isCorrect = 1 THEN 1 ELSE 0 END)`
    })
    .from(friendPredictions)
    .where(
      and(
        eq(friendPredictions.predictorUserId, predictorUserId),
        eq(friendPredictions.targetUserId, targetUserId),
        sql`${friendPredictions.isCorrect} IS NOT NULL`
      )
    );
  
  return {
    totalPredictions: result[0]?.total || 0,
    correctPredictions: result[0]?.correct || 0
  };
}

/**
 * 親密度スコアを更新または作成
 */
export async function updateIntimacyScore(
  userId: number,
  friendId: number
): Promise<{
  intimacyScore: number;
  intimacyLevel: IntimacyLevel;
  conversationScore: number;
  predictionBonus: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 会話統計を取得
  const conversationStats = await getConversationStats(userId, friendId);
  
  // 予測統計を取得（友達が自分をどれだけ正確に予測できるか）
  const predictionStats = await getPredictionStats(friendId, userId);
  
  // スコアを計算
  const conversationScore = calculateConversationScore(
    conversationStats.messageCount,
    conversationStats.conversationDays,
    conversationStats.lastConversationAt
  );
  
  const predictionBonus = calculatePredictionBonus(
    predictionStats.totalPredictions,
    predictionStats.correctPredictions
  );
  
  const totalScore = calculateIntimacyScore(conversationScore, predictionBonus);
  const level = getIntimacyLevel(totalScore);
  
  // 予測精度を計算
  const predictionAccuracy = predictionStats.totalPredictions > 0
    ? (predictionStats.correctPredictions / predictionStats.totalPredictions) * 100
    : null;
  
  // 既存のレコードを確認
  const existing = await db
    .select()
    .from(intimacyScores)
    .where(
      and(
        eq(intimacyScores.userId, userId),
        eq(intimacyScores.friendId, friendId)
      )
    )
    .limit(1);
  
  if (existing.length > 0) {
    // 更新
    await db
      .update(intimacyScores)
      .set({
        totalMessageCount: conversationStats.messageCount,
        conversationDays: conversationStats.conversationDays,
        lastConversationAt: conversationStats.lastConversationAt,
        totalPredictions: predictionStats.totalPredictions,
        correctPredictions: predictionStats.correctPredictions,
        predictionAccuracy: predictionAccuracy?.toString(),
        intimacyScore: totalScore.toString(),
        intimacyLevel: level,
      })
      .where(eq(intimacyScores.id, existing[0].id));
  } else {
    // 新規作成
    await db.insert(intimacyScores).values({
      userId,
      friendId,
      totalMessageCount: conversationStats.messageCount,
      conversationDays: conversationStats.conversationDays,
      lastConversationAt: conversationStats.lastConversationAt,
      totalPredictions: predictionStats.totalPredictions,
      correctPredictions: predictionStats.correctPredictions,
      predictionAccuracy: predictionAccuracy?.toString(),
      intimacyScore: totalScore.toString(),
      intimacyLevel: level,
    });
  }
  
  return {
    intimacyScore: totalScore,
    intimacyLevel: level,
    conversationScore,
    predictionBonus
  };
}

/**
 * ユーザーの全友達の親密度を取得
 */
export async function getAllIntimacyScores(
  userId: number
): Promise<Array<{
  friendId: number;
  intimacyScore: number;
  intimacyLevel: IntimacyLevel;
  predictionAccuracy: number | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  
  const scores = await db
    .select()
    .from(intimacyScores)
    .where(eq(intimacyScores.userId, userId));
  
  return scores.map((s: typeof intimacyScores.$inferSelect) => ({
    friendId: s.friendId,
    intimacyScore: parseFloat(s.intimacyScore || "0"),
    intimacyLevel: s.intimacyLevel as IntimacyLevel,
    predictionAccuracy: s.predictionAccuracy ? parseFloat(s.predictionAccuracy) : null
  }));
}

/**
 * 親密度に基づく重みを計算（他者視点波形の生成に使用）
 */
export function calculateIntimacyWeight(intimacyScore: number): number {
  // 親密度0→重み0.1、親密度100→重み1.0
  return 0.1 + (intimacyScore / 100) * 0.9;
}
