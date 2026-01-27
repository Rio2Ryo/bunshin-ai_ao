/**
 * LINE Webhook Handler
 * LINE公式アカウントからのメッセージを受信し、Clawdbot経由で分身AIと会話
 */

import type { Request, Response } from "express";
import { getDb } from "../db";
import { digitalTwins, chatSessions, chatMessages } from "../../drizzle/schema";
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
  getOrCreateConversationLearning 
} from "../services/conversationLearningService";
import {
  isClawdbotEnabled,
  sendToClawdbot,
  cleanClawdbotResponse,
} from "../services/clawdbotGatewayService";
import {
  getOrCreateAgentId,
  generateSystemPromptFromWaveform,
  setupClawdbotAgentOnLineLink,
} from "../services/clawdbotAgentService";
import {
  parseClawdbotResponse,
  isValidLineMediaUrl,
  normalizeMediaUrl,
  generatePreviewUrl,
  type ParsedClawdbotResponse,
} from "../services/clawdbotResponseParser";
import {
  proxyImageToS3,
  needsProxy,
} from "../services/imageProxyService";
import type { LineMessage } from "../services/lineService";

/**
 * Clawdbot経由で分身AIの応答を生成
 * 画像やメディアを含む応答も対応
 */
// テキストのみのフォールバック応答を作成
function createTextOnlyResponse(text: string): ParsedClawdbotResponse {
  return {
    textContent: text,
    mediaContents: [],
    hasMedia: false,
    rawResponse: text,
  };
}

async function generateTwinResponseViaClawdbot(
  userId: number,
  twinId: number,
  userMessage: string,
  lineUserId: string
): Promise<ParsedClawdbotResponse> {
  const startTime = Date.now();
  console.log(`[LINE] Starting response generation for user: ${userId}`);
  
  const db = await getDb();
  if (!db) {
    return createTextOnlyResponse("申し訳ありません、システムエラーが発生しました。");
  }
  
  // 並列でデータを取得（高速化）
  const [twinResult, sessionResult, agentIdResult, systemPromptResult] = await Promise.all([
    // 1. 分身AIの情報を取得
    db.select().from(digitalTwins).where(eq(digitalTwins.id, twinId)).limit(1),
    // 2. LINE用のチャットセッションを検索
    db.select().from(chatSessions).where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.twinId, twinId),
        eq(chatSessions.title, "LINE会話")
      )
    ).limit(1),
    // 3. ユーザー固有のAgent IDを取得
    getOrCreateAgentId(userId),
    // 4. システムプロンプトを生成
    generateSystemPromptFromWaveform(userId),
  ]);
  
  const dbTime = Date.now() - startTime;
  console.log(`[LINE] DB queries completed in ${dbTime}ms`);
  
  const [twin] = twinResult;
  const [lineSession] = sessionResult;
  const agentId = agentIdResult;
  
  if (!twin) {
    return createTextOnlyResponse("分身AIが見つかりません。Webアプリで分身AIを作成してください。");
  }
  
  // 最近の会話履歴を取得（セッションがある場合のみ）
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
  
  console.log(`[LINE] Using agent ID: ${agentId} for user: ${userId}`);
  
  // システムプロンプトを構築（波形データを含む）
  const systemPrompt = systemPromptResult || buildSystemPrompt(twin);
  
  try {
    // Clawdbot経由で応答を生成（ユーザー固有のAgent IDを使用）
    const result = await sendToClawdbot(
      [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userMessage },
      ],
      {
        // ユーザー固有のAgent IDを使用（各ユーザーが独立した「魂」を持つ）
        agentId,
        // LINEユーザーIDをセッションキーとして使用（会話の継続性を保持）
        sessionKey: `line_${lineUserId}`,
      }
    );
    
    if (!result.success) {
      console.error("[LINE] Clawdbot error:", result.error);
      // Clawdbotが失敗した場合はフォールバック
      return await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
    }
    
    // Clawdbotの応答をパース（画像やメディアを抽出）
    const rawResponse = result.response || "";
    const parsedResponse = parseClawdbotResponse(rawResponse);
    
    console.log(`[LINE] Parsed response: text=${parsedResponse.textContent.length} chars, media=${parsedResponse.mediaContents.length} items`);
    
    if (!parsedResponse.textContent && !parsedResponse.hasMedia) {
      return await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
    }
    
    // 会話をDBに保存（生の応答を保存）
    await saveConversation(db, userId, twinId, userMessage, rawResponse);
    
    return parsedResponse;
  } catch (error) {
    console.error("[LINE] Clawdbot error:", error);
    return await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
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
): Promise<ParsedClawdbotResponse> {
  const db = await getDb();
  if (!db) {
    return createTextOnlyResponse("申し訳ありません、システムエラーが発生しました。");
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
    
    return createTextOnlyResponse(assistantMessage);
  } catch (error) {
    console.error("[LINE] LLM fallback error:", error);
    return createTextOnlyResponse("申し訳ありません、応答の生成中にエラーが発生しました。");
  }
}

/**
 * 分身AIの応答を生成（メインエントリーポイント）
 * 画像やメディアを含む応答も対応
 */
