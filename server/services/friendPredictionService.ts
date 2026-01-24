/**
 * 友達による予測評価サービス
 * 友達の分身AIが「この人ならどう答えるか」を予測し、
 * 実際の回答と比較して他者視点波形を生成する
 */

import { getDb } from "../db";
import { 
  friendPredictions, 
  otherPerspectiveWaveforms,
  valueScenarioResponses,
  digitalTwins,
  users
} from "../../drizzle/schema";
import { eq, and, sql, isNull, desc } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { invokeLLMWithProvider } from "./aiProviderService";
import { 
  updateIntimacyScore, 
  getAllIntimacyScores, 
  calculateIntimacyWeight,
  type IntimacyLevel 
} from "./intimacyService";

// 判断基準のスコア型
interface JudgmentScores {
  goodEvil: number;
  likesDislike: number;
  profitLoss: number;
  interest: number;
  pleasurePain: number;
  difficulty: number;
  possibility: number;
  comfort: number;
  rightWrong: number;
}

// 予測結果の型
interface PredictionResult {
  predictedResponse: string;
  predictedVerdict: "virtue" | "mine" | "neutral";
  predictedJudgmentScores: JudgmentScores;
  predictionReason: string;
  confidence: number;
}

/**
 * 友達の分身AIがターゲットユーザーの回答を予測
 */
