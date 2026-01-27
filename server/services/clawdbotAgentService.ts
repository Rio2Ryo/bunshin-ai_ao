/**
 * Clawdbot Agent Service
 * ユーザーごとに独立したClawdbotエージェントを管理
 * ハイブリッド方式: Clawdbotが会話・学習を担当、分身AI DBが基本情報を管理
 */

import { getDb } from "../db";
import { lineConnections, digitalTwins, cumulativeWaveforms, conversationLearning } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "../_core/env";

/**
 * ユーザー固有のAgent IDを生成
 */
export function generateAgentId(userId: number): string {
  return `bunshin_user_${userId}`;
}

/**
 * Clawdbot Gateway APIを呼び出す共通関数
 */
async function callClawdbotApi(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  agentId?: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (!ENV.clawdbotGatewayUrl || !ENV.clawdbotAuthToken) {
    return { success: false, error: "Clawdbot Gateway is not configured" };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ENV.clawdbotAuthToken}`,
      "ngrok-skip-browser-warning": "true",
    };
    
    if (agentId) {
      headers["x-clawdbot-agent-id"] = agentId;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };
    
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(`${ENV.clawdbotGatewayUrl}${endpoint}`, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ClawdbotAgent] API error: ${response.status}`, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[ClawdbotAgent] Request error:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 分身AIの波形データからシステムプロンプトを生成
 */
export async function generateSystemPromptFromWaveform(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return getDefaultSystemPrompt();

  // 分身AI情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.userId, userId))
    .limit(1);

  if (!twin) return getDefaultSystemPrompt();

  // 会話学習データを取得
  const [learning] = await db
    .select()
    .from(conversationLearning)
    .where(eq(conversationLearning.userId, userId))
    .limit(1);

  // 累積波形データを取得
  const [waveform] = await db
    .select()
    .from(cumulativeWaveforms)
    .where(eq(cumulativeWaveforms.userId, userId))
    .limit(1);

  // システムプロンプトを構築
  const parts: string[] = [];

  parts.push(`あなたは「${twin.name}」という名前の分身AIです。`);
  parts.push("ユーザーの代わりに会話し、ユーザーの人格・価値観・話し方を再現してください。");

  if (twin.personality) {
    parts.push(`\n【性格・人格】\n${twin.personality}`);
  }

  // 学習した特性があれば追加（conversationLearningから取得）
  if (learning?.learnedTraits) {
    const traits = learning.learnedTraits as {
      likes?: string[];
      dislikes?: string[];
      values?: string[];
      catchphrases?: string[];
    };
    if (traits.likes?.length) {
      parts.push(`\n【好きなこと】\n${traits.likes.join("、")}`);
    }
    if (traits.dislikes?.length) {
      parts.push(`\n【嫌いなこと】\n${traits.dislikes.join("、")}`);
    }
    if (traits.values?.length) {
      parts.push(`\n【大切にしていること】\n${traits.values.join("、")}`);
    }
    if (traits.catchphrases?.length) {
      parts.push(`\n【口癖・よく使う表現】\n${traits.catchphrases.join("、")}`);
    }
  }

  // ビッグファイブ性格特性があれば追加
  if (twin.bigFiveTraits) {
    const bigFive = twin.bigFiveTraits;
    parts.push("\n【性格特性（ビッグファイブ）】");
    if (bigFive.openness !== undefined) parts.push(`- 開放性: ${bigFive.openness}%`);
    if (bigFive.conscientiousness !== undefined) parts.push(`- 誠実性: ${bigFive.conscientiousness}%`);
    if (bigFive.extraversion !== undefined) parts.push(`- 外向性: ${bigFive.extraversion}%`);
    if (bigFive.agreeableness !== undefined) parts.push(`- 協調性: ${bigFive.agreeableness}%`);
    if (bigFive.neuroticism !== undefined) parts.push(`- 神経症傾向: ${bigFive.neuroticism}%`);
  }

  // MBTIタイプがあれば追加
  if (twin.mbtiType) {
    parts.push(`\n【MBTIタイプ】\n${twin.mbtiType.type}`);
    if (twin.mbtiType.description) {
      parts.push(twin.mbtiType.description);
    }
  }

  // 判断基準の閾値があれば追加
  if (twin.judgmentThresholds) {
    const thresholds = twin.judgmentThresholds;
    parts.push("\n【価値判断の傾向】");
    const criteriaLabels: Record<string, string> = {
      goodEvil: "善悪",
      likesDislike: "好き嫌い",
      profitLoss: "損得",
      interest: "利害",
      pleasurePain: "苦楽",
      difficulty: "難易",
      possibility: "可否",
      comfort: "快不快",
      rightWrong: "正誤",
    };
    for (const [key, value] of Object.entries(thresholds)) {
      const label = criteriaLabels[key] || key;
      if (typeof value === "number") {
        const tendency = value > 60 ? "重視" : value < 40 ? "軽視" : "中立";
        parts.push(`- ${label}: ${tendency} (${value}%)`);
      }
    }
  }

  // 累積波形データがあれば追加
  if (waveform) {
    const virtueCount = waveform.totalVirtueCount || 0;
    const mineCount = waveform.totalMineCount || 0;
    if (virtueCount > 0 || mineCount > 0) {
      parts.push(`\n【評価傾向】`);
      parts.push(`- 徳評価: ${virtueCount}回`);
      parts.push(`- 地雷評価: ${mineCount}回`);
    }
  }

  parts.push("\n\n会話では、上記の性格・価値観を自然に反映してください。");
  parts.push("LINEでの会話なので、簡潔で親しみやすい返答を心がけてください。");
  
  // ツール使用の指示を追加
  parts.push("\n\n【利用可能なツール】");
  parts.push("ユーザーから画像生成を求められた場合は、積極的に画像生成ツールを使用してください。");
  parts.push("「画像を作って」「絵を描いて」「イラストを生成して」などのリクエストには、generate_imageツールを使用して画像を生成してください。");
  parts.push("検索や調べ物を求められた場合は、Web検索ツールを使用してください。");
  parts.push("ツールを使用できないと言わずに、実際にツールを実行して結果を返してください。");
  
  // 画像URLの出力形式の指示
  parts.push("\n【重要: 画像の出力形式】");
  parts.push("画像を生成した場合は、必ずMarkdown形式で画像URLを出力してください。");
  parts.push("例: ![cat](https://example.com/image.png)");
  parts.push("画像URLを出力しないと、ユーザーは画像を見ることができません。");
  parts.push("「画像を表示できない」「画像をお届けできない」とは言わず、必ずURLを出力してください。");

  return parts.join("\n");
}

/**
 * デフォルトのシステムプロンプト
 */
function getDefaultSystemPrompt(): string {
  return `あなたは分身AIです。ユーザーの代わりに会話し、親切で思いやりのある応答をしてください。
LINEでの会話なので、簡潔で親しみやすい返答を心がけてください。

【利用可能なツール】
ユーザーから画像生成を求められた場合は、積極的に画像生成ツールを使用してください。
「画像を作って」「絵を描いて」「イラストを生成して」などのリクエストには、generate_imageツールを使用して画像を生成してください。
検索や調べ物を求められた場合は、Web検索ツールを使用してください。
ツールを使用できないと言わずに、実際にツールを実行して結果を返してください。

【重要: 画像の出力形式】
画像を生成した場合は、必ずMarkdown形式で画像URLを出力してください。
例: ![cat](https://example.com/image.png)
画像URLを出力しないと、ユーザーは画像を見ることができません。
「画像を表示できない」「画像をお届けできない」とは言わず、必ずURLを出力してください。`;
}

/**
 * Clawdbotエージェントを作成
 */
export async function createClawdbotAgent(userId: number): Promise<{
  success: boolean;
  agentId?: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not initialized" };

  const agentId = generateAgentId(userId);
  
  // システムプロンプトを生成
  const systemPrompt = await generateSystemPromptFromWaveform(userId);

  console.log(`[ClawdbotAgent] Creating agent: ${agentId}`);

  // Clawdbot APIでエージェントを初期化
  // 現在のClawdbotはAgent IDをヘッダーで指定するだけで自動的にエージェントが作成される
  const { sendToClawdbot } = await import("./clawdbotGatewayService");
  
  const initResult = await sendToClawdbot(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: "初期化完了。分身AIとして会話を開始します。" },
    ],
    { agentId }
  );

  if (!initResult.success) {
    console.error(`[ClawdbotAgent] Failed to create agent: ${initResult.error}`);
    // エージェント作成に失敗しても、Agent IDは保存しておく
    // 次回の会話時に自動的に作成される
  }

  // DBにAgent IDを保存
  await db
    .update(lineConnections)
    .set({
      clawdbotAgentId: agentId,
      clawdbotAgentCreatedAt: new Date(),
    })
    .where(eq(lineConnections.userId, userId));

  console.log(`[ClawdbotAgent] Agent created and saved: ${agentId}`);

  return { success: true, agentId };
}

