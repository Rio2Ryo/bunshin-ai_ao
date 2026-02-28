/**
 * LINE双方向ボット機能
 * - tRPC lineRouter: LINE連携管理エンドポイント
 * - Webhook event handler: follow/unfollow/message イベント処理
 * - Helper functions: LINE API呼び出し、Clawdbot連携、署名検証
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Env } from "../trpc";
import { ensureSchema, parseJson, toJson, now, getMyTwin } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

// ============ LINE API Helpers ============

/** Verify LINE webhook signature using HMAC-SHA256 */
export async function verifyLineSignature(
  body: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const expected = btoa(
    String.fromCharCode.apply(null, Array.from(new Uint8Array(sig)))
  );
  return expected === signature;
}

/** Reply to LINE via Messaging API (replyToken) */
export async function replyToLine(
  replyToken: string,
  messages: any[],
  accessToken: string
) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

/** Push message to LINE user (proactive, no replyToken needed) */
export async function pushToLine(
  to: string,
  messages: any[],
  accessToken: string
): Promise<boolean> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to, messages }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch LINE user profile */
export async function getLineUserProfile(
  userId: string,
  accessToken: string
): Promise<{
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
} | null> {
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/profile/${userId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    return (await res.json()) as any;
  } catch {
    return null;
  }
}

// ============ Clawdbot Integration ============

