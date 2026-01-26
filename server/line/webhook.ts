/**
 * LINE Webhook Handler
 * LINE公式アカウントからのメッセージを受信し、Clawdbot経由で分身AIと会話
 * 
 * 機能:
 * - Clawdbot経由での会話（画像生成スキル含む）
 * - 会話学習による分身AI精度向上
 * - 精度確認・学習状況の表示
 */

import type { Request, Response } from "express";
import { getDb } from "../db";
import { digitalTwins, chatSessions, chatMessages, conversationLearning, users, userPoints } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  verifyLineSignature,
  findUserByLineId,
  createLineConnection,
  saveLineMessage,
  replyToLine,
  pushToLine,
  getLineUserProfile,
  disconnectLine,
  generateLinkCode,
  type LineWebhookEvent,
  type LineWebhookBody,
} from "../services/lineService";
import { invokeLLM } from "../_core/llm";
import { 
  saveConversationSnippet,
  getOrCreateConversationLearning,
  analyzeAndUpdatePersonality,
} from "../services/conversationLearningService";
import {
  isClawdbotEnabled,
  sendToClawdbot,
  cleanClawdbotResponse,
} from "../services/clawdbotGatewayService";
import { awardPoints } from "../services/pointService";

/**
 * 応答に画像URLが含まれているかチェック
 */
function extractImageUrls(text: string): string[] {
  // Clawdbotが画像を生成した場合、URLが含まれる
  const urlRegex = /(https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp))/gi;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * 精度確認リクエストかどうかを判定
 */
function isAccuracyCheckRequest(message: string): boolean {
  const patterns = [
    /精度/,
    /学習状況/,
    /どのくらい学習/,
    /どれくらい覚えて/,
    /成長度/,
    /進捗/,
  ];
  return patterns.some(p => p.test(message));
}

/**
 * 分身AI精度情報を取得
 */
async function getTwinAccuracyInfo(userId: number, twinId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "精度情報を取得できませんでした。";

  // 分身AI情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, twinId))
    .limit(1);

  if (!twin) return "分身AIが見つかりません。";

  // 会話学習情報を取得
  const learning = await getOrCreateConversationLearning(userId, twinId);

  // 精度スコアを計算（学習した特性の数に基づく）
  const traits = learning.learnedTraits as any || {};
  let traitCount = 0;
  if (traits.likes?.length) traitCount += traits.likes.length;
  if (traits.dislikes?.length) traitCount += traits.dislikes.length;
  if (traits.values?.length) traitCount += traits.values.length;
  if (traits.catchphrases?.length) traitCount += traits.catchphrases.length;
  if (traits.interests?.length) traitCount += traits.interests.length;
  if (traits.expertise?.length) traitCount += traits.expertise.length;

  // 精度スコア（最大100）
  const accuracyScore = Math.min(100, Math.round(
    (learning.totalConversations * 2) + // 会話数
    (learning.analysisCount * 10) + // 分析回数
    (traitCount * 3) // 学習した特性数
  ));

  // レベルを決定
  let level = "初心者";
  let emoji = "🌱";
  if (accuracyScore >= 80) { level = "マスター"; emoji = "🏆"; }
  else if (accuracyScore >= 60) { level = "エキスパート"; emoji = "⭐"; }
  else if (accuracyScore >= 40) { level = "中級者"; emoji = "📈"; }
  else if (accuracyScore >= 20) { level = "見習い"; emoji = "🌿"; }

  // 学習した特性のサマリー
  const traitsSummary: string[] = [];
  if (traits.likes?.length) traitsSummary.push(`好きなこと: ${traits.likes.slice(0, 3).join("、")}`);
  if (traits.values?.length) traitsSummary.push(`価値観: ${traits.values.slice(0, 3).join("、")}`);
  if (traits.catchphrases?.length) traitsSummary.push(`口癖: ${traits.catchphrases.slice(0, 2).join("、")}`);

  return `${emoji} 分身AI精度レポート ${emoji}

📊 精度スコア: ${accuracyScore}/100
🎯 レベル: ${level}

📝 学習データ
・総会話数: ${learning.totalConversations}回
・分析回数: ${learning.analysisCount}回
・学習した特性: ${traitCount}個

${traitsSummary.length > 0 ? `\n🧠 学習済みの特性\n${traitsSummary.join("\n")}` : ""}

💡 精度を上げるには、もっとたくさん会話してください！
会話を重ねるほど、あなたのことをより深く理解できるようになります。`;
}