/**
 * ユーザーのClawdbotエージェントIDを取得（なければ作成）
 */
export async function getOrCreateAgentId(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return ENV.clawdbotAgentId; // フォールバック

  // 既存のAgent IDを確認
  const [connection] = await db
    .select({ clawdbotAgentId: lineConnections.clawdbotAgentId })
    .from(lineConnections)
    .where(eq(lineConnections.userId, userId))
    .limit(1);

  if (connection?.clawdbotAgentId) {
    return connection.clawdbotAgentId;
  }

  // Agent IDがない場合は作成
  const result = await createClawdbotAgent(userId);
  if (result.success && result.agentId) {
    return result.agentId;
  }

  // 作成に失敗した場合はデフォルトのAgent IDを使用
  return ENV.clawdbotAgentId;
}

/**
 * Clawdbotエージェントのシステムプロンプトを更新
 * 波形データが更新された時に呼び出す
 */
export async function updateAgentSystemPrompt(userId: number): Promise<{
  success: boolean;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not initialized" };

  // Agent IDを取得
  const [connection] = await db
    .select({ clawdbotAgentId: lineConnections.clawdbotAgentId })
    .from(lineConnections)
    .where(eq(lineConnections.userId, userId))
    .limit(1);

  if (!connection?.clawdbotAgentId) {
    return { success: false, error: "Agent not found" };
  }

  // 新しいシステムプロンプトを生成
  const systemPrompt = await generateSystemPromptFromWaveform(userId);

  // Clawdbotにシステムプロンプト更新を通知
  // 現在のClawdbotは会話ごとにシステムプロンプトを送信するため、
  // 次回の会話で新しいプロンプトが使用される
  
  console.log(`[ClawdbotAgent] System prompt updated for agent: ${connection.clawdbotAgentId}`);

  return { success: true };
}