/** Send messages to Clawdbot gateway (DB settings > ENV fallback) */
async function sendToClawdbotGateway(
  messages: { role: string; content: string }[],
  opts: {
    gatewayUrl: string;
    authToken: string;
    agentId?: string;
    sessionKey?: string;
  }
): Promise<{
  success: boolean;
  response?: string;
  model?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${opts.gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.authToken}`,
        "x-clawdbot-agent-id": opts.agentId || "main",
        "ngrok-skip-browser-warning": "true",
        ...(opts.sessionKey
          ? { "x-clawdbot-session-key": opts.sessionKey }
          : {}),
      },
      body: JSON.stringify({ model: "clawdbot", messages, stream: false }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    return {
      success: true,
      response: data.choices?.[0]?.message?.content || "",
      model: data.model || "clawdbot",
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Detect image generation requests in Japanese/English */
function detectImageRequest(msg: string): boolean {
  return (
    /(画像|絵|イラスト|写真|アート)を?(作って|描いて|生成して|作成して|見せて)/i.test(
      msg
    ) ||
    /(generate|create|draw|make).*(image|picture|illustration|art|photo)/i.test(
      msg
    )
  );
}

/** Parse Clawdbot response: extract text and image URLs */
function parseClawdbotResp(raw: string): {
  text: string;
  images: string[];
} {
  const images: string[] = [];
  const imgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(raw)) !== null) images.push(m[1]);
  const text = raw
    .replace(/!\[.*?\]\(https?:\/\/[^\s)]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, images };
}

// ============ System Prompt Builder ============

function buildLineSystemPrompt(twin: {
  name?: string;
  personality?: string;
  description?: string;
  systemPrompt?: string;
  learnedTraits?: string;
}, knowledgeEntries: { title: string; content?: string; summary?: string }[] = [], isImageReq = false): string {
  const parts: string[] = [
    `あなたは「${twin.name || "分身AI"}」という名前の分身AIです。`,
    "ユーザーの代わりに会話し、ユーザーの人格・価値観・話し方を再現してください。",
  ];

  if (twin.personality) parts.push(`\n【性格・人格】\n${twin.personality}`);
  if (twin.description) parts.push(`\n【説明】\n${twin.description}`);

  // Include learned traits if available
  if (twin.learnedTraits) {
    try {
      const traits =
        typeof twin.learnedTraits === "string"
          ? JSON.parse(twin.learnedTraits)
          : twin.learnedTraits;
      if (traits.likes?.length > 0)
        parts.push(`\n【好きなこと】\n${traits.likes.join("、")}`);
      if (traits.dislikes?.length > 0)
        parts.push(`\n【嫌いなこと】\n${traits.dislikes.join("、")}`);
      if (traits.values?.length > 0)
        parts.push(`\n【大切にしていること】\n${traits.values.join("、")}`);
      if (traits.catchphrases?.length > 0)
        parts.push(
          `\n【口癖・よく使う表現】\n${traits.catchphrases.join("、")}`
        );
    } catch {
      /* ignore parse errors */
    }
  }

  // Include knowledge base entries
  if (knowledgeEntries.length > 0) {
    parts.push("\n【ナレッジベース】");
    for (const entry of knowledgeEntries) {
      const body = (entry.summary || entry.content || "").substring(0, 300);
      parts.push(`- ${entry.title}: ${body}`);
    }
  }

  parts.push(
    "\nLINEでの会話なので、簡潔で親しみやすい返答を心がけてください。1-3文程度で返答してください。"
  );

  if (isImageReq) {
    parts.push(
      "\n【画像生成の指示】\n画像生成を求められたら、execツールで画像生成スクリプトを実行し、アップロード後にMarkdown形式 ![image](url) で出力してください。"
    );
  }

  return parts.join("\n");
}

// ============ Webhook Event Handler ============

/**
 * Handle all LINE webhook events.
 * Called from the Hono POST /api/line/webhook route.
 */
export async function handleLineWebhook(
  env: Env,
  body: string,
  signature: string
): Promise<{ success: boolean; error?: string }> {
  const channelSecret = env.LINE_CHANNEL_SECRET;
  const accessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !accessToken) {
    return { success: false, error: "LINE not configured" };
  }

  // Verify signature
  const valid = await verifyLineSignature(body, signature, channelSecret);
  if (!valid) return { success: false, error: "Invalid signature" };

  let webhook: any;
  try {
    webhook = JSON.parse(body);
  } catch {
    return { success: false, error: "Invalid JSON" };
  }

  const db = env.DB;
  await ensureSchema(db);

  for (const event of webhook.events || []) {
    try {
      switch (event.type) {
        case "follow":
          await handleFollowEvent(db, env, event, accessToken);
          break;
        case "unfollow":
          await handleUnfollowEvent(db, event);
          break;
        case "message":
          if (event.source?.type === "group") {
            await handleGroupMessage(db, event);
          } else {
            await handleMessageEvent(db, env, event, accessToken);
          }
          break;
        case "join":
          await handleJoinEvent(event, accessToken);
          break;
        default:
          console.log("[LINE] Unhandled event type:", event.type);
      }
    } catch (eventError: any) {
      console.error(
        "[LINE] Event error:",
        eventError?.message || eventError
      );
    }
  }

  return { success: true };
}

/** Handle follow event: create connection + send welcome with link code */
async function handleFollowEvent(
  db: D1Database,
  env: Env,
  event: any,
  accessToken: string
) {
  const lineUserId = event.source?.userId;
  if (!lineUserId || !event.replyToken) return;

  // Fetch LINE user profile
  const profile = await getLineUserProfile(lineUserId, accessToken);

  // Generate link code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const codeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const existing = await db
    .prepare(`SELECT id FROM line_connections WHERE lineUserId=?`)
    .bind(lineUserId)
    .first<any>();
  if (existing) {
    await db
      .prepare(
        `UPDATE line_connections SET lineDisplayName=?, linePictureUrl=?, status='pending', settings=json_set(COALESCE(settings,'{}'),'$.linkCode',?,'$.linkCodeExpiry',?), updatedAt=datetime('now') WHERE id=?`
      )
      .bind(
        profile?.displayName || "",
        profile?.pictureUrl || null,
        code,
        codeExpiry,
        existing.id
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO line_connections (lineUserId, lineDisplayName, linePictureUrl, status, settings) VALUES (?,?,?,?,?)`
      )
      .bind(
        lineUserId,
        profile?.displayName || "",
        profile?.pictureUrl || null,
        "pending",
        toJson({ linkCode: code, linkCodeExpiry: codeExpiry })
      )
      .run();
  }

  const frontendUrl = env.FRONTEND_URL || "https://bunshin-ai.pages.dev";
  await replyToLine(
    event.replyToken,
    [
      {
        type: "text",
        text: `友だち追加ありがとうございます！\n\n分身AIとLINEを連携するには、以下の連携コードをWebアプリで入力してください。\n\n📱 連携コード: ${code}\n\n※有効期限: 10分\n※Webアプリ: ${frontendUrl}/line-link`,
      },
    ],
    accessToken
  );
}