export async function predictUserResponse(
  predictorTwinId: number,
  targetUserId: number,
  scenarioId: string,
  scenarioText: string
): Promise<PredictionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 予測者の分身AI情報を取得
  const predictorTwin = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, predictorTwinId))
    .limit(1);
  
  if (!predictorTwin.length) {
    throw new Error("Predictor twin not found");
  }
  
  // ターゲットユーザーの分身AI情報を取得
  const targetTwin = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.userId, targetUserId))
    .limit(1);
  
  if (!targetTwin.length) {
    throw new Error("Target user's twin not found");
  }
  
  // ターゲットユーザーの情報を取得
  const targetUser = await db
    .select()
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  
  const targetName = targetUser[0]?.name || "この人";
  const targetPersonality = targetTwin[0].personality || "";
  const targetMBTI = targetTwin[0].mbtiType ? (targetTwin[0].mbtiType as any).type : "";
  
  // LLMで予測を生成
  const prompt = `あなたは「${predictorTwin[0].name}」として、友達の「${targetName}」がこのシナリオにどう答えるかを予測してください。

【${targetName}の性格情報】
${targetPersonality}
${targetMBTI ? `MBTI: ${targetMBTI}` : ""}

【シナリオ】
${scenarioText}

【予測タスク】
${targetName}さんがこのシナリオに対してどのように回答するか、あなたの知っている${targetName}さんの性格や価値観に基づいて予測してください。

以下のJSON形式で回答してください：
{
  "predictedResponse": "${targetName}さんの予測される回答（100文字程度）",
  "predictedVerdict": "この回答が一般的に見て「virtue（徳）」「mine（地雷）」「neutral（中立）」のどれか",
  "judgmentScores": {
    "goodEvil": 善悪の判断スコア（-100〜100、正が善寄り）,
    "likesDislike": 好き嫌いの判断スコア（-100〜100、正が好意的）,
    "profitLoss": 損得の判断スコア（-100〜100、正が得寄り）,
    "interest": 利害の判断スコア（-100〜100、正が利益重視）,
    "pleasurePain": 苦楽の判断スコア（-100〜100、正が楽寄り）,
    "difficulty": 難易の判断スコア（-100〜100、正が簡単寄り）,
    "possibility": 可否の判断スコア（-100〜100、正が可能寄り）,
    "comfort": 快不快の判断スコア（-100〜100、正が快適寄り）,
    "rightWrong": 正誤の判断スコア（-100〜100、正が正しい寄り）
  },
  "reason": "この予測の理由（${targetName}さんの性格からなぜこう答えると思うか）",
  "confidence": 予測の確信度（0〜100）
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: predictorTwin[0].systemPrompt || "あなたは友達の行動を予測するAIです。" },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "prediction_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            predictedResponse: { type: "string" },
            predictedVerdict: { type: "string", enum: ["virtue", "mine", "neutral"] },
            judgmentScores: {
              type: "object",
              properties: {
                goodEvil: { type: "number" },
                likesDislike: { type: "number" },
                profitLoss: { type: "number" },
                interest: { type: "number" },
                pleasurePain: { type: "number" },
                difficulty: { type: "number" },
                possibility: { type: "number" },
                comfort: { type: "number" },
                rightWrong: { type: "number" }
              },
              required: ["goodEvil", "likesDislike", "profitLoss", "interest", "pleasurePain", "difficulty", "possibility", "comfort", "rightWrong"],
              additionalProperties: false
            },
            reason: { type: "string" },
            confidence: { type: "number" }
          },
          required: ["predictedResponse", "predictedVerdict", "judgmentScores", "reason", "confidence"],
          additionalProperties: false
        }
      }
    }
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error("LLM response is empty or invalid");
  }
  
  const result = JSON.parse(content);
  
  return {
    predictedResponse: result.predictedResponse,
    predictedVerdict: result.predictedVerdict,
    predictedJudgmentScores: result.judgmentScores,
    predictionReason: result.reason,
    confidence: result.confidence
  };
}

/**
 * 友達の予測を保存
 */
export async function saveFriendPrediction(
  targetUserId: number,
  targetTwinId: number,
  predictorUserId: number,
  predictorTwinId: number,
  scenarioId: string,
  scenarioText: string,
  prediction: PredictionResult
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(friendPredictions).values({
    targetUserId,
    targetTwinId,
    predictorUserId,
    predictorTwinId,
    scenarioId,
    scenarioText,
    predictedResponse: prediction.predictedResponse,
    predictedVerdict: prediction.predictedVerdict,
    predictedJudgmentScores: prediction.predictedJudgmentScores,
    predictionReason: prediction.predictionReason,
    confidence: prediction.confidence.toString()
  });
  
  // TiDBでinsertIdが取得できない場合は、最新のレコードを取得
  let insertId = (result as any).insertId;
  if (!insertId) {
    const latestRecord = await db
      .select({ id: friendPredictions.id })
      .from(friendPredictions)
      .where(
        and(
          eq(friendPredictions.targetUserId, targetUserId),
          eq(friendPredictions.predictorUserId, predictorUserId),
          eq(friendPredictions.scenarioId, scenarioId)
        )
      )
      .orderBy(desc(friendPredictions.id))
      .limit(1);
    
    if (latestRecord.length > 0) {
      insertId = latestRecord[0].id;
    }
  }
  
  console.log(`[saveFriendPrediction] Saved prediction with ID: ${insertId}`);
  return insertId;
}

/**
 * 予測と実際の回答を比較
 */
export async function comparePredictionWithActual(
  predictionId: number,
  actualResponseId: number
): Promise<{
  isCorrect: boolean;
  similarityScore: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 予測を取得
  const prediction = await db
    .select()
    .from(friendPredictions)
    .where(eq(friendPredictions.id, predictionId))
    .limit(1);
  
  if (!prediction.length) {
    throw new Error("Prediction not found");
  }
  
  // 実際の回答を取得
  const actualResponse = await db
    .select()
    .from(valueScenarioResponses)
    .where(eq(valueScenarioResponses.id, actualResponseId))
    .limit(1);
  
  if (!actualResponse.length) {
    throw new Error("Actual response not found");
  }
  
  // 実際の評価結果を取得（analysisResultから）
  const analysisResult = actualResponse[0].analysisResult as any;
  
  // 予測が当たったかどうかを判定
  // 簡易的に、予測したverdictと実際の傾向を比較
  let actualVerdict: "virtue" | "mine" | "neutral" = "neutral";
  if (analysisResult?.virtueIndicators?.length > analysisResult?.mineIndicators?.length) {
    actualVerdict = "virtue";
  } else if (analysisResult?.mineIndicators?.length > analysisResult?.virtueIndicators?.length) {
    actualVerdict = "mine";
  }
  
  const isCorrect = prediction[0].predictedVerdict === actualVerdict;
  
  // 類似度スコアを計算（判断スコアの相関）
  const predictedScores = prediction[0].predictedJudgmentScores as JudgmentScores;
  const actualScores = analysisResult?.judgmentScores as JudgmentScores;
  
  let similarityScore = 50; // デフォルト
  if (predictedScores && actualScores) {
    const keys = Object.keys(predictedScores) as (keyof JudgmentScores)[];
    let totalDiff = 0;
    for (const key of keys) {
      const diff = Math.abs((predictedScores[key] || 0) - (actualScores[key] || 0));
      totalDiff += diff;
    }
    // 最大差は200 * 9 = 1800、類似度に変換
    similarityScore = Math.max(0, 100 - (totalDiff / 18));
  }
  
  // 予測を更新
  await db
    .update(friendPredictions)
    .set({
      scenarioResponseId: actualResponseId,
      actualVerdict,
      isCorrect: isCorrect ? 1 : 0,
      similarityScore: similarityScore.toString(),
      comparedAt: new Date()
    })
    .where(eq(friendPredictions.id, predictionId));
  
  // 親密度を更新
  await updateIntimacyScore(prediction[0].targetUserId, prediction[0].predictorUserId);
  
  return { isCorrect, similarityScore };
}

/**
 * 全友達に予測を依頼（シナリオ回答前に実行）
 */
export async function requestPredictionsFromFriends(
  targetUserId: number,
  targetTwinId: number,
  scenarioId: string,
  scenarioText: string,
  friendUserIds: number[]
): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const predictionIds: number[] = [];
  
  for (const friendUserId of friendUserIds) {
    // 友達の分身AIを取得
    const friendTwin = await db
      .select()
      .from(digitalTwins)
      .where(eq(digitalTwins.userId, friendUserId))
      .limit(1);
    
    if (!friendTwin.length || !friendTwin[0].systemPrompt) {
      continue; // 分身AIがない、または未設定の友達はスキップ
    }
    
    try {
      // 予測を生成
      const prediction = await predictUserResponse(
        friendTwin[0].id,
        targetUserId,
        scenarioId,
        scenarioText
      );
      
      // 予測を保存
      const predictionId = await saveFriendPrediction(
        targetUserId,
        targetTwinId,
        friendUserId,
        friendTwin[0].id,
        scenarioId,
        scenarioText,
        prediction
      );
      
      predictionIds.push(predictionId);
    } catch (error) {
      console.error(`Failed to get prediction from friend ${friendUserId}:`, error);
    }
  }
  
  return predictionIds;
}

/**
 * 他者視点波形を更新
 */
export async function updateOtherPerspectiveWaveform(
  userId: number,
  twinId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // 比較済みの予測を全て取得
  const predictions = await db
    .select()
    .from(friendPredictions)
    .where(
      and(
        eq(friendPredictions.targetUserId, userId),
        sql`${friendPredictions.comparedAt} IS NOT NULL`
      )
    );
  
  if (predictions.length === 0) {
    return;
  }
  
  // 親密度を取得
  const intimacyScores = await getAllIntimacyScores(userId);
  const intimacyMap = new Map(intimacyScores.map(s => [s.friendId, s]));
  
  // 累積スコアを計算
  let totalVirtue = 0;
  let totalMine = 0;
  let totalNeutral = 0;
  
  const cumulativeScores = {
    goodEvil: { sum: 0, count: 0 },
    likesDislike: { sum: 0, count: 0 },
    profitLoss: { sum: 0, count: 0 },
    interest: { sum: 0, count: 0 },
    pleasurePain: { sum: 0, count: 0 },
    difficulty: { sum: 0, count: 0 },
    possibility: { sum: 0, count: 0 },
    comfort: { sum: 0, count: 0 },
    rightWrong: { sum: 0, count: 0 }
  };
  
  const predictorBreakdown: Record<string, {
    predictorName: string;
    intimacyScore: number;
    intimacyLevel: string;
    weight: number;
    virtueCount: number;
    mineCount: number;
    neutralCount: number;
    predictionAccuracy: number;
  }> = {};
  
  for (const pred of predictions) {
    const intimacy = intimacyMap.get(pred.predictorUserId);
    const weight = intimacy ? calculateIntimacyWeight(intimacy.intimacyScore) : 0.1;
    
    // 予測者の分身AI名を取得
    const predictorTwin = await db
      .select({ name: digitalTwins.name })
      .from(digitalTwins)
      .where(eq(digitalTwins.id, pred.predictorTwinId))
      .limit(1);
    
    const predictorName = predictorTwin[0]?.name || "Unknown";
    const predictorKey = pred.predictorTwinId.toString();
    
    if (!predictorBreakdown[predictorKey]) {
      predictorBreakdown[predictorKey] = {
        predictorName,
        intimacyScore: intimacy?.intimacyScore || 0,
        intimacyLevel: intimacy?.intimacyLevel || "stranger",
        weight,
        virtueCount: 0,
        mineCount: 0,
        neutralCount: 0,
        predictionAccuracy: intimacy?.predictionAccuracy || 0
      };
    }
    
    // 重み付きでカウント
    if (pred.predictedVerdict === "virtue") {
      totalVirtue += weight;
      predictorBreakdown[predictorKey].virtueCount++;
    } else if (pred.predictedVerdict === "mine") {
      totalMine += weight;
      predictorBreakdown[predictorKey].mineCount++;
    } else {
      totalNeutral += weight;
      predictorBreakdown[predictorKey].neutralCount++;
    }
    
    // 判断スコアを累積
    const scores = pred.predictedJudgmentScores as JudgmentScores;
    if (scores) {
      for (const key of Object.keys(cumulativeScores) as (keyof typeof cumulativeScores)[]) {
        cumulativeScores[key].sum += (scores[key] || 0) * weight;
        cumulativeScores[key].count += weight;
      }
    }
  }
  
  // 既存のレコードを確認
  const existing = await db
    .select()
    .from(otherPerspectiveWaveforms)
    .where(eq(otherPerspectiveWaveforms.userId, userId))
    .limit(1);
  
  const data = {
    userId,
    twinId,
    totalVirtueCount: Math.round(totalVirtue),
    totalMineCount: Math.round(totalMine),
    totalNeutralCount: Math.round(totalNeutral),
    cumulativeJudgmentScores: cumulativeScores,
    predictorBreakdown
  };
  
  if (existing.length > 0) {
    await db
      .update(otherPerspectiveWaveforms)
      .set(data)
      .where(eq(otherPerspectiveWaveforms.id, existing[0].id));
  } else {
    await db.insert(otherPerspectiveWaveforms).values(data);
  }
}

/**
 * 自己申告波形と他者視点波形の乖離度を計算
 */
export async function calculateSelfReportGap(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  // 自己申告波形（累積波形）を取得
  const selfWaveform = await db.execute(
    sql`SELECT * FROM cumulative_waveforms WHERE userId = ${userId} LIMIT 1`
  );
  
  // 他者視点波形を取得
  const otherWaveform = await db
    .select()
    .from(otherPerspectiveWaveforms)
    .where(eq(otherPerspectiveWaveforms.userId, userId))
    .limit(1);
  
  if (!selfWaveform || !otherWaveform.length) {
    return 0;
  }
  
  const self = (selfWaveform as any)[0];
  const other = otherWaveform[0];
  
  if (!self || !other) {
    return 0;
  }
  
  // 徳/地雷の比率の差を計算
  const selfTotal = (self.totalVirtueCount || 0) + (self.totalMineCount || 0) + (self.totalNeutralCount || 0);
  const otherTotal = (other.totalVirtueCount || 0) + (other.totalMineCount || 0) + (other.totalNeutralCount || 0);
  
  if (selfTotal === 0 || otherTotal === 0) {
    return 0;
  }
  
  const selfVirtueRatio = (self.totalVirtueCount || 0) / selfTotal;
  const otherVirtueRatio = (other.totalVirtueCount || 0) / otherTotal;
  
  const selfMineRatio = (self.totalMineCount || 0) / selfTotal;
  const otherMineRatio = (other.totalMineCount || 0) / otherTotal;
  
  // 乖離度 = 比率の差の絶対値の平均 × 100
  const gap = ((Math.abs(selfVirtueRatio - otherVirtueRatio) + Math.abs(selfMineRatio - otherMineRatio)) / 2) * 100;
  
  // 他者視点波形に乖離度を保存
  await db
    .update(otherPerspectiveWaveforms)
    .set({ selfReportGap: gap.toString() })
    .where(eq(otherPerspectiveWaveforms.userId, userId));
  
  return gap;
}

/**
 * 既存の回答に対して全友達から予測を生成し、即座に比較する
 */
export async function generatePredictionsForExistingResponses(
  targetUserId: number,
  targetTwinId: number
): Promise<{
  totalPredictions: number;
  successfulPredictions: number;
  friendsProcessed: number;
}> {
  console.log("[generatePredictionsForExistingResponses] Starting for user:", targetUserId, "twin:", targetTwinId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // ターゲットユーザーの回答済みシナリオを取得
  const responses = await db
    .select()
    .from(valueScenarioResponses)
    .where(eq(valueScenarioResponses.userId, targetUserId));
  
  if (responses.length === 0) {
    console.log("[generatePredictionsForExistingResponses] No responses found for user");
    return { totalPredictions: 0, successfulPredictions: 0, friendsProcessed: 0 };
  }
  console.log("[generatePredictionsForExistingResponses] Found", responses.length, "responses");
  
  // 友達一覧を取得（承認済み）
  const friendshipsResult = await db.execute(
    sql`SELECT DISTINCT 
          CASE WHEN userId = ${targetUserId} THEN friendId ELSE userId END as friendId
        FROM friendships 
        WHERE (userId = ${targetUserId} OR friendId = ${targetUserId}) 
          AND status = 'accepted'`
  );
  
  // db.executeの結果は[rows, fields]の配列、または{rows}オブジェクト
  const friendshipsRows = Array.isArray(friendshipsResult) 
    ? friendshipsResult[0] 
    : (friendshipsResult as any).rows || friendshipsResult;
  console.log("[generatePredictionsForExistingResponses] Raw friendships result:", JSON.stringify(friendshipsRows).slice(0, 500));
  const friendUserIds = (friendshipsRows as any[]).map((f: any) => f.friendId);
  
  if (friendUserIds.length === 0) {
    console.log("[generatePredictionsForExistingResponses] No friends found for user");
    return { totalPredictions: 0, successfulPredictions: 0, friendsProcessed: 0 };
  }
  console.log("[generatePredictionsForExistingResponses] Found", friendUserIds.length, "friends:", friendUserIds);
  
  let totalPredictions = 0;
  let successfulPredictions = 0;
  let friendsProcessed = 0;
  
  // 各友達の分身AIを取得
  for (const friendUserId of friendUserIds) {
    try {
      const friendTwin = await db
        .select()
        .from(digitalTwins)
        .where(eq(digitalTwins.userId, friendUserId))
        .limit(1);
      
      if (!friendTwin.length || !friendTwin[0].systemPrompt) {
        console.log(`[generatePredictionsForExistingResponses] Friend ${friendUserId} has no twin or system prompt, skipping`);
        continue;
      }
      
      friendsProcessed++;
      console.log(`[generatePredictionsForExistingResponses] Processing friend ${friendUserId} (${friendTwin[0].name})`);
    
    // 各シナリオに対して予測を生成
    for (const response of responses) {
      totalPredictions++;
      
      // 既に予測があるか確認
      const existingPrediction = await db
        .select()
        .from(friendPredictions)
        .where(
          and(
            eq(friendPredictions.targetUserId, targetUserId),
            eq(friendPredictions.predictorUserId, friendUserId),
            eq(friendPredictions.scenarioId, response.scenarioId)
          )
        )
        .limit(1);
      
      if (existingPrediction.length > 0) {
        // 既存の予測がある場合は比較のみ実行
        if (!existingPrediction[0].comparedAt) {
          try {
            await comparePredictionWithActual(existingPrediction[0].id, response.id);
            successfulPredictions++;
          } catch (error) {
            console.error(`Failed to compare prediction:`, error);
          }
        } else {
          successfulPredictions++; // 既に比較済み
        }
        continue;
      }
      
      try {
        // 予測を生成
        console.log(`Generating prediction from ${friendTwin[0].name} for scenario ${response.scenarioId}`);
        const prediction = await predictUserResponse(
          friendTwin[0].id,
          targetUserId,
          response.scenarioId,
          response.scenarioText || ""
        );
        
        // 予測を保存
        const predictionId = await saveFriendPrediction(
          targetUserId,
          targetTwinId,
          friendUserId,
          friendTwin[0].id,
          response.scenarioId,
          response.scenarioText || "",
          prediction
        );
        
        // 即座に比較
        await comparePredictionWithActual(predictionId, response.id);
        
        successfulPredictions++;
        console.log(`Prediction from ${friendTwin[0].name} completed: ${prediction.predictedVerdict}`);
      } catch (error) {
        console.error(`Failed to generate prediction from friend ${friendUserId}:`, error);
      }
    }
    } catch (friendError) {
      console.error(`[generatePredictionsForExistingResponses] Error processing friend ${friendUserId}:`, friendError);
      // エラーが発生しても次の友達の処理を続行
    }
  }
  
  // 他者視点波形を更新
  await updateOtherPerspectiveWaveform(targetUserId, targetTwinId);
  
  // 乖離度を計算
  await calculateSelfReportGap(targetUserId);
  
  return { totalPredictions, successfulPredictions, friendsProcessed };
}
