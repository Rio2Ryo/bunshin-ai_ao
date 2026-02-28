import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  router,
  publicProcedure,
  verifySessionToken,
  parseCookie,
  COOKIE_NAME,
  ONE_YEAR_MS,
  escapeHtml,
  type Env,
  type Context,
} from "./trpc";
import { ensureSchema, toJson } from "./db-helpers";
import { invokeLLM, getUserLLMConfig } from "./llm";
import { notifyMatchingComplete } from "./notifications";
import { requestLogger } from "./middleware";

// ============ Router Imports ============

import { authRouter } from "./routers/auth";
import { profileRouter } from "./routers/profile";
import { twinsRouter } from "./routers/twins";
import { friendsRouter } from "./routers/friends";
import { knowledgeRouter, filesRouter } from "./routers/knowledge";
import { aiConfigRouter, orchestrationRouter } from "./routers/ai-config";
import { chatRouter } from "./routers/chat";
import { matchingRouter } from "./routers/matching";
import { pointsRouter } from "./routers/points";
import { questsRouter, growthRouter } from "./routers/quests";
import { cardsRouter } from "./routers/cards";
import { clawdbotRouter } from "./routers/integrations";
import { lineRouter, handleLineWebhook } from "./routers/line";
import { planRouter, stripeRouter } from "./routers/plan";
import { discoverRouter, userRouter } from "./routers/discover";
import { aiProviderRouter, adminAiProviderRouter } from "./routers/ai-provider";
import { analyticsRouter, trustRouter, onboardingRouter } from "./routers/analytics";
import { schedulerRouter } from "./routers/scheduler";
import { adminRouter, reportRouter, marketplaceRouter, notificationRouter } from "./routers/admin";
import { blocksRouter } from "./routers/blocks";

// ============ Composed tRPC Router ============

const appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ ok: true })),
  }),
  auth: authRouter,
  profile: profileRouter,
  myTwin: twinsRouter,
  friends: friendsRouter,
  knowledge: knowledgeRouter,
  files: filesRouter,
  aiConfig: aiConfigRouter,
  orchestration: orchestrationRouter,
  chat: chatRouter,
  matching: matchingRouter,
  points: pointsRouter,
  quests: questsRouter,
  growth: growthRouter,
  cards: cardsRouter,
  clawdbot: clawdbotRouter,
  line: lineRouter,
  plan: planRouter,
  stripe: stripeRouter,
  discover: discoverRouter,
  user: userRouter,
  aiProvider: aiProviderRouter,
  adminAiProvider: adminAiProviderRouter,
  analytics: analyticsRouter,
  trust: trustRouter,
  onboarding: onboardingRouter,
  scheduler: schedulerRouter,
  admin: adminRouter,
  report: reportRouter,
  marketplace: marketplaceRouter,
  notification: notificationRouter,
  blocks: blocksRouter,
});

export type AppRouter = typeof appRouter;

// ============ Hono App ============

const api = new Hono<{ Bindings: Env }>();

// Structured request logging (outputs JSON for CF Workers Logs)
api.use("/api/*", requestLogger());

// Allowed origins for CORS (strict whitelist)
const ALLOWED_ORIGINS = new Set([
  "https://bunshin-ai.pages.dev",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function isAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null; // Server-to-server (no CORS needed)
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // Allow Cloudflare Pages preview deployments
  if (origin.endsWith(".bunshin-ai.pages.dev") && origin.startsWith("https://")) return origin;
  return null; // Reject unknown origins
}

api.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const allowed = isAllowedOrigin(origin);
      // Return the origin if allowed; Hono omits Access-Control-Allow-Origin if empty string returned
      return allowed || "";
    },
    allowHeaders: ["content-type", "x-trpc-source"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

// Explicit Vary: Origin for correct caching + CORS per-origin behavior
api.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.append("Vary", "Origin");
});