/** Handle unfollow event: disconnect LINE connection */
async function handleUnfollowEvent(db: D1Database, event: any) {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;
  await db
    .prepare(
      `UPDATE line_connections SET status='disconnected', disconnectedAt=datetime('now'), updatedAt=datetime('now') WHERE lineUserId=?`
    )
    .bind(lineUserId)
    .run();
}

/** Handle group join event */
async function handleJoinEvent(event: any, accessToken: string) {
  if (!event.replyToken) return;
  await replyToLine(
    event.replyToken,
    [
      {
        type: "text",
        text: "分身AIボットがグループに参加しました！🤖\n\nグループ内の会話を観察して、メンバーの分身AIの人格学習に活用します。\n\n※プライバシーに配慮し、学習データは各ユーザーの分身AIのみに使用されます。",
      },
    ],
    accessToken
  );
}

/** Handle group message: observe and save for learning (no reply) */
async function handleGroupMessage(db: D1Database, event: any) {
  const groupId = event.source?.groupId;
  const lineUserId = event.source?.userId;
  if (
    !groupId ||
    !lineUserId ||
    !event.message ||
    event.message.type !== "text"
  )
    return;

  const messageText = event.message.text;
  if (!messageText) return;

  // Check if sender is a linked user
  const conn = await db
    .prepare(
      `SELECT userId, twinId FROM line_connections WHERE lineUserId=? AND status='active' AND userId IS NOT NULL`
    )
    .bind(lineUserId)
    .first<any>();
  if (!conn) return;

  // Save as knowledge base entry for conversation learning
  const twin = await getMyTwin(db, conn.userId);
  if (twin) {
    await db
      .prepare(
        `INSERT INTO knowledge_base (twinId, sourceType, sourceId, title, content, summary) VALUES (?,?,?,?,?,?)`
      )
      .bind(
        twin.id,
        "line_group",
        `line_group_${groupId}_${Date.now()}`,
        `LINEグループ会話`,
        messageText,
        messageText.substring(0, 200)
      )
      .run();
  }
}

