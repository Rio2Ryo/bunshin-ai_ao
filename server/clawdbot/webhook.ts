/**
 * Clawdbot Webhook Handler
 * LINEなどからのメッセージをリアルタイムで受信し、会話学習に活用
 */

import type { Request, Response } from "express";
import { getDb } from "../db";
import { clawdbotConnections, digitalTwins, users } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { 
  saveConversationSnippet, 
  recordGroupConversation,
  getOrCreateConversationLearning 
} from "../services/conversationLearningService";
import crypto from "crypto";

// Webhook署名検証用のシークレット（接続ごとに設定可能）
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret || !signature) {
    // シークレットが設定されていない場合はスキップ
    return true;
  }
  
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// メッセージタイプの定義
interface ClawdbotWebhookPayload {
  type: "message" | "group_message" | "status" | "error";
  userId?: string;
  agentId?: string;
  
  // 1対1メッセージ
  message?: {
    content: string;
    direction: "incoming" | "outgoing";
    timestamp: string;
    channel?: string; // "line", "whatsapp", "telegram", etc.
    metadata?: Record<string, unknown>;
  };
  
  // グループメッセージ
  groupMessage?: {
    groupId: string;
    groupName?: string;
    speakerType: "self" | "other";
    speakerName?: string;
    speakerId?: string;
    content: string;
    timestamp: string;
    replyToMessageId?: string;
    threadContext?: string;
    channel?: string;
  };
  
  // ステータス更新
  status?: {
    connected: boolean;
    lastActivity?: string;
    error?: string;
  };
  
  // エラー情報
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * ユーザーIDからDB上のユーザーを特定
 * ClawdbotのuserIdは接続時に設定したagentIdまたはカスタムIDを使用
 */
async function findUserByClawdbotId(clawdbotUserId: string, agentId?: string) {
  const db = await getDb();
  if (!db) return null;
  
  // clawdbot_connectionsテーブルからユーザーを検索
  const connections = await db
    .select({
      userId: clawdbotConnections.userId,
      twinId: clawdbotConnections.twinId,
    })
    .from(clawdbotConnections)
    .where(
      agentId 
        ? eq(clawdbotConnections.agentId, agentId)
        : eq(clawdbotConnections.status, "active")
    )
    .limit(10);
  
  if (connections.length === 0) return null;
  
  // 複数の接続がある場合は最初のものを使用
  // 将来的にはclawdbotUserIdとのマッピングテーブルを作成
  return connections[0];
}

/**
 * Webhook受信エンドポイント
 */
export async function handleClawdbotWebhook(req: Request, res: Response) {
  try {
    const signature = req.headers["x-clawdbot-signature"] as string | undefined;
    const payload = JSON.stringify(req.body);
    
    // ペイロードの検証
    const webhookPayload = req.body as ClawdbotWebhookPayload;
    
    console.log("[Clawdbot Webhook] Received:", webhookPayload.type);
    
    // ユーザーを特定
    const userInfo = await findUserByClawdbotId(
      webhookPayload.userId || "",
      webhookPayload.agentId
    );
    
    if (!userInfo) {
      console.log("[Clawdbot Webhook] User not found for:", webhookPayload.userId);
      // ユーザーが見つからなくても200を返す（Clawdbot側でリトライを防ぐ）
      return res.status(200).json({ 
        success: false, 
        error: "User not found" 
      });
    }
    
    const { userId, twinId } = userInfo;
    
    // 学習データを初期化（存在しない場合）
    await getOrCreateConversationLearning(userId, twinId);
    
    switch (webhookPayload.type) {
      case "message":
        // 1対1メッセージの処理
        if (webhookPayload.message) {
          const msg = webhookPayload.message;
          
          // 自分が送ったメッセージのみ学習対象
          if (msg.direction === "outgoing") {
            await saveConversationSnippet(
              userId,
              twinId,
              "clawdbot",
              msg.content,
              msg.channel ? `チャンネル: ${msg.channel}` : undefined,
              `webhook_${Date.now()}`
            );
            
            console.log("[Clawdbot Webhook] Saved message snippet for user:", userId);
          }
        }
        break;
        
      case "group_message":
        // グループメッセージの処理
        if (webhookPayload.groupMessage) {
          const gm = webhookPayload.groupMessage;
          
          await recordGroupConversation(
            userId,
            twinId,
            gm.groupId,
            gm.groupName,
            gm.speakerType,
            gm.content,
            gm.speakerName,
            undefined, // replyToId - 将来的にメッセージIDマッピングを実装
            gm.threadContext
          );
          
          console.log("[Clawdbot Webhook] Recorded group message:", {
            groupId: gm.groupId,
            speakerType: gm.speakerType,
          });
        }
        break;
        
      case "status":
        // ステータス更新の処理
        if (webhookPayload.status) {
          const db = await getDb();
          if (db) {
            await db
              .update(clawdbotConnections)
              .set({
                status: webhookPayload.status.connected ? "active" : "disconnected",
                lastError: webhookPayload.status.error || null,
              })
              .where(eq(clawdbotConnections.userId, userId));
          }
          console.log("[Clawdbot Webhook] Status updated:", webhookPayload.status);
        }
        break;
        
      case "error":
        // エラーの処理
        if (webhookPayload.error) {
          console.error("[Clawdbot Webhook] Error:", webhookPayload.error);
          
          const db = await getDb();
          if (db) {
            await db
              .update(clawdbotConnections)
              .set({
                status: "error",
                lastError: webhookPayload.error.message,
              })
              .where(eq(clawdbotConnections.userId, userId));
          }
        }
        break;
        
      default:
        console.log("[Clawdbot Webhook] Unknown type:", webhookPayload.type);
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error("[Clawdbot Webhook] Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
}

/**
 * Webhook設定確認エンドポイント（GET）
 */
export async function getClawdbotWebhookInfo(req: Request, res: Response) {
  res.json({
    status: "active",
    version: "1.0.0",
    supportedTypes: ["message", "group_message", "status", "error"],
    documentation: "https://github.com/your-repo/bunshin-ai/docs/clawdbot-webhook.md",
  });
}