/**
 * Clawdbot経由で分身AIの応答を生成
 */
async function generateTwinResponseViaClawdbot(
  userId: number,
  twinId: number,
  userMessage: string,
  lineUserId: string
): Promise<{ text: string; imageUrls: string[] }> {
  const db = await getDb();
  if (!db) {
    return { text: "申し訳ありません、システムエラーが発生しました。", imageUrls: [] };
  }
  
  // 分身AIの情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, twinId))
    .limit(1);
  
  if (!twin) {
    return { text: "分身AIが見つかりません。Webアプリで分身AIを作成してください。", imageUrls: [] };
  }
  
  // LINE用のチャットセッションを検索
  const [lineSession] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.twinId, twinId),
        eq(chatSessions.title, "LINE会話")
      )
    )
    .limit(1);
  
  // 最近の会話履歴を取得（コンテキスト用）
  const recentMessages = lineSession 
    ? await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, lineSession.id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(10)
    : [];
  
  // 会話履歴をメッセージ形式に変換
  const conversationHistory = recentMessages.reverse().map(msg => ({
    role: msg.role as "user" | "assistant",
    content: msg.content || "",
  }));
  
  // システムプロンプトを構築（Clawdbotスキル活用を促す）
  const systemPrompt = buildSystemPromptForClawdbot(twin);
  
  try {
    // Clawdbot経由で応答を生成
    const result = await sendToClawdbot(
      [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userMessage },
      ],
      {
        // LINEユーザーIDをセッションキーとして使用（会話の継続性を保持）
        sessionKey: `line_${lineUserId}`,
      }
    );
    
    if (!result.success) {
      console.error("[LINE] Clawdbot error:", result.error);
      // Clawdbotが失敗した場合はフォールバック
      const fallbackText = await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
      return { text: fallbackText, imageUrls: [] };
    }
    
    // Clawdbotの内部コマンドを除去
    const assistantMessage = cleanClawdbotResponse(result.response || "");
    
    if (!assistantMessage) {
      const fallbackText = await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
      return { text: fallbackText, imageUrls: [] };
    }
    
    // 画像URLを抽出
    const imageUrls = extractImageUrls(assistantMessage);
    
    // 画像URLをテキストから除去（別途画像メッセージとして送信するため）
    let cleanText = assistantMessage;
    for (const url of imageUrls) {
      cleanText = cleanText.replace(url, "").trim();
    }
    // 余分な空行を削除
    cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();
    
    // 会話をDBに保存
    await saveConversation(db, userId, twinId, userMessage, assistantMessage);
    
    return { text: cleanText || "画像を生成しました！", imageUrls };
  } catch (error) {
    console.error("[LINE] Clawdbot error:", error);
    const fallbackText = await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
    return { text: fallbackText, imageUrls: [] };
  }
}

/**
 * フォールバック: 直接LLMで応答を生成
 */
async function generateTwinResponseFallback(
  userId: number,
  twinId: number,
  userMessage: string,
  systemPrompt: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const db = await getDb();
  if (!db) {
    return "申し訳ありません、システムエラーが発生しました。";
  }
  
  try {
    // LLMで応答を生成
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userMessage },
      ],
    });
    
    const responseContent = response.choices?.[0]?.message?.content;
    const assistantMessage = typeof responseContent === "string" 
      ? responseContent 
      : "応答を生成できませんでした。";
    
    // 会話をDBに保存
    await saveConversation(db, userId, twinId, userMessage, assistantMessage);
    
    return assistantMessage;
  } catch (error) {
    console.error("[LINE] LLM fallback error:", error);
    return "申し訳ありません、応答の生成中にエラーが発生しました。";
  }
}

/**
 * 分身AIの応答を生成（メインエントリーポイント）
 */