// Security headers
api.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.res.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  c.res.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://bunshin-ai-api.common-gifted-tokyo.workers.dev https://bunshin-ai.pages.dev; frame-ancestors 'none'");
  if (c.req.url.includes("workers.dev")) {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

// Request counter for monitoring
let requestCountSinceStart = 0;
let errorCountSinceStart = 0;
const startedAt = new Date().toISOString();

api.use("/api/*", async (c, next) => {
  requestCountSinceStart++;
  try {
    await next();
    if (c.res.status >= 500) errorCountSinceStart++;
  } catch (err) {
    errorCountSinceStart++;
    throw err;
  }
});

// Plan-aware rate limiter (user-specific with plan tiers)
const rateLimitMap = new Map<string, { count: number; resetAt: number; limit: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const PLAN_RATE_LIMITS: Record<string, number> = { free: 30, premium: 120, enterprise: 600 };
const DEFAULT_RATE_LIMIT = 10;
let lastCleanup = Date.now();

// Paths excluded from rate limiting (server-to-server webhooks with their own signature verification)
const RATE_LIMIT_EXCLUDED_PATHS = new Set(["/api/stripe/webhook", "/api/line/webhook"]);

api.use("/api/*", async (c, next) => {
  // Skip rate limiting for webhook endpoints (they have their own signature verification)
  const path = new URL(c.req.url).pathname;
  if (RATE_LIMIT_EXCLUDED_PATHS.has(path)) return next();

  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const nowMs = Date.now();
  let key = `ip:${ip}`;
  let resolvedLimit = DEFAULT_RATE_LIMIT;
  try {
    const cookieHeader = c.req.header("cookie") || null;
    const tk = parseCookie(cookieHeader, COOKIE_NAME);
    if (tk) {
      const s = await verifySessionToken(tk, c.env as Env);
      if (s) {
        key = `user:${s.userId}`;
        const existing = rateLimitMap.get(key);
        if (existing && nowMs <= existing.resetAt) {
          resolvedLimit = existing.limit;
        } else {
          const u = await (c.env as Env).DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(s.userId).first<any>();
          resolvedLimit = PLAN_RATE_LIMITS[u?.plan || "free"] || PLAN_RATE_LIMITS.free;
        }
      }
    }
  } catch { /* ignore auth errors in rate limiter */ }
  let entry = rateLimitMap.get(key);
  if (!entry || nowMs > entry.resetAt) {
    entry = { count: 0, resetAt: nowMs + RATE_LIMIT_WINDOW, limit: resolvedLimit };
    rateLimitMap.set(key, entry);
  }
  entry.count++;

  const retryAfterSec = Math.ceil((entry.resetAt - nowMs) / 1000);
  c.res.headers.set("X-RateLimit-Limit", String(entry.limit));
  c.res.headers.set("X-RateLimit-Remaining", String(Math.max(0, entry.limit - entry.count)));
  c.res.headers.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  if (entry.count > entry.limit) {
    c.res.headers.set("Retry-After", String(retryAfterSec));
    return c.json({ error: "Rate limit exceeded. Please try again later.", retryAfter: retryAfterSec }, 429);
  }
  // Periodic cleanup every 30s (avoids memory leaks)
  if (nowMs - lastCleanup > 30_000) {
    lastCleanup = nowMs;
    const keys = Array.from(rateLimitMap.keys());
    for (const k of keys) {
      const v = rateLimitMap.get(k);
      if (v && nowMs > v.resetAt) rateLimitMap.delete(k);
    }
  }
  await next();
});

// Per-endpoint rate limiter helper
function perEndpointRateLimit(prefix: string, maxPerMin: number) {
  return async (c: any, next: any) => {
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
    const key = `${prefix}:${ip}`;
    const nowMs = Date.now();
    let entry = rateLimitMap.get(key);
    if (!entry || nowMs > entry.resetAt) {
      entry = { count: 0, resetAt: nowMs + RATE_LIMIT_WINDOW, limit: maxPerMin };
      rateLimitMap.set(key, entry);
    }
    entry.count++;
    if (entry.count > maxPerMin) {
      const retryAfter = Math.ceil((entry.resetAt - nowMs) / 1000);
      c.res.headers.set("Retry-After", String(retryAfter));
      return c.json({ error: `Rate limit exceeded for ${prefix}. Please try again later.`, retryAfter }, 429);
    }
    await next();
  };
}

// Stricter rate limit for auth endpoints (10 per minute per IP)
api.use("/api/trpc/auth.*", perEndpointRateLimit("auth", 10));
// Extra-strict rate limit for brute-force-sensitive auth endpoints (5 per minute per IP)
api.use("/api/trpc/auth.register*", perEndpointRateLimit("auth_register", 5));
api.use("/api/trpc/auth.login*", perEndpointRateLimit("auth_login", 5));
api.use("/api/trpc/auth.requestPasswordReset*", perEndpointRateLimit("auth_pwreset", 5));
api.use("/api/trpc/auth.resendVerification*", perEndpointRateLimit("auth_resend", 5));

// Stricter rate limit for LLM-heavy endpoints (5 per minute for free tier)
api.use("/api/trpc/chat.sendMessage*", perEndpointRateLimit("chat_send", 15));
api.use("/api/trpc/matching.create*", perEndpointRateLimit("matching_create", 5));
api.use("/api/trpc/matching.runDialogue*", perEndpointRateLimit("matching_dialogue", 5));
api.use("/api/trpc/matching.analyze*", perEndpointRateLimit("matching_analyze", 10));
api.use("/api/trpc/personality.*", perEndpointRateLimit("personality", 5));

api.get("/", (c) => c.json({ message: "Bunshin AI API v2. Use /api/* endpoints." }));
api.get("/api/health", async (c) => {
  const env = c.env as Env;
  const start = Date.now();
  let dbOk = false;
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await env.DB.prepare("SELECT 1").first();
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch { /* DB unreachable */ }
  const totalMs = Date.now() - start;
  return c.json({
    status: "ok",
    ok: dbOk,
    timestamp: new Date().toISOString(),
    version: "2.3.0",
    uptime: "cloudflare-workers",
    checks: {
      database: { ok: dbOk, latencyMs: dbLatencyMs },
      r2Storage: { ok: !!env.ASSETS },
      llm: { ok: !!(env.AZURE_FOUNDRY_API_KEY) },
    },
    responseTimeMs: totalMs,
    requestCount: requestCountSinceStart,
    errorCount: errorCountSinceStart,
    startedAt,
  });
});

api.get("/api/health/detailed", async (c) => {
  const env = c.env as Env;
  await ensureSchema(env.DB);
  // Verify auth - admin only
  const cookieHeader = c.req.header("cookie") || null;
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const sess = await verifySessionToken(token, env);
  if (!sess) return c.json({ error: "Unauthorized" }, 401);
  const user = await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(sess.userId).first<any>();
  if (user?.role !== "admin") return c.json({ error: "Admin only" }, 403);
  const start = Date.now();
  // DB stats
  const userCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE isNpc=0").first<any>();
  const twinCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM digital_twins").first<any>();
  const sessionCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM matching_sessions").first<any>();
  const chatCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM chat_messages").first<any>();
  const notifCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE isRead=0").first<any>();
  // Recent errors (matching sessions with failed status)
  const failedMatchings = await env.DB.prepare("SELECT COUNT(*) as cnt FROM matching_sessions WHERE status='failed'").first<any>();
  // Active users last 24h
  const activeUsers24h = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE lastSignedIn > datetime('now', '-1 day')").first<any>();

  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    version: "2.2.0",
    responseTimeMs: Date.now() - start,
    database: {
      users: userCount?.cnt ?? 0,
      twins: twinCount?.cnt ?? 0,
      matchingSessions: sessionCount?.cnt ?? 0,
      chatMessages: chatCount?.cnt ?? 0,
      unreadNotifications: notifCount?.cnt ?? 0,
      failedMatchings: failedMatchings?.cnt ?? 0,
    },
    activity: {
      activeUsers24h: activeUsers24h?.cnt ?? 0,
    },
    services: {
      database: true,
      r2Storage: !!env.ASSETS,
      llm: !!env.AZURE_FOUNDRY_API_KEY,
      stripe: !!env.STRIPE_SECRET_KEY,
      slack: !!env.SLACK_WEBHOOK_URL,
    },
  });
});

