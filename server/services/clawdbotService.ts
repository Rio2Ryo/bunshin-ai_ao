import { getDb } from "../db";
import { clawdbotConnections, clawdbotMessageLogs, digitalTwins } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * Clawdbot連携サービス
 * ClawdbotのOpenAI互換APIを通じて分身AIと連携
 */

// Clawdbot接続設定の型
export interface ClawdbotConnectionSettings {
  enableMemorySync: boolean;
  enableSkillAccess: boolean;
  enableChannelBridge: boolean;
  preferredModel: string;
  sessionPersistence: boolean;
}

// デフォルト設定
const DEFAULT_SETTINGS: ClawdbotConnectionSettings = {
  enableMemorySync: true,
  enableSkillAccess: true,
  enableChannelBridge: true,
  preferredModel: "claude-3-5-sonnet",
  sessionPersistence: true,
};

/**
 * Clawdbot接続を作成
 */
export async function createClawdbotConnection(
  userId: number,
  twinId: number,
  gatewayUrl: string,
  authToken?: string,
  agentId: string = "main",
  settings: Partial<ClawdbotConnectionSettings> = {}
) {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  const fullSettings = { ...DEFAULT_SETTINGS, ...settings };
  
  const [result] = await db.insert(clawdbotConnections).values({
    userId,
    twinId,
    gatewayUrl,
    authToken,
    agentId,
    status: "pending",
    settings: fullSettings,
  });
  
  return result.insertId;
}

/**
 * Clawdbot接続を取得
 */
export async function getClawdbotConnection(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  const [connection] = await db
    .select()
    .from(clawdbotConnections)
    .where(eq(clawdbotConnections.userId, userId))
    .limit(1);
  
  return connection || null;
}

/**
 * Clawdbot接続を更新
 */