async function generateTwinResponse(
  userId: number,
  twinId: number,
  userMessage: string,
  lineUserId: string
): Promise<{ text: string; imageUrls: string[] }> {
  // 精度確認リクエストの場合
  if (isAccuracyCheckRequest(userMessage)) {
    const accuracyInfo = await getTwinAccuracyInfo(userId, twinId);
    return { text: accuracyInfo, imageUrls: [] };
  }

  // Clawdbotが有効な場合はClawdbot経由で応答
  if (isClawdbotEnabled()) {
    return await generateTwinResponseViaClawdbot(userId, twinId, userMessage, lineUserId);
  }
  
  // Clawdbotが無効な場合は直接LLMを使用
  console.log("[LINE] Clawdbot not configured, using direct LLM");
  const db = await getDb();
  if (!db) return { text: "申し訳ありません、システムエラーが発生しました。", imageUrls: [] };
  
  // 分身AIの情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, twinId))
    .limit(1);
  
  if (!twin) {
    return { text: "分身AIが見つかりません。Webアプリで分身AIを作成してください。", imageUrls: [] };
  }
  
  const systemPrompt = buildSystemPrompt(twin);
  
  // LINE用のチャットセッションを検索
  const [lineSession] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.twinId, twinId),
        eq(chatSessions.title, "LINE会話")
      )
    )
    .limit(1);
  
  // 最近の会話履歴を取得
  const recentMessages = lineSession 
    ? await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, lineSession.id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(10)
    : [];
  
  const conversationHistory = recentMessages.reverse().map(msg => ({
    role: msg.role as "user" | "assistant",
    content: msg.content || "",
  }));
  
  const text = await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
  return { text, imageUrls: [] };
}

/**
 * Clawdbot用のシステムプロンプトを構築（スキル活用を促す）
 */
function buildSystemPromptForClawdbot(twin: any): string {
  const parts: string[] = [];
  
  parts.push(`あなたは「${twin.name}」という名前の分身AIです。`);
  parts.push("ユーザーの代わりに会話し、ユーザーの人格・価値観・話し方を再現してください。");
  
  if (twin.personality) {
    parts.push(`\n【性格・人格】\n${twin.personality}`);
  }
  
  if (twin.systemPrompt) {
    parts.push(`\n【追加の指示】\n${twin.systemPrompt}`);
  }
  
  // 学習した特性があれば追加
  if (twin.learnedTraits) {
    const traits = twin.learnedTraits as any;
    if (traits.likes?.length > 0) {
      parts.push(`\n【好きなこと】\n${traits.likes.join("、")}`);
    }
    if (traits.dislikes?.length > 0) {
      parts.push(`\n【嫌いなこと】\n${traits.dislikes.join("、")}`);
    }
    if (traits.values?.length > 0) {
      parts.push(`\n【大切にしていること】\n${traits.values.join("、")}`);
    }
    if (traits.catchphrases?.length > 0) {
      parts.push(`\n【口癖・よく使う表現】\n${traits.catchphrases.join("、")}`);
    }
  }
  
  // Clawdbotスキル活用の指示
  parts.push(`\n【利用可能なスキル】
あなたは以下のスキルを持っています。ユーザーのリクエストに応じて適切に使用してください：

1. 画像生成: 「画像を生成して」「〜の絵を描いて」などのリクエストがあれば、画像を生成してください。
2. Web検索: 最新情報が必要な場合は検索して情報を提供してください。
3. 計算・分析: 数値計算や分析が必要な場合は実行してください。

これらのスキルは自然な会話の中で使用してください。コマンド形式ではなく、ユーザーの意図を理解して適切に対応してください。`);
  
  parts.push("\n\n【LINEでの会話ルール】");
  parts.push("- 簡潔で親しみやすい返答を心がけてください");
  parts.push("- 長文は避け、1-3文程度で返答してください");
  parts.push("- 画像を生成した場合は、画像URLをそのまま返答に含めてください");
  
  return parts.join("\n");
}

/**
 * 通常のシステムプロンプトを構築
 */
function buildSystemPrompt(twin: any): string {
  const parts: string[] = [];
  
  parts.push(`あなたは「${twin.name}」という名前の分身AIです。`);
  parts.push("ユーザーの代わりに会話し、ユーザーの人格・価値観・話し方を再現してください。");
  
  if (twin.personality) {
    parts.push(`\n【性格・人格】\n${twin.personality}`);
  }
  
  if (twin.systemPrompt) {
    parts.push(`\n【追加の指示】\n${twin.systemPrompt}`);
  }
  
  // 学習した特性があれば追加
  if (twin.learnedTraits) {
    const traits = twin.learnedTraits as any;
    if (traits.likes?.length > 0) {
      parts.push(`\n【好きなこと】\n${traits.likes.join("、")}`);
    }
    if (traits.dislikes?.length > 0) {
      parts.push(`\n【嫌いなこと】\n${traits.dislikes.join("、")}`);
    }
    if (traits.values?.length > 0) {
      parts.push(`\n【大切にしていること】\n${traits.values.join("、")}`);
    }
    if (traits.catchphrases?.length > 0) {
      parts.push(`\n【口癖・よく使う表現】\n${traits.catchphrases.join("、")}`);
    }
  }
  
  parts.push("\n\nLINEでの会話なので、簡潔で親しみやすい返答を心がけてください。");
  parts.push("長文は避け、1-3文程度で返答してください。");
  
  return parts.join("\n");
}