/** Handle 1:1 text message: generate twin response via Clawdbot/LLM */
async function handleMessageEvent(
  db: D1Database,
  env: Env,
  event: any,
  accessToken: string
) {
  if (
    event.message?.type !== "text" ||
    !event.replyToken
  )
    return;

  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  const userMessage = event.message.text || "";

  // Find connected user with twin data
  const conn = await db
    .prepare(
      `SELECT lc.id as connId, lc.userId, lc.status, lc.totalMessages,
              dt.id as twinId, dt.name as twinName, dt.personality, dt.description, dt.systemPrompt, dt.learnedTraits
       FROM line_connections lc
       LEFT JOIN digital_twins dt ON dt.userId = lc.userId
       WHERE lc.lineUserId=? AND lc.status='active' AND lc.userId IS NOT NULL`
    )
    .bind(lineUserId)
    .first<any>();

  if (!conn) {
    // Not linked yet — generate a new link code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const codeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const existing = await db
      .prepare(`SELECT id FROM line_connections WHERE lineUserId=?`)
      .bind(lineUserId)
      .first<any>();
    if (existing) {
      await db
        .prepare(
          `UPDATE line_connections SET settings=json_set(COALESCE(settings,'{}'),'$.linkCode',?,'$.linkCodeExpiry',?), updatedAt=datetime('now') WHERE id=?`
        )
        .bind(code, codeExpiry, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO line_connections (lineUserId, status, settings) VALUES (?,?,?)`
        )
        .bind(
          lineUserId,
          "pending",
          toJson({ linkCode: code, linkCodeExpiry: codeExpiry })
        )
        .run();
    }
    await replyToLine(
      event.replyToken,
      [
        {
          type: "text",
          text: `まだLINE連携が完了していません。\n\nWebアプリで以下の連携コードを入力してください。\n\n📱 連携コード: ${code}\n\n※有効期限: 10分`,
        },
      ],
      accessToken
    );
    return;
  }

  if (!conn.twinId) {
    await replyToLine(
      event.replyToken,
      [
        {
          type: "text",
          text: "分身AIが見つかりません。Webアプリで分身AIを作成してください。",
        },
      ],
      accessToken
    );
    return;
  }

  // Fetch knowledge base entries for richer context
  const kbRows = await db
    .prepare(
      `SELECT title, content, summary FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 5`
    )
    .bind(conn.twinId)
    .all<any>();
  const knowledgeEntries = kbRows.results ?? [];

  // Build system prompt
  const isImageReq = detectImageRequest(userMessage);
  const systemPrompt = buildLineSystemPrompt(
    {
      name: conn.twinName,
      personality: conn.personality,
      description: conn.description,
      systemPrompt: conn.systemPrompt,
      learnedTraits: conn.learnedTraits,
    },
    knowledgeEntries,
    isImageReq
  );

  // Get recent conversation history from LINE chat session
  const lineSessionRow = await db
    .prepare(
      `SELECT id FROM chat_sessions WHERE userId=? AND twinId=? AND title='LINE会話' LIMIT 1`
    )
    .bind(conn.userId, conn.twinId)
    .first<any>();

  let conversationHistory: {
    role: "user" | "assistant" | "system";
    content: string;
  }[] = [];
  if (lineSessionRow) {
    const msgs = await db
      .prepare(
        `SELECT role, content FROM chat_messages WHERE sessionId=? ORDER BY id DESC LIMIT 10`
      )
      .bind(lineSessionRow.id)
      .all<any>();
    conversationHistory = (msgs.results || [])
      .reverse()
      .map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));
  }

  const allMessages = [
    { role: "system" as const, content: systemPrompt },
    ...conversationHistory,
    { role: "user" as const, content: userMessage },
  ];

  // === Try Clawdbot first, then LLM fallback ===
  const clawdbotConn = await db
    .prepare(
      `SELECT gatewayUrl, authToken, agentId FROM clawdbot_connections WHERE userId=?`
    )
    .bind(conn.userId)
    .first<any>();

  const gatewayUrl =
    clawdbotConn?.gatewayUrl || env.CLAWDBOT_GATEWAY_URL || "";
  const authToken =
    clawdbotConn?.authToken || env.CLAWDBOT_AUTH_TOKEN || "";
  const agentId =
    clawdbotConn?.agentId || env.CLAWDBOT_AGENT_ID || "main";
  const clawdbotSource = clawdbotConn?.gatewayUrl
    ? "db"
    : env.CLAWDBOT_GATEWAY_URL
      ? "env"
      : "none";

  let responseText = "";
  let responseModel = "unknown";
  let apiSource = "none";
  let responseImages: string[] = [];
  const startTime = Date.now();

  if (gatewayUrl && authToken) {
    const result = await sendToClawdbotGateway(allMessages, {
      gatewayUrl,
      authToken,
      agentId,
      sessionKey: `line_${lineUserId}`,
    });
    if (result.success && result.response) {
      const parsed = parseClawdbotResp(result.response);
      responseText = parsed.text;
      responseImages = parsed.images;
      responseModel = result.model || "clawdbot";
      apiSource = `clawdbot(${clawdbotSource})`;
    }
  }

  // Fallback to LLM
  if (!responseText) {
    const llmConfig = await getUserLLMConfig(db, conn.userId, "chat", env);
    if (llmConfig) {
      try {
        const result = await invokeLLM(llmConfig, allMessages, {
          maxTokens: 512,
          temperature: 0.8,
        });
        if (result.content) {
          responseText = result.content;
          responseModel = result.model || "llm-fallback";
          apiSource = "llm-fallback";
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!responseText)
    responseText = "申し訳ありません、応答を生成できませんでした。";

  const elapsed = Date.now() - startTime;

  // Save conversation to chat_sessions / chat_messages
  let sessionId = lineSessionRow?.id;
  if (!sessionId) {
    await db
      .prepare(
        `INSERT INTO chat_sessions (userId, twinId, title, mode) VALUES (?,?,?,?)`
      )
      .bind(conn.userId, conn.twinId, "LINE会話", "casual")
      .run();
    const newSession = await db
      .prepare(
        `SELECT id FROM chat_sessions WHERE userId=? AND twinId=? AND title='LINE会話' ORDER BY id DESC LIMIT 1`
      )
      .bind(conn.userId, conn.twinId)
      .first<any>();
    sessionId = newSession?.id;
  }
  if (sessionId) {
    await db
      .prepare(
        `INSERT INTO chat_messages (sessionId, userId, twinId, role, content) VALUES (?,?,?,?,?)`
      )
      .bind(sessionId, conn.userId, conn.twinId, "user", userMessage)
      .run();
    await db
      .prepare(
        `INSERT INTO chat_messages (sessionId, userId, twinId, role, content) VALUES (?,?,?,?,?)`
      )
      .bind(sessionId, conn.userId, conn.twinId, "assistant", responseText)
      .run();
  }

  // Update message count on line_connections
  await db
    .prepare(
      `UPDATE line_connections SET totalMessages=totalMessages+1, lastMessageAt=datetime('now'), updatedAt=datetime('now') WHERE id=?`
    )
    .bind(conn.connId)
    .run();

  // Award growth experience for LINE conversation
  try {
    const growthStatus = await db
      .prepare(`SELECT id, totalExperience FROM twin_growth_status WHERE twinId=?`)
      .bind(conn.twinId)
      .first<any>();
    if (growthStatus) {
      const newExp = (growthStatus.totalExperience || 0) + 5;
      const newLevel = Math.floor(newExp / 100) + 1;
      await db
        .prepare(
          `UPDATE twin_growth_status SET totalExperience=?, level=?, lastInteraction=datetime('now'), updatedAt=datetime('now') WHERE id=?`
        )
        .bind(newExp, newLevel, growthStatus.id)
        .run();
    }
  } catch {
    /* growth update failure is non-critical */
  }

  // Build LINE reply messages
  const lineMessages: any[] = [];
  if (responseText) lineMessages.push({ type: "text", text: responseText });
  for (const imgUrl of responseImages.slice(0, 3)) {
    if (/^https:\/\/.+\.(png|jpg|jpeg|gif|webp)/i.test(imgUrl)) {
      lineMessages.push({
        type: "image",
        originalContentUrl: imgUrl,
        previewImageUrl: imgUrl,
      });
    }
  }
  if (lineMessages.length === 0) {
    lineMessages.push({
      type: "text",
      text: "応答を生成できませんでした。",
    });
  }

  // Debug mode
  if (env.LINE_DEBUG_MODE === "true") {
    lineMessages.push({
      type: "text",
      text: `🔧 Debug:\n• AI: ${responseModel}\n• ソース: ${apiSource}\n• Clawdbot設定: ${clawdbotSource}\n• 応答時間: ${elapsed}ms\n• 画像: ${responseImages.length}件`,
    });
  }

  await replyToLine(event.replyToken, lineMessages.slice(0, 5), accessToken);
}

// ============ tRPC LINE Router ============

export const lineRouter = router({
  /** Get current user's LINE connection */
  getConnection: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB
      .prepare(`SELECT * FROM line_connections WHERE userId=?`)
      .bind(ctx.userId)
      .first<any>();
    if (!row) return null;
    return { ...row, settings: parseJson<any>(row.settings) };
  }),

  /** Link LINE account by code (with expiry validation) */
  linkByCode: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB
        .prepare(
          `SELECT * FROM line_connections WHERE json_extract(settings, '$.linkCode')=?`
        )
        .bind(input.code.toUpperCase())
        .first<any>();
      if (!conn)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "連携コードが見つかりません",
        });

      // Check expiry
      const settings = parseJson<any>(conn.settings);
      if (settings?.linkCodeExpiry) {
        const expiry = new Date(settings.linkCodeExpiry);
        if (expiry < new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "連携コードの有効期限が切れています。LINEで再度メッセージを送信してください。",
          });
        }
      }

      // Check status
      if (conn.status === "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "このコードは既に使用されています",
        });
      }

      // Get user's twin
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);

      // Link: set userId, twinId, clear linkCode
      const cleanSettings = {
        receiveHeartbeat: settings?.receiveHeartbeat ?? true,
        receiveNotifications: settings?.receiveNotifications ?? true,
        allowVoiceMessages: settings?.allowVoiceMessages ?? true,
        language: settings?.language ?? "ja",
      };
      await ctx.env.DB
        .prepare(
          `UPDATE line_connections SET userId=?, twinId=?, status='active', connectedAt=datetime('now'), settings=?, updatedAt=datetime('now') WHERE id=?`
        )
        .bind(
          ctx.userId,
          twin?.id ?? null,
          toJson(cleanSettings),
          conn.id
        )
        .run();

      return { success: true };
    }),

  /** Disconnect LINE */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    await ctx.env.DB
      .prepare(
        `UPDATE line_connections SET status='disconnected', disconnectedAt=datetime('now'), updatedAt=datetime('now') WHERE userId=?`
      )
      .bind(ctx.userId)
      .run();
    return { success: true };
  }),

  /** Update LINE connection settings */
  updateSettings: protectedProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB
        .prepare(`SELECT settings FROM line_connections WHERE userId=?`)
        .bind(ctx.userId)
        .first<any>();
      const existing = conn ? parseJson<any>(conn.settings) ?? {} : {};
      const merged = { ...existing, ...input };
      await ctx.env.DB
        .prepare(
          `UPDATE line_connections SET settings=?, updatedAt=datetime('now') WHERE userId=?`
        )
        .bind(toJson(merged), ctx.userId)
        .run();
      return { success: true };
    }),

  /** Toggle LINE connection active/paused */
  toggleStatus: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const conn = await ctx.env.DB
        .prepare(`SELECT status FROM line_connections WHERE userId=?`)
        .bind(ctx.userId)
        .first<any>();
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
      const newStatus = conn.status === "active" ? "paused" : "active";
      await ctx.env.DB
        .prepare(
          `UPDATE line_connections SET status=?, updatedAt=datetime('now') WHERE userId=?`
        )
        .bind(newStatus, ctx.userId)
        .run();
      return { success: true, status: newStatus };
    }),

  /** Get LINE message history (from chat_sessions + chat_messages) */
  getMessageHistory: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) return [];

      // Find LINE chat session
      const session = await ctx.env.DB
        .prepare(
          `SELECT id FROM chat_sessions WHERE userId=? AND twinId=? AND title='LINE会話' LIMIT 1`
        )
        .bind(ctx.userId, twin.id)
        .first<any>();
      if (!session) return [];

      const limit = input?.limit ?? 50;
      const msgs = await ctx.env.DB
        .prepare(
          `SELECT id, role, content, createdAt FROM chat_messages WHERE sessionId=? ORDER BY id DESC LIMIT ?`
        )
        .bind(session.id, limit)
        .all<any>();
      return (msgs.results ?? []).reverse();
    }),

  /** Send a push message to the user's linked LINE account */
  sendMessage: protectedProcedure
    .input(z.object({ message: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const accessToken = ctx.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!accessToken)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "LINE APIが設定されていません",
        });

      const conn = await ctx.env.DB
        .prepare(
          `SELECT lineUserId, status FROM line_connections WHERE userId=? AND status='active'`
        )
        .bind(ctx.userId)
        .first<any>();
      if (!conn)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "有効なLINE連携がありません",
        });

      const success = await pushToLine(
        conn.lineUserId,
        [{ type: "text", text: input.message }],
        accessToken
      );

      if (!success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "LINEへのメッセージ送信に失敗しました",
        });
      }

      // Save to chat session
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (twin) {
        let session = await ctx.env.DB
          .prepare(
            `SELECT id FROM chat_sessions WHERE userId=? AND twinId=? AND title='LINE会話' LIMIT 1`
          )
          .bind(ctx.userId, twin.id)
          .first<any>();
        if (!session) {
          await ctx.env.DB
            .prepare(
              `INSERT INTO chat_sessions (userId, twinId, title, mode) VALUES (?,?,?,?)`
            )
            .bind(ctx.userId, twin.id, "LINE会話", "casual")
            .run();
          session = await ctx.env.DB
            .prepare(
              `SELECT id FROM chat_sessions WHERE userId=? AND twinId=? AND title='LINE会話' ORDER BY id DESC LIMIT 1`
            )
            .bind(ctx.userId, twin.id)
            .first<any>();
        }
        if (session) {
          await ctx.env.DB
            .prepare(
              `INSERT INTO chat_messages (sessionId, userId, twinId, role, content) VALUES (?,?,?,?,?)`
            )
            .bind(session.id, ctx.userId, twin.id, "user", `[Push] ${input.message}`)
            .run();
        }
      }

      return { success: true };
    }),

  /** Get LINE user profile info for the connected account */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const accessToken = ctx.env.LINE_CHANNEL_ACCESS_TOKEN;
    const conn = await ctx.env.DB
      .prepare(
        `SELECT lineUserId, lineDisplayName, linePictureUrl, status, totalMessages, lastMessageAt, connectedAt FROM line_connections WHERE userId=?`
      )
      .bind(ctx.userId)
      .first<any>();
    if (!conn) return null;

    // Try to fetch fresh profile from LINE API if connected
    let freshProfile = null;
    if (conn.status === "active" && accessToken && conn.lineUserId) {
      freshProfile = await getLineUserProfile(conn.lineUserId, accessToken);
      // Update stored display name/picture if changed
      if (freshProfile) {
        const nameChanged = freshProfile.displayName !== conn.lineDisplayName;
        const picChanged = freshProfile.pictureUrl !== conn.linePictureUrl;
        if (nameChanged || picChanged) {
          await ctx.env.DB
            .prepare(
              `UPDATE line_connections SET lineDisplayName=?, linePictureUrl=?, updatedAt=datetime('now') WHERE userId=?`
            )
            .bind(
              freshProfile.displayName || conn.lineDisplayName,
              freshProfile.pictureUrl || conn.linePictureUrl,
              ctx.userId
            )
            .run();
        }
      }
    }

    return {
      lineUserId: conn.lineUserId,
      displayName: freshProfile?.displayName || conn.lineDisplayName,
      pictureUrl: freshProfile?.pictureUrl || conn.linePictureUrl,
      statusMessage: freshProfile?.statusMessage || null,
      status: conn.status,
      totalMessages: conn.totalMessages,
      lastMessageAt: conn.lastMessageAt,
      connectedAt: conn.connectedAt,
    };
  }),
});