api.get("/api/status", async (c) => {
  const db = (c.env as Env).DB;
  await ensureSchema(db);
  const userCount = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE isNpc=0`).first<any>();
  const npcCount = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE isNpc=1`).first<any>();
  const twinCount = await db.prepare(`SELECT COUNT(*) as cnt FROM digital_twins`).first<any>();
  return c.json({
    status: "ok",
    version: "2.2.0",
    features: {
      npcTutorial: true,
      trustScore: true,
      onboarding5Step: true,
    },
    stats: {
      users: userCount?.cnt ?? 0,
      npcs: npcCount?.cnt ?? 0,
      twins: twinCount?.cnt ?? 0,
    },
  });
});

api.all("/api/trpc/*", async (c) => {
  const env = c.env as Env;
  const db = env.DB;
  await ensureSchema(db);

  // Try to resolve user from JWT cookie
  let userId = 0;
  let user: Context["user"] = null;
  const cookieHeader = c.req.header("cookie") || null;
  const token = parseCookie(cookieHeader, COOKIE_NAME);

  if (token) {
    const session = await verifySessionToken(token, env);
    if (session) {
      const row = await db.prepare(`SELECT id, openId, name, email, role, plan FROM users WHERE id=?`).bind(session.userId).first<any>();
      if (row) {
        userId = row.id;
        user = { id: row.id, openId: row.openId, name: row.name, email: row.email, role: row.role };
      }
    }
  }

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ env, userId, user }),
  });
});