/**
 * 会話をDBに保存
 */
async function saveConversation(
  db: any,
  userId: number,
  twinId: number,
  userMessage: string,
  assistantMessage: string
) {
  // LINE用のチャットセッションを取得または作成
  let [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.twinId, twinId),
        eq(chatSessions.title, "LINE会話")
      )
    )
    .limit(1);
  
  if (!session) {
    const [result] = await db.insert(chatSessions).values({
      userId,
      twinId,
      title: "LINE会話",
      mode: "casual",
    });
    session = { id: Number(result.insertId) };
  }
  
  // ユーザーメッセージを保存
  await db.insert(chatMessages).values({
    sessionId: session.id,
    userId,
    twinId,
    role: "user",
    content: userMessage,
  });
  
  // アシスタントメッセージを保存
  await db.insert(chatMessages).values({
    sessionId: session.id,
    userId,
    twinId,
    role: "assistant",
    content: assistantMessage,
  });
  
  // 会話学習用にスニペットを保存
  await saveConversationSnippet(
    userId,
    twinId,
    "line",
    userMessage,
    undefined,
    `line_${Date.now()}`
  );

  // LINE会話でポイント付与（1pt/会話）
  try {
    await awardPoints(userId, "line_conversation", `line_${Date.now()}`, `LINE会話: ${userMessage.substring(0, 30)}...`);
  } catch (e) {
    console.error("[LINE] Failed to award points:", e);
  }
}

/**
 * フォローイベントの処理
 */
async function handleFollowEvent(event: LineWebhookEvent) {
  const lineUserId = event.source.userId;
  if (!lineUserId) return;
  
  console.log("[LINE] Follow event from:", lineUserId);
  
  // ユーザープロフィールを取得
  const profile = await getLineUserProfile(lineUserId);
  
  // 連携を作成（pending状態）
  const connection = await createLineConnection(
    lineUserId,
    profile?.displayName,
    profile?.pictureUrl
  );
  
  // 連携コードを生成
  const linkCode = await generateLinkCode(lineUserId);
  
  // ウェルカムメッセージを送信
  if (event.replyToken) {
    await replyToLine(event.replyToken, [
      {
        type: "text",
        text: `友だち追加ありがとうございます！🎉\n\n分身AIとLINEを連携するには、以下の連携コードをWebアプリで入力してください。\n\n📱 連携コード: ${linkCode}\n\n※有効期限: 10分\n※Webアプリ: https://bunshinai.net/line-link`,
      },
    ]);
  }
}

/**
 * アンフォローイベントの処理
 */
async function handleUnfollowEvent(event: LineWebhookEvent) {
  const lineUserId = event.source.userId;
  if (!lineUserId) return;
  
  console.log("[LINE] Unfollow event from:", lineUserId);
  
  // 連携を解除
  await disconnectLine(lineUserId);
}

/**
 * メッセージイベントの処理
 */
