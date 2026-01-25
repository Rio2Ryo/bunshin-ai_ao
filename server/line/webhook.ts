/**
 * LINE Webhook Handler
 * LINE公式アカウントからのメッセージを受信し、分身AIと会話
 */

import type { Request, Response } from "express";
import { getDb } from "../db";
import { digitalTwins, chatSessions, chatMessages } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
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
  getOrCreateConversationLearning 
} from "../services/conversationLearningService";

/**
 * 分身AIの応答を生成
 */
async function generateTwinResponse(
  userId: number,
  twinId: number,
  userMessage: string
): Promise<string> {
  const db = await getDb();
  if (!db) return "申し訳ありません、システムエラーが発生しました。";
  
  // 分身AIの情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, twinId))
    .limit(1);
  
  if (!twin) {
    return "分身AIが見つかりません。Webアプリで分身AIを作成してください。";
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
  
  // システムプロンプトを構築
  const systemPrompt = buildSystemPrompt(twin);
  
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
    console.error("[LINE] LLM error:", error);
    return "申し訳ありません、応答の生成中にエラーが発生しました。";
  }
}

/**
 * システムプロンプトを構築
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
    session = { id: result.insertId };
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
        text: `友だち追加ありがとうございます！🎉\n\n分身AIとLINEを連携するには、以下の連携コードをWebアプリで入力してください。\n\n📱 連携コード: ${linkCode}\n\n※有効期限: 10分\n※Webアプリ: https://bunshin-ai.manus.space/line-link`,
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
  const lineUserId = event.source.userId;
  if (!lineUserId || !event.message || !event.replyToken) return;
  
  console.log("[LINE] Message event from:", lineUserId, event.message.type);
  
  // ユーザーを検索
  const connection = await findUserByLineId(lineUserId);
  
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
    
    // 分身AIの応答を生成
    const response = await generateTwinResponse(userId, twinId, userMessage);
    
    // 応答を保存
    await saveLineMessage(
      connectionId,
      userId,
      twinId,
      undefined,
      "outgoing",
      "text",
      response
    );
    
    // LINEに返信
    await replyToLine(event.replyToken, [
      {
        type: "text",
        text: response,
      },
    ]);
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
  try {
    const webhookBody = req.body as LineWebhookBody;
    
    // LINEの検証リクエスト（空のevents配列）の場合は署名検証をスキップ
    if (!webhookBody.events || webhookBody.events.length === 0) {
      console.log("[LINE] Verification request received");
      return res.status(200).json({ success: true, message: "Webhook verified" });
    }
    
    // 署名検証（実際のイベントがある場合のみ）
    const signature = req.headers["x-line-signature"] as string;
    const body = JSON.stringify(req.body);
    
    if (!verifyLineSignature(body, signature)) {
      console.error("[LINE] Invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
    
    console.log("[LINE] Webhook received:", webhookBody.events.length, "events");
    
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
        // 個別のイベントエラーは無視して続行
      }
    }
    
    // LINEには常に200を返す
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error("[LINE] Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Webhook設定確認エンドポイント（GET）
 */
export async function getLineWebhookInfo(req: Request, res: Response) {
  res.json({
    status: "active",
    version: "1.0.0",
    supportedEvents: ["follow", "unfollow", "message", "join", "leave"],
    supportedMessageTypes: ["text"],
    documentation: "https://developers.line.biz/ja/docs/messaging-api/",
  });
}