// Set-cookie endpoint for login/register (called by client after tRPC mutation)
api.post("/api/auth/set-session", async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) return c.json({ error: "token required" }, 400);

  const env = c.env as Env;
  const session = await verifySessionToken(body.token, env);
  if (!session) return c.json({ error: "invalid token" }, 401);

  const isProduction = c.req.url.includes("workers.dev") || c.req.url.includes("pages.dev");
  const cookie = [
    `${COOKIE_NAME}=${body.token}`,
    `Path=/`,
    `HttpOnly`,
    isProduction ? `SameSite=None` : `SameSite=Lax`,
    `Max-Age=${Math.floor(ONE_YEAR_MS / 1000)}`,
    isProduction ? `Secure` : "",
  ].filter(Boolean).join("; ");

  return c.json({ success: true }, 200, { "Set-Cookie": cookie });
});

// Serve R2 assets
api.get("/assets/*", async (c) => {
  const env = c.env as Env;
  const r2 = env.ASSETS;
  if (!r2) return c.json({ error: "R2 not configured" }, 500);

  const key = c.req.path.replace(/^\/assets\//, "");
  if (!key) return c.json({ error: "Key required" }, 400);

  const object = await r2.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

// Clear session cookie on logout
api.post("/api/auth/logout", (c) => {
  const isProduction = c.req.url.includes("workers.dev") || c.req.url.includes("pages.dev");
  const cookie = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `HttpOnly`,
    isProduction ? `SameSite=None` : `SameSite=Lax`,
    `Max-Age=0`,
    isProduction ? `Secure` : "",
  ].filter(Boolean).join("; ");
  return c.json({ success: true }, 200, { "Set-Cookie": cookie });
});

// Matching dialogue export (CSV)
api.get("/api/export/matching/:id/csv", async (c) => {
  const env = c.env as Env;
  await ensureSchema(env.DB);
  const cookieHeader = c.req.header("cookie") || null;
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const sess = await verifySessionToken(token, env);
  if (!sess) return c.json({ error: "Unauthorized" }, 401);
  const sessionId = parseInt(c.req.param("id") || "0");
  if (!sessionId) return c.json({ error: "Invalid session ID" }, 400);
  const ms = await env.DB.prepare(
    `SELECT ms.*, t1.name as twin1Name, t2.name as twin2Name FROM matching_sessions ms LEFT JOIN digital_twins t1 ON t1.id=ms.twin1Id LEFT JOIN digital_twins t2 ON t2.id=ms.twin2Id WHERE ms.id=? AND ms.initiatorUserId=?`
  ).bind(sessionId, sess.userId).first<any>();
  if (!ms) return c.json({ error: "Not found" }, 404);
  const dialogues = await env.DB.prepare(
    `SELECT md.*, dt.name as speakerName FROM matching_dialogues md LEFT JOIN digital_twins dt ON dt.id=md.speakerTwinId WHERE md.sessionId=? ORDER BY md.turnNumber`
  ).bind(sessionId).all<any>();
  const result = await env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(sessionId).first<any>();
  const lines: string[] = ['\uFEFF"ターン","発言者","内容","日時"'];
  for (const d of (dialogues.results ?? [])) {
    lines.push(`${d.turnNumber},"${(d.speakerName||'').replace(/"/g,'""')}","${(d.content||'').replace(/"/g,'""')}","${d.createdAt||''}"`);
  }
  if (result) {
    lines.push('');
    lines.push('"--- 分析結果 ---"');
    lines.push(`"相性スコア","${result.compatibilityScore ?? '-'}"`);
    lines.push(`"要約","${(result.summary||'').replace(/"/g,'""')}"`);
  }
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="matching-${sessionId}.csv"` },
  });
});

// Matching dialogue export (printable HTML for PDF)
api.get("/api/export/matching/:id/pdf", async (c) => {
  const env = c.env as Env;
  await ensureSchema(env.DB);
  const cookieHeader = c.req.header("cookie") || null;
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const sess = await verifySessionToken(token, env);
  if (!sess) return c.json({ error: "Unauthorized" }, 401);
  const sessionId = parseInt(c.req.param("id") || "0");
  if (!sessionId) return c.json({ error: "Invalid session ID" }, 400);
  const ms = await env.DB.prepare(
    `SELECT ms.*, t1.name as twin1Name, t2.name as twin2Name FROM matching_sessions ms LEFT JOIN digital_twins t1 ON t1.id=ms.twin1Id LEFT JOIN digital_twins t2 ON t2.id=ms.twin2Id WHERE ms.id=? AND ms.initiatorUserId=?`
  ).bind(sessionId, sess.userId).first<any>();
  if (!ms) return c.json({ error: "Not found" }, 404);
  const dialogues = await env.DB.prepare(
    `SELECT md.*, dt.name as speakerName FROM matching_dialogues md LEFT JOIN digital_twins dt ON dt.id=md.speakerTwinId WHERE md.sessionId=? ORDER BY md.turnNumber`
  ).bind(sessionId).all<any>();
  const result = await env.DB.prepare(`SELECT * FROM matching_results WHERE sessionId=?`).bind(sessionId).first<any>();
  const dialogueHtml = (dialogues.results ?? []).map((d: any) =>
    `<div style="margin:8px 0;padding:10px 14px;background:${d.turnNumber%2===0?'#f0f7ff':'#f7f0ff'};border-radius:8px;"><strong>${escapeHtml(d.speakerName||'Unknown')}</strong><p style="margin:4px 0 0;white-space:pre-wrap;">${escapeHtml(d.content||'')}</p></div>`
  ).join('');
  let scoreHtml = '<p>分析結果なし</p>';
  if (result) {
    const strengths = result.strengths ? JSON.parse(result.strengths) : [];
    const challenges = result.challenges ? JSON.parse(result.challenges) : [];
    const recommendations = result.recommendations ? JSON.parse(result.recommendations) : [];
    scoreHtml = `<div style="text-align:center;margin:20px 0;"><div style="display:inline-block;width:80px;height:80px;border-radius:50%;background:${(result.compatibilityScore??0)>=70?'#22c55e':'#f59e0b'};color:white;line-height:80px;font-size:24px;font-weight:bold;">${result.compatibilityScore??'-'}%</div></div><h3>要約</h3><p>${escapeHtml(result.summary||'')}</p>${strengths.length?'<h3>強み</h3><ul>'+strengths.map((s:string)=>`<li>${escapeHtml(s)}</li>`).join('')+'</ul>':''}${challenges.length?'<h3>課題</h3><ul>'+challenges.map((s:string)=>`<li>${escapeHtml(s)}</li>`).join('')+'</ul>':''}${recommendations.length?'<h3>提案</h3><ul>'+recommendations.map((s:string)=>`<li>${escapeHtml(s)}</li>`).join('')+'</ul>':''}`;
  }
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>マッチングレポート #${sessionId}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#333}h1{font-size:20px;border-bottom:2px solid #6366f1;padding-bottom:8px}h2{font-size:16px;color:#6366f1;margin-top:24px}h3{font-size:14px;margin-top:16px}@media print{body{padding:0}.no-print{display:none!important}}</style></head><body><button class="no-print" onclick="window.print()" style="position:fixed;top:10px;right:10px;padding:8px 16px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;">PDFに保存</button><h1>マッチング対話レポート</h1><p><strong>テーマ:</strong> ${escapeHtml(ms.theme)}</p><p><strong>参加者:</strong> ${escapeHtml(ms.twin1Name||'')} vs ${escapeHtml(ms.twin2Name||'')}</p><p><strong>日時:</strong> ${ms.createdAt||''}</p><h2>対話ログ</h2>${dialogueHtml}<h2>分析結果</h2>${scoreHtml}<hr><p style="font-size:11px;color:#999;">分身AI - マッチングレポート - ${new Date().toISOString().slice(0,10)}</p></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

// Timing-safe comparison for webhook signatures
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Stripe webhook handler (hardened)
api.post("/api/stripe/webhook", async (c) => {
  const env = c.env as Env;
  if (!env.STRIPE_SECRET_KEY) return c.json({ error: "Stripe not configured" }, 500);

  await ensureSchema(env.DB);
  const body = await c.req.text();

  // REQUIRE webhook signature in production (reject unsigned requests)
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  const sigHeader = c.req.header("stripe-signature") || "";
  if (!sigHeader) return c.json({ error: "Missing stripe-signature header" }, 400);

  // Parse all signature parts (Stripe may send multiple v1 signatures)
  const sigParts: Record<string, string[]> = {};
  for (const part of sigHeader.split(",")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (!sigParts[key]) sigParts[key] = [];
    sigParts[key].push(val);
  }
  const timestamp = sigParts["t"]?.[0];
  const signatures = sigParts["v1"] || [];
  if (!timestamp || signatures.length === 0) return c.json({ error: "Missing signature components" }, 400);

  // Reject old timestamps (>5 min) to prevent replay attacks
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return c.json({ error: "Timestamp too old or invalid" }, 400);
  }

  // Compute expected signature
  const payload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey("raw", encoder.encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(payload));
  const expectedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Timing-safe comparison against all v1 signatures
  const signatureValid = signatures.some(s => timingSafeEqual(expectedSig, s));
  if (!signatureValid) {
    return c.json({ error: "Invalid signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Idempotency: skip already-processed events
  if (event.id) {
    const existing = await env.DB.prepare(
      `SELECT id FROM stripe_webhook_events WHERE eventId=?`
    ).bind(event.id).first<any>();
    if (existing) {
      return c.json({ received: true, deduplicated: true });
    }
  }

  // Handle relevant events
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data?.object;
      const userId = session?.metadata?.userId;
      const plan = session?.metadata?.plan || "premium";
      const customerId = session?.customer;
      const subscriptionId = session?.subscription;
      if (userId) {
        await env.DB.prepare(
          `UPDATE users SET plan=?, stripeCustomerId=?, stripeSubscriptionId=?, updatedAt=datetime('now') WHERE id=?`
        ).bind(plan, customerId, subscriptionId, parseInt(userId)).run();
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data?.object;
      const customerId = sub?.customer;
      if (customerId) {
        await env.DB.prepare(
          `UPDATE users SET plan='free', stripeSubscriptionId=NULL, updatedAt=datetime('now') WHERE stripeCustomerId=?`
        ).bind(customerId).run();
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data?.object;
      const customerId = sub?.customer;
      if (customerId && sub?.status === "active") {
        await env.DB.prepare(
          `UPDATE users SET stripeSubscriptionId=?, updatedAt=datetime('now') WHERE stripeCustomerId=?`
        ).bind(sub.id, customerId).run();
      } else if (customerId && (sub?.status === "canceled" || sub?.status === "unpaid")) {
        await env.DB.prepare(
          `UPDATE users SET plan='free', stripeSubscriptionId=NULL, updatedAt=datetime('now') WHERE stripeCustomerId=?`
        ).bind(customerId).run();
      }
      break;
    }
  }

  // Log processed event for idempotency + audit trail
  if (event.id) {
    try {
      await env.DB.prepare(
        `INSERT INTO stripe_webhook_events (eventId, eventType) VALUES (?,?)`
      ).bind(event.id, event.type).run();
    } catch { /* ignore duplicate insert */ }
  }

  return c.json({ received: true });
});

// ============ Billing Checkout (REST) ============
api.post("/api/billing/checkout", async (c) => {
  const env = c.env as Env;
  if (!env.STRIPE_SECRET_KEY) return c.json({ error: "Stripe not configured" }, 500);
  await ensureSchema(env.DB);

  // Authenticate via cookie
  const cookieHeader = c.req.header("cookie") || null;
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const sess = await verifySessionToken(token, env);
  if (!sess) return c.json({ error: "Invalid session" }, 401);
  const userId = sess.userId;

  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const planId = body.plan || body.planId || "premium";
  const interval = body.interval || body.billingCycle || "monthly";

  const user = await env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(userId).first<any>();

  // Create or reuse Stripe customer
  let customerId = user?.stripeCustomerId;
  if (!customerId) {
    const custRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: `email=${encodeURIComponent(user?.email || "")}&metadata[userId]=${userId}`,
    });
    const custData = await custRes.json() as any;
    if (!custData.id) return c.json({ error: "Failed to create Stripe customer" }, 500);
    customerId = custData.id;
    await env.DB.prepare(`UPDATE users SET stripeCustomerId=? WHERE id=?`).bind(customerId, userId).run();
  }

  const priceMap: Record<string, Record<string, number>> = {
    premium: { monthly: 1480, yearly: 14800 },
    enterprise: { monthly: 4980, yearly: 49800 },
  };
  const amount = priceMap[planId]?.[interval === "yearly" ? "yearly" : "monthly"] || 1480;
  const recurring = interval === "yearly" ? "year" : "month";
  const planLabel = planId === "enterprise" ? "エンタープライズ" : "プロ";

  const params = new URLSearchParams({
    mode: "subscription",
    customer: customerId,
    "success_url": "https://bunshin-ai.pages.dev/plan?session_id={CHECKOUT_SESSION_ID}&status=success",
    "cancel_url": "https://bunshin-ai.pages.dev/plan?status=cancelled",
    "line_items[0][price_data][currency]": "jpy",
    "line_items[0][price_data][product_data][name]": `分身AI ${planLabel}プラン`,
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][recurring][interval]": recurring,
    "line_items[0][quantity]": "1",
    "metadata[userId]": String(userId),
    "metadata[plan]": planId,
  });

  const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const sessionData = await sessionRes.json() as any;

  if (sessionData.url) {
    return c.json({ url: sessionData.url });
  }
  return c.json({ error: sessionData.error?.message || "Checkout session creation failed" }, 400);
});

// ============ LINE Webhook ============

api.post("/api/line/webhook", async (c) => {
  const env = c.env as Env;
  const body = await c.req.text();
  const sig = c.req.header("x-line-signature") || "";
  const result = await handleLineWebhook(env, body, sig);
  if (!result.success) {
    const status = result.error === "Invalid signature" ? 403 : result.error === "Invalid JSON" ? 400 : 500;
    return c.json({ error: result.error }, status);
  }
  return c.json({ success: true });
});

// LINE webhook verification (GET)
api.get("/api/line/webhook", (c) => {
  return c.json({
    status: "active",
    version: "2.0.0",
    supportedEvents: ["follow", "unfollow", "message", "join"],
    supportedMessageTypes: ["text"],
  });
});

// ============ Scheduled (Cron) Handler ============

async function handleScheduled(env: Env): Promise<void> {
  const db = env.DB;
  await ensureSchema(db);

  // Monthly reset: reset matchingsThisMonth for users whose lastResetAt is in a previous month
  try {
    await db.prepare(
      `UPDATE usage_tracking SET matchingsThisMonth=0, lastResetAt=datetime('now'), updatedAt=datetime('now') WHERE lastResetAt < date('now', 'start of month')`
    ).run();
  } catch { /* ignore if table doesn't exist yet */ }

  // Find all active schedules that are due
  const dueSchedules = await db.prepare(
    `SELECT s.*, u.name as userName FROM auto_matching_schedules s JOIN users u ON u.id=s.userId WHERE s.isActive=1 AND (s.nextRunAt IS NULL OR s.nextRunAt <= datetime('now'))`
  ).all<any>();

  for (const schedule of dueSchedules.results ?? []) {
    try {
      // Get twins for both users
      const myTwin = await db.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(schedule.userId).first<any>();
      const friendTwin = await db.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(schedule.friendId).first<any>();
      if (!myTwin || !friendTwin) continue;

      // Create matching session
      const sessionRes = await db.prepare(
        `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'running',?)`
      ).bind(schedule.userId, myTwin.id, friendTwin.id, schedule.theme, toJson({ autoScheduled: true, scheduleId: schedule.id })).run();
      const sessionId = Number(sessionRes.meta.last_row_id);

      // Get LLM config
      const llmConfig = await getUserLLMConfig(db, schedule.userId, "matching", env);
      if (!llmConfig) {
        await db.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
        continue;
      }

      // Generate dialogue
      const twins = [
        { id: myTwin.id, name: myTwin.name || "Twin A", personality: myTwin.personality || "" },
        { id: friendTwin.id, name: friendTwin.name || "Twin B", personality: friendTwin.personality || "" },
      ];
      const dialogueHistory: { speaker: string; content: string }[] = [];

      for (let turn = 0; turn < schedule.turns; turn++) {
        const speakerIdx = turn % 2;
        const speaker = twins[speakerIdx];
        const other = twins[1 - speakerIdx];

        const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: `あなたは「${speaker.name}」です。性格: ${speaker.personality || "プロフェッショナル"}。テーマ「${schedule.theme}」について「${other.name}」と対話してください。150〜300文字程度で発言してください。` },
        ];
        for (const d of dialogueHistory) {
          msgs.push({ role: d.speaker === speaker.name ? "assistant" : "user", content: `${d.speaker}: ${d.content}` });
        }
        if (turn === 0) {
          msgs.push({ role: "user", content: `テーマ「${schedule.theme}」について話し始めてください。` });
        }

        let content = `${speaker.name}として${schedule.theme}について議論します。`;
        try {
          const result = await invokeLLM(llmConfig, msgs, { maxTokens: 512, temperature: 0.8 });
          if (result.content) content = result.content.replace(new RegExp(`^${speaker.name}:\\s*`, "i"), "").trim();
        } catch { /* fallback */ }

        dialogueHistory.push({ speaker: speaker.name, content });
        await db.prepare(
          `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES (?,?,?,?,?,?)`
        ).bind(sessionId, speaker.id, content, turn, "scheduled", "auto").run();
      }

      // Run analysis
      try {
        const transcript = dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n");
        const analysisResult = await invokeLLM(llmConfig, [
          { role: "system", content: "あなたはビジネスマッチングの専門アナリストです。JSON形式で分析結果を返してください。" },
          { role: "user", content: `テーマ: ${schedule.theme}\n\n${transcript}\n\nJSON: {"compatibilityScore":0-100,"summary":"","strengths":[""],"challenges":[""],"recommendations":[""]}` },
        ], { maxTokens: 2048, temperature: 0.5 });

        let analysis: any = { compatibilityScore: 65, summary: "自動マッチングの結果、協業の可能性があります。" };
        try {
          const m = analysisResult.content.match(/\{[\s\S]*\}/);
          if (m) analysis = JSON.parse(m[0]);
        } catch { /* use fallback */ }

        await db.prepare(
          `INSERT INTO matching_results (sessionId, compatibilityScore, summary, strengths, challenges, recommendations) VALUES (?,?,?,?,?,?)`
        ).bind(sessionId, analysis.compatibilityScore ?? 65, analysis.summary || "", toJson(analysis.strengths || []), toJson(analysis.challenges || []), toJson(analysis.recommendations || [])).run();

        // Notify
        await notifyMatchingComplete(db, schedule.userId, schedule.theme, analysis.compatibilityScore ?? 65, env);
      } catch { /* analysis failed */ }

      await db.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();

      // Update schedule: set lastRunAt and compute nextRunAt
      // Use whitelist to prevent SQL injection from schedule.frequency values
      const INTERVAL_MAP: Record<string, string> = { daily: "+1 day", biweekly: "+14 days", weekly: "+7 days" };
      const interval = INTERVAL_MAP[schedule.frequency] || "+7 days";
      await db.prepare(
        `UPDATE auto_matching_schedules SET lastRunAt=datetime('now'), nextRunAt=datetime('now',?), updatedAt=datetime('now') WHERE id=?`
      ).bind(interval, schedule.id).run();
    } catch (err) {
      console.error(`[Scheduler] Failed for schedule ${schedule.id}:`, err);
    }
  }
}

export default {
  fetch: api.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};
