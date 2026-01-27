/**
 * LINE Messaging API Service
 * 公式LINE経由で分身AIと会話するための機能を提供
 */

import { getDb } from "../db";
import { lineConnections, lineMessages, digitalTwins, users, chatSessions, chatMessages } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import crypto from "crypto";

// LINE Messaging API設定
interface LineConfig {
  channelAccessToken: string;
  channelSecret: string;
}

// 環境変数から設定を取得
function getLineConfig(): LineConfig | null {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  
  if (!channelAccessToken || !channelSecret) {
    return null;
  }
  
  return { channelAccessToken, channelSecret };
}

// LINE Webhook署名検証
export function verifyLineSignature(body: string, signature: string): boolean {
  const config = getLineConfig();
  if (!config) return false;
  
  const hash = crypto
    .createHmac("sha256", config.channelSecret)
    .update(body)
    .digest("base64");
  
  return hash === signature;
}

// LINE Webhookイベントの型定義
export interface LineWebhookEvent {
  type: "message" | "follow" | "unfollow" | "join" | "leave" | "postback" | "memberJoined" | "memberLeft";
  timestamp: number;
  source: {
    type: "user" | "group" | "room";
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  message?: {
    id: string;
    type: "text" | "image" | "video" | "audio" | "file" | "location" | "sticker";
    text?: string;
    // 他のメッセージタイプ用のフィールド
  };
  postback?: {
    data: string;
    params?: Record<string, string>;
  };
}

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

/**
 * LINEユーザーIDから分身AIユーザーを検索
 */
export async function findUserByLineId(lineUserId: string) {
  const db = await getDb();
  if (!db) return null;
  
  const [connection] = await db
    .select({
      connectionId: lineConnections.id,
      userId: lineConnections.userId,
      twinId: lineConnections.twinId,
      status: lineConnections.status,
      settings: lineConnections.settings,
    })
    .from(lineConnections)
    .where(eq(lineConnections.lineUserId, lineUserId))
    .limit(1);
  
  return connection || null;
}

/**
 * LINE連携を作成（新規ユーザーがフォローした時）
 */
export async function createLineConnection(
  lineUserId: string,
  lineDisplayName?: string,
  linePictureUrl?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  // 既存の連携を確認
  const existing = await findUserByLineId(lineUserId);
  if (existing) {
    // 既存の連携がある場合はステータスを更新
    await db
      .update(lineConnections)
      .set({
        status: "pending",
        lineDisplayName,
        linePictureUrl,
      })
      .where(eq(lineConnections.lineUserId, lineUserId));
    return existing;
  }
  
  // 新規連携は「pending」状態で作成
  // ユーザーがWebアプリでログインして紐付けを完了する必要がある
  // この時点ではuserId, twinIdは仮の値（0）を設定
  const [result] = await db.insert(lineConnections).values({
    userId: 0, // 後で紐付け
    twinId: 0, // 後で紐付け
    lineUserId,
    lineDisplayName,
    linePictureUrl,
    status: "pending",
    settings: {
      receiveHeartbeat: true,
      receiveNotifications: true,
      allowVoiceMessages: true,
      language: "ja",
    },
  });
  
  return {
    connectionId: result.insertId,
    userId: 0,
    twinId: 0,
    status: "pending" as const,
  };
}

/**
 * LINE連携を分身AIユーザーと紐付け
 * 同時にユーザー固有のClawdbotエージェントを作成
 */
export async function linkLineToUser(
  lineUserId: string,
  userId: number,
  twinId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  // Clawdbotエージェントを作成
  const { setupClawdbotAgentOnLineLink } = await import("./clawdbotAgentService");
  const agentResult = await setupClawdbotAgentOnLineLink(userId, lineUserId);
  
  // LINE連携を更新（Agent IDも保存）
  await db
    .update(lineConnections)
    .set({
      userId,
      twinId,
      status: "active",
      connectedAt: new Date(),
      ...(agentResult.agentId && {
        clawdbotAgentId: agentResult.agentId,
        clawdbotAgentCreatedAt: new Date(),
      }),
    })
    .where(eq(lineConnections.lineUserId, lineUserId));
  
  console.log(`[LINE] User ${userId} linked with LINE ${lineUserId}, Agent: ${agentResult.agentId || "default"}`);
  
  return true;
}

/**
 * LINEメッセージを保存
 */
export async function saveLineMessage(
  connectionId: number,
  userId: number,
  twinId: number,
  lineMessageId: string | undefined,
  direction: "incoming" | "outgoing",
  messageType: "text" | "image" | "audio" | "video" | "sticker" | "location" | "flex",
  content: string | null,
  mediaUrl?: string,
  chatSessionId?: number,
  chatMessageId?: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  const [result] = await db.insert(lineMessages).values({
    connectionId,
    userId,
    twinId,
    lineMessageId,
    direction,
    messageType,
    content,
    mediaUrl,
    status: direction === "incoming" ? "received" : "sent",
    chatSessionId,
    chatMessageId,
  });
  
  // 統計を更新
  const [currentConn] = await db
    .select({ totalMessages: lineConnections.totalMessages })
    .from(lineConnections)
    .where(eq(lineConnections.id, connectionId));
  
  await db
    .update(lineConnections)
    .set({
      totalMessages: (currentConn?.totalMessages || 0) + 1,
      lastMessageAt: new Date(),
    })
    .where(eq(lineConnections.id, connectionId));
  
  return result.insertId;
}

// LINEメッセージの型定義
export type LineMessage = 
  | { type: "text"; text: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string }
  | { type: "flex"; altText: string; contents: unknown }
  | { type: "video"; originalContentUrl: string; previewImageUrl: string }
  | { type: "audio"; originalContentUrl: string; duration: number };

/**
 * LINEにメッセージを送信（Reply）
 */
export async function replyToLine(
  replyToken: string,
  messages: LineMessage[]
) {
  const config = getLineConfig();
  if (!config) {
    console.error("[LINE] Channel access token not configured");
    return false;
  }
  
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LINE] Reply failed:", response.status, errorText);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("[LINE] Reply error:", error);
    return false;
  }
}