/**
 * LINE連携時にClawdbotエージェントを自動作成
 */
export async function setupClawdbotAgentOnLineLink(
  userId: number,
  lineUserId: string
): Promise<{ success: boolean; agentId?: string; error?: string }> {
  console.log(`[ClawdbotAgent] Setting up agent for LINE user: ${lineUserId}`);

  // エージェントを作成
  const result = await createClawdbotAgent(userId);

  if (result.success) {
    console.log(`[ClawdbotAgent] Agent setup complete: ${result.agentId}`);
  } else {
    console.error(`[ClawdbotAgent] Agent setup failed: ${result.error}`);
  }

  return result;
}

/**
 * ユーザーのエージェント情報を取得
 */
export async function getAgentInfo(userId: number): Promise<{
  agentId: string | null;
  createdAt: Date | null;
  systemPrompt: string;
}> {
  const db = await getDb();
  if (!db) {
    return {
      agentId: null,
      createdAt: null,
      systemPrompt: getDefaultSystemPrompt(),
    };
  }

  const [connection] = await db
    .select({
      clawdbotAgentId: lineConnections.clawdbotAgentId,
      clawdbotAgentCreatedAt: lineConnections.clawdbotAgentCreatedAt,
    })
    .from(lineConnections)
    .where(eq(lineConnections.userId, userId))
    .limit(1);

  const systemPrompt = await generateSystemPromptFromWaveform(userId);

  return {
    agentId: connection?.clawdbotAgentId || null,
    createdAt: connection?.clawdbotAgentCreatedAt || null,
    systemPrompt,
  };
}