async function generateTwinResponse(
  userId: number,
  twinId: number,
  userMessage: string,
  lineUserId: string
): Promise<ParsedClawdbotResponse> {
  // Clawdbotが有効な場合はClawdbot経由で応答
  if (isClawdbotEnabled()) {
    return await generateTwinResponseViaClawdbot(userId, twinId, userMessage, lineUserId);
  }
  
  // Clawdbotが無効な場合は直接LLMを使用
  console.log("[LINE] Clawdbot not configured, using direct LLM");
  const db = await getDb();
  if (!db) return createTextOnlyResponse("申し訳ありません、システムエラーが発生しました。");
  
  // 分身AIの情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.id, twinId))
    .limit(1);
  
  if (!twin) {
    return createTextOnlyResponse("分身AIが見つかりません。Webアプリで分身AIを作成してください。");
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
  
  return await generateTwinResponseFallback(userId, twinId, userMessage, systemPrompt, conversationHistory);
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
  
  // ツール使用の指示を追加
  parts.push("\n【利用可能なツール】");
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
  parts.push("画像はNano Banana Pro（高品質画像生成AI）で生成されます。");
  
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
    
    // 分身AIの応答を生成（Clawdbot経由、画像やメディアを含む可能性あり）
    const parsedResponse = await generateTwinResponse(userId, twinId, userMessage, lineUserId);
    
    // 応答を保存（生の応答を保存）
    await saveLineMessage(
      connectionId,
      userId,
      twinId,
      undefined,
      "outgoing",
      "text",
      parsedResponse.rawResponse
    );
    
    // LINEメッセージを構築（テキスト+メディア）
    const lineMessages: LineMessage[] = [];
    
    // テキストコンテンツがあれば追加
    if (parsedResponse.textContent) {
      lineMessages.push({
        type: "text",
        text: parsedResponse.textContent,
      });
    }
    
    // メディアコンテンツを追加（最大4つまで、LINEの制限）
    for (const media of parsedResponse.mediaContents.slice(0, 4)) {
      if (media.type === "image" && isValidLineMediaUrl(media.content)) {
        let imageUrl = normalizeMediaUrl(media.content);
        
        // 非公開ストレージの場合はプロキシ経由でS3に再アップロード
        if (needsProxy(imageUrl)) {
          console.log(`[LINE] Image needs proxy: ${imageUrl}`);
          const proxyResult = await proxyImageToS3(imageUrl, userId);
          if (proxyResult.success && proxyResult.url) {
            imageUrl = proxyResult.url;
            console.log(`[LINE] Proxied image URL: ${imageUrl}`);
          } else {
            console.error(`[LINE] Failed to proxy image: ${proxyResult.error}`);
            // プロキシ失敗時はテキストで代替
            lineMessages.push({
              type: "text",
              text: `🖼️ 画像を生成しましたが、表示できませんでした。`,
            });
            continue;
          }
        }
        
        lineMessages.push({
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: generatePreviewUrl(imageUrl),
        });
        console.log(`[LINE] Adding image message: ${imageUrl}`);
      } else if (media.type === "video" && isValidLineMediaUrl(media.content)) {
        const videoUrl = normalizeMediaUrl(media.content);
        // 動画の場合はプレビュー画像が必要（今はテキストで代替）
        lineMessages.push({
          type: "text",
          text: `🎬 動画: ${videoUrl}`,
        });
      } else if (media.type === "audio" && isValidLineMediaUrl(media.content)) {
        // 音声の場合はテキストで代替
        lineMessages.push({
          type: "text",
          text: `🎵 音声: ${media.content}`,
        });
      }
    }
    
    // メッセージが空の場合はデフォルトメッセージ
    if (lineMessages.length === 0) {
      lineMessages.push({
        type: "text",
        text: "応答を生成できませんでした。",
      });
    }
    
    // LINEに返信（最大5メッセージまで）
    await replyToLine(event.replyToken, lineMessages.slice(0, 5));
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
 * グループメッセージの観察処理
 * グループ内でLINE連携済みユーザーのメッセージを観察して学習に活用
 */
async function handleGroupMessage(event: LineWebhookEvent) {
  const groupId = event.source.groupId;
  const lineUserId = event.source.userId;
  
  if (!groupId || !lineUserId || !event.message || event.message.type !== "text") {
    return;
  }
  
  const messageText = event.message.text;
  if (!messageText) return;
  
  console.log("[LINE] Group message observation:", groupId, lineUserId);
  
  // メッセージ送信者がLINE連携済みか確認
  const connection = await findUserByLineId(lineUserId);
  if (!connection || connection.status !== "active") {
    // 未連携ユーザーのメッセージは観察しない
    return;
  }
  
  const db = await getDb();
  if (!db) return;
  
  // 観察データを保存
  await db.execute(
    sql`INSERT INTO line_group_observations (groupId, observedLineUserId, observedUserId, messageContent, messageType) 
        VALUES (${groupId}, ${lineUserId}, ${connection.userId}, ${messageText}, 'text')`
  );
  
  // 会話学習にも反映（グループ会話として）
  await saveConversationSnippet(
    connection.userId,
    connection.twinId,
    "group",
    messageText,
    `グループID: ${groupId}`
  );
  
  console.log("[LINE] Group observation saved for user:", connection.userId);
  
  // グループでは返信しない（観察モード）
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
            // グループメッセージの場合は観察モード
            if (event.source.type === "group") {
              await handleGroupMessage(event);
            } else {
              await handleMessageEvent(event);
            }
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
    version: "1.0.0",
    clawdbotEnabled: isClawdbotEnabled(),
    supportedEvents: ["follow", "unfollow", "message", "join", "leave"],
    supportedMessageTypes: ["text"],
    documentation: "https://developers.line.biz/ja/docs/messaging-api/",
  });
}