export async function updateClawdbotConnection(
  userId: number,
  updates: {
    gatewayUrl?: string;
    authToken?: string;
    agentId?: string;
    status?: "pending" | "testing" | "active" | "error" | "disconnected";
    settings?: Partial<ClawdbotConnectionSettings>;
    lastError?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  
  const existing = await getClawdbotConnection(userId);
  if (!existing) {
    throw new Error("Clawdbot connection not found");
  }
  
  const updateData: Record<string, unknown> = {};
  
  if (updates.gatewayUrl) updateData.gatewayUrl = updates.gatewayUrl;
  if (updates.authToken !== undefined) updateData.authToken = updates.authToken;
  if (updates.agentId) updateData.agentId = updates.agentId;
  if (updates.status) updateData.status = updates.status;
  if (updates.lastError !== undefined) updateData.lastError = updates.lastError;
  
  if (updates.settings) {
    const currentSettings = existing.settings as ClawdbotConnectionSettings || DEFAULT_SETTINGS;
    updateData.settings = { ...currentSettings, ...updates.settings };
  }
  
  await db
    .update(clawdbotConnections)
    .set(updateData)
    .where(eq(clawdbotConnections.userId, userId));
  
  return true;
}

/**
 * Clawdbot接続をテスト
 */
export async function testClawdbotConnection(userId: number): Promise<{
  success: boolean;
  message: string;
  responseTimeMs?: number;
}> {
  const db = await getDb();
  if (!db) return { success: false, message: "Database not initialized" };
  
  const connection = await getClawdbotConnection(userId);
  if (!connection) {
    return { success: false, message: "接続設定が見つかりません" };
  }
  
  // ステータスをtestingに更新
  await updateClawdbotConnection(userId, { status: "testing" });
  
  const startTime = Date.now();
  
  try {
    // Clawdbot Gateway APIにテストリクエストを送信
    const response = await fetch(`${connection.gatewayUrl}/v1/models`, {
      method: "GET",
      headers: {
        "Authorization": connection.authToken ? `Bearer ${connection.authToken}` : "",
        "Content-Type": "application/json",
      },
    });
    
    const responseTimeMs = Date.now() - startTime;
    
    if (response.ok) {
      const data: any = await response.json();
      
      // 接続成功
      await db
        .update(clawdbotConnections)
        .set({
          status: "active",
          lastConnectionTest: new Date(),
          lastError: null,
        })
        .where(eq(clawdbotConnections.userId, userId));
      
      return {
        success: true,
        message: `接続成功！利用可能なモデル: ${data.data?.length || 0}個`,
        responseTimeMs,
      };
    } else {
      const errorText = await response.text();
      
      await db
        .update(clawdbotConnections)
        .set({
          status: "error",
          lastConnectionTest: new Date(),
          lastError: `HTTP ${response.status}: ${errorText}`,
        })
        .where(eq(clawdbotConnections.userId, userId));
      
      return {
        success: false,
        message: `接続エラー: HTTP ${response.status}`,
        responseTimeMs,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    await db
      .update(clawdbotConnections)
      .set({
        status: "error",
        lastConnectionTest: new Date(),
        lastError: errorMessage,
      })
      .where(eq(clawdbotConnections.userId, userId));
    
    return {
      success: false,
      message: `接続エラー: ${errorMessage}`,
    };
  }
}

/**
 * Clawdbot経由でメッセージを送信
 */
export async function sendMessageViaClawdbot(
  userId: number,
  message: string,
  sessionKey?: string
): Promise<{
  success: boolean;
  response?: string;
  sessionKey?: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not initialized" };
  
  const connection = await getClawdbotConnection(userId);
  if (!connection) {
    return { success: false, error: "Clawdbot接続が設定されていません" };
  }
  
  if (connection.status !== "active") {
    return { success: false, error: "Clawdbot接続がアクティブではありません" };
  }
  
  // ユーザーの分身AI情報を取得
  const [twin] = await db
    .select()
    .from(digitalTwins)
    .where(eq(digitalTwins.userId, userId))
    .limit(1);
  
  const settings = connection.settings as ClawdbotConnectionSettings;
  
  // 送信ログを記録
  const [sendLog] = await db.insert(clawdbotMessageLogs).values({
    connectionId: connection.id,
    userId,
    twinId: connection.twinId,
    direction: "to_clawdbot",
    content: message,
    clawdbotSessionKey: sessionKey,
    status: "pending",
  });
  
  const startTime = Date.now();
  
  try {
    // Clawdbot OpenAI互換APIにリクエスト
    const response = await fetch(`${connection.gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": connection.authToken ? `Bearer ${connection.authToken}` : "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.preferredModel || "claude-3-5-sonnet",
        messages: [
          {
            role: "system",
            content: twin?.systemPrompt || "あなたは親切なアシスタントです。",
          },
          {
            role: "user",
            content: message,
          },
        ],
        // Clawdbot固有のオプション
        ...(sessionKey && { session_key: sessionKey }),
        ...(settings.sessionPersistence && { persist_session: true }),
      }),
    });
    
    const responseTimeMs = Date.now() - startTime;
    
    if (response.ok) {
      const data: any = await response.json();
      const assistantMessage = data.choices?.[0]?.message?.content || "";
      const newSessionKey = data.session_key || sessionKey;
      
      // 送信ログを更新
      await db
        .update(clawdbotMessageLogs)
        .set({
          status: "sent",
          responseTimeMs,
        })
        .where(eq(clawdbotMessageLogs.id, sendLog.insertId));
      
      // 受信ログを記録
      await db.insert(clawdbotMessageLogs).values({
        connectionId: connection.id,
        userId,
        twinId: connection.twinId,
        direction: "from_clawdbot",
        content: assistantMessage,
        clawdbotSessionKey: newSessionKey,
        status: "received",
        responseTimeMs,
      });
      
      // 接続統計を更新
      await db
        .update(clawdbotConnections)
        .set({
          totalMessages: connection.totalMessages + 1,
          lastMessageAt: new Date(),
        })
        .where(eq(clawdbotConnections.id, connection.id));
      
      return {
        success: true,
        response: assistantMessage,
        sessionKey: newSessionKey,
      };
    } else {
      const errorText = await response.text();
      
      await db
        .update(clawdbotMessageLogs)
        .set({
          status: "error",
          errorMessage: `HTTP ${response.status}: ${errorText}`,
          responseTimeMs,
        })
        .where(eq(clawdbotMessageLogs.id, sendLog.insertId));
      
      return {
        success: false,
        error: `Clawdbotエラー: HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    await db
      .update(clawdbotMessageLogs)
      .set({
        status: "error",
        errorMessage,
      })
      .where(eq(clawdbotMessageLogs.id, sendLog.insertId));
    
    return {
      success: false,
      error: `Clawdbotエラー: ${errorMessage}`,
    };
  }
}

/**
 * Clawdbotメッセージ履歴を取得
 */
export async function getClawdbotMessageHistory(
  userId: number,
  limit: number = 50
) {
  const db = await getDb();
  if (!db) return [];
  
  const connection = await getClawdbotConnection(userId);
  if (!connection) {
    return [];
  }
  
  const messages = await db
    .select()
    .from(clawdbotMessageLogs)
    .where(eq(clawdbotMessageLogs.connectionId, connection.id))
    .orderBy(desc(clawdbotMessageLogs.createdAt))
    .limit(limit);
  
  return messages.reverse();
}

/**
 * Clawdbot接続を削除
 */
export async function deleteClawdbotConnection(userId: number) {
  const db = await getDb();
  if (!db) return false;
  
  const connection = await getClawdbotConnection(userId);
  if (!connection) {
    return false;
  }
  
  // メッセージログを削除
  await db
    .delete(clawdbotMessageLogs)
    .where(eq(clawdbotMessageLogs.connectionId, connection.id));
  
  // 接続を削除
  await db
    .delete(clawdbotConnections)
    .where(eq(clawdbotConnections.userId, userId));
  
  return true;
}

/**
 * Clawdbotの利用可能なモデル一覧を取得
 */
export async function getClawdbotModels(userId: number): Promise<{
  success: boolean;
  models?: string[];
  error?: string;
}> {
  const connection = await getClawdbotConnection(userId);
  if (!connection) {
    return { success: false, error: "Clawdbot接続が設定されていません" };
  }
  
  try {
    const response = await fetch(`${connection.gatewayUrl}/v1/models`, {
      method: "GET",
      headers: {
        "Authorization": connection.authToken ? `Bearer ${connection.authToken}` : "",
        "Content-Type": "application/json",
      },
    });
    
    if (response.ok) {
      const data: any = await response.json();
      const models = data.data?.map((m: { id: string }) => m.id) || [];
      return { success: true, models };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
}