async function handleMessageEvent(event: LineWebhookEvent) {
  console.log("[LINE] ========== MESSAGE EVENT ==========");
  console.log("[LINE] Full event:", JSON.stringify(event, null, 2));
  
  const lineUserId = event.source.userId;
  console.log("[LINE] lineUserId:", lineUserId);
  console.log("[LINE] event.message:", event.message);
  console.log("[LINE] event.replyToken:", event.replyToken);
  
  if (!lineUserId || !event.message || !event.replyToken) {
    console.log("[LINE] Early return - missing required fields");
    return;
  }
  
  console.log("[LINE] Message event from:", lineUserId, event.message.type);
  console.log("[LINE] Clawdbot enabled:", isClawdbotEnabled());
  console.log("[LINE] Clawdbot URL:", process.env.CLAWDBOT_GATEWAY_URL || "not set");
  
  // ユーザーを検索
  console.log("[LINE] Searching for user with lineUserId:", lineUserId);
  const connection = await findUserByLineId(lineUserId);
  console.log("[LINE] Connection found:", JSON.stringify(connection, null, 2));
  
  if (!connection) {
    // 未連携ユーザー
    const linkCode = await generateLinkCode(lineUserId);
    await replyToLine(event.replyToken, [
      {
        type: "text",
        text: `まだLINE連携が完了していません。\n\nWebアプリで以下の連携コードを入力してください。\n\n📱 連携コード: ${linkCode}\n\n※有効期限: 10分`,
      },
    ]);
    return;
  }
  
  if (connection.status !== "active") {
    // 連携が無効
    await replyToLine(event.replyToken, [
      {
        type: "text",
        text: "LINE連携が一時停止されています。Webアプリで連携を再開してください。",
      },
    ]);
    return;
  }
  
  const { userId, twinId, connectionId } = connection;
  
  // テキストメッセージの処理
  if (event.message.type === "text" && event.message.text) {
    const userMessage = event.message.text;
    
    // メッセージを保存
    await saveLineMessage(
      connectionId,
      userId,
      twinId,
      event.message.id,
      "incoming",
      "text",
      userMessage
    );
    
    // 分身AIの応答を生成（Clawdbot経由、画像生成対応）
    const response = await generateTwinResponse(userId, twinId, userMessage, lineUserId);
    
    // 応答を保存
    await saveLineMessage(
      connectionId,
      userId,
      twinId,
      undefined,
      "outgoing",
      "text",
      response.text
    );
    
    // LINEに返信（テキスト + 画像）
    const messages: Array<{
      type: "text" | "image";
      text?: string;
      originalContentUrl?: string;
      previewImageUrl?: string;
    }> = [];
    
    // テキストメッセージ
    if (response.text) {
      messages.push({
        type: "text",
        text: response.text,
      });
    }
    
    // 画像メッセージ（最大5枚）
    for (const imageUrl of response.imageUrls.slice(0, 5)) {
      messages.push({
        type: "image",
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      });
    }
    
    await replyToLine(event.replyToken, messages as any);
  } else {
    // テキスト以外のメッセージ
    await replyToLine(event.replyToken, [
      {
        type: "text",
        text: "現在、テキストメッセージのみ対応しています。",
      },
    ]);
  }
}

/**
 * グループ参加イベントの処理
 */
async function handleJoinEvent(event: LineWebhookEvent) {
  const groupId = event.source.groupId;
  if (!groupId || !event.replyToken) return;
  
  console.log("[LINE] Join event to group:", groupId);
  
  // グループ参加時のメッセージ
  await replyToLine(event.replyToken, [
    {
      type: "text",
      text: "分身AIボットがグループに参加しました！🤖\n\nグループ内の会話を観察して、メンバーの分身AIの人格学習に活用します。\n\n※プライバシーに配慮し、学習データは各ユーザーの分身AIのみに使用されます。",
    },
  ]);
}

/**
 * Webhook受信エンドポイント
 */
export async function handleLineWebhook(req: Request, res: Response) {
  // LINEには先に200を返す（タイムアウト防止）
  res.status(200).json({ success: true });
  
  try {
    // 署名検証
    const signature = req.headers["x-line-signature"] as string;
    const body = JSON.stringify(req.body);
    
    if (!verifyLineSignature(body, signature)) {
      console.error("[LINE] Invalid signature");
      return;
    }
    
    const webhookBody = req.body as LineWebhookBody;
    
    // 各イベントを処理
    for (const event of webhookBody.events) {
      try {
        switch (event.type) {
          case "follow":
            await handleFollowEvent(event);
            break;
          case "unfollow":
            await handleUnfollowEvent(event);
            break;
          case "message":
            await handleMessageEvent(event);
            break;
          case "join":
            await handleJoinEvent(event);
            break;
          default:
            console.log("[LINE] Unhandled event type:", event.type);
        }
      } catch (eventError) {
        console.error("[LINE] Event processing error:", eventError);
      }
    }
    
  } catch (error) {
    console.error("[LINE] Webhook error:", error);
  }
}

/**
 * Webhook設定確認エンドポイント（GET）
 */
export async function getLineWebhookInfo(req: Request, res: Response) {
  res.json({
    status: "active",
    version: "2.0.0",
    clawdbotEnabled: isClawdbotEnabled(),
    supportedEvents: ["follow", "unfollow", "message", "join", "leave"],
    supportedMessageTypes: ["text"],
    features: [
      "画像生成（自然言語リクエスト対応）",
      "会話学習による分身AI精度向上",
      "精度確認機能",
      "ポイント付与",
    ],
    documentation: "https://developers.line.biz/ja/docs/messaging-api/",
  });
}