/**
 * LINEにメッセージを送信（Push）
 */
export async function pushToLine(
  to: string,
  messages: LineMessage[]
) {
  const config = getLineConfig();
  if (!config) {
    console.error("[LINE] Channel access token not configured");
    return false;
  }
  
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LINE] Push failed:", response.status, errorText);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("[LINE] Push error:", error);
    return false;
  }
}

/**
 * LINEユーザープロフィールを取得
 */
export async function getLineUserProfile(userId: string) {
  const config = getLineConfig();
  if (!config) return null;
  
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${config.channelAccessToken}`,
      },
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      userId: data.userId,
      displayName: data.displayName,
      pictureUrl: data.pictureUrl,
      statusMessage: data.statusMessage,
    };
  } catch (error) {
    console.error("[LINE] Get profile error:", error);
    return null;
  }
}

/**
 * LINE連携を解除
 */
export async function disconnectLine(lineUserId: string) {
  const db = await getDb();
  if (!db) return false;
  
  await db
    .update(lineConnections)
    .set({
      status: "disconnected",
      disconnectedAt: new Date(),
    })
    .where(eq(lineConnections.lineUserId, lineUserId));
  
  return true;
}

/**
 * ユーザーのLINE連携状態を取得
 */
export async function getLineConnectionByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const [connection] = await db
    .select()
    .from(lineConnections)
    .where(eq(lineConnections.userId, userId))
    .limit(1);
  
  return connection || null;
}

/**
 * LINEメッセージ履歴を取得
 */
export async function getLineMessageHistory(
  userId: number,
  limit: number = 50
) {
  const db = await getDb();
  if (!db) return [];
  
  const messages = await db
    .select()
    .from(lineMessages)
    .where(eq(lineMessages.userId, userId))
    .orderBy(desc(lineMessages.createdAt))
    .limit(limit);
  
  return messages.reverse();
}

/**
 * 連携コードを生成（Webアプリでの紐付け用）
 */
export async function generateLinkCode(lineUserId: string): Promise<string> {
  // 6桁のランダムコードを生成
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  // 連携コードを一時的に保存（settings内に保存）
  const [existingConn] = await db
    .select({ settings: lineConnections.settings })
    .from(lineConnections)
    .where(eq(lineConnections.lineUserId, lineUserId));
  
  const currentSettings = (existingConn?.settings || {
    receiveHeartbeat: true,
    receiveNotifications: true,
    allowVoiceMessages: true,
    language: "ja",
  }) as {
    receiveHeartbeat: boolean;
    receiveNotifications: boolean;
    allowVoiceMessages: boolean;
    language: string;
    linkCode?: string;
    linkCodeExpiry?: string;
  };
  
  const updatedSettings = {
    ...currentSettings,
    linkCode: code,
    linkCodeExpiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  
  await db
    .update(lineConnections)
    .set({ settings: updatedSettings as any })
    .where(eq(lineConnections.lineUserId, lineUserId));
  
  return code;
}

/**
 * 連携コードで紐付けを実行
 */
export async function linkByCode(
  code: string,
  userId: number,
  twinId: number
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not initialized" };
  
  // コードに一致する連携を検索
  const connections = await db
    .select()
    .from(lineConnections)
    .where(eq(lineConnections.status, "pending"));
  
  for (const conn of connections) {
    const settings = conn.settings as { linkCode?: string; linkCodeExpiry?: string } | null;
    if (settings?.linkCode === code) {
      // 有効期限を確認
      if (settings.linkCodeExpiry && new Date(settings.linkCodeExpiry) < new Date()) {
        return { success: false, error: "連携コードの有効期限が切れています" };
      }
      
      // 紐付けを実行
      await linkLineToUser(conn.lineUserId, userId, twinId);
      
      return { success: true };
    }
  }
  
  return { success: false, error: "連携コードが見つかりません" };
}
