import { z } from "zod";
import superjson from "superjson";
import { initTRPC, TRPCError } from "@trpc/server";
import { SignJWT, jwtVerify } from "jose";

// ============ Types ============

export type Env = {
  DB: D1Database;
  ASSETS?: R2Bucket;
  CHAT_ROOMS: DurableObjectNamespace;
  MATCHING_ROOMS: DurableObjectNamespace;
  WORKSPACE_ROOMS: DurableObjectNamespace;
  JWT_SECRET?: string;
  AZURE_FOUNDRY_API_KEY?: string;
  AZURE_FOUNDRY_RESOURCE?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  CLAWDBOT_GATEWAY_URL?: string;
  CLAWDBOT_AUTH_TOKEN?: string;
  CLAWDBOT_AGENT_ID?: string;
  LINE_DEBUG_MODE?: string;
  TAVILY_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  FRONTEND_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
};

export type Context = {
  env: Env;
  userId: number;
  user: { id: number; openId: string; name: string | null; email: string | null; role: string } | null;
};

// ============ Auth Helpers ============

export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

export function getJwtSecret(env: Env): Uint8Array {
  const secret = env.JWT_SECRET || "bunshin-ai-dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  // Use PBKDF2 via Web Crypto (available in CF Workers)
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  // Store as salt:hash in hex
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  const computedHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  return computedHex === hashHex;
}

export async function createSessionToken(userId: number, env: Env): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .setIssuedAt()
    .sign(getJwtSecret(env));
}

export async function verifySessionToken(token: string, env: Env): Promise<{ userId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    if (typeof payload.userId === "number") return { userId: payload.userId };
    return null;
  } catch {
    return null;
  }
}

export function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ============ tRPC Setup ============

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "ログインが必要です" });
  }
  return next({ ctx: { ...ctx, user: ctx.user, userId: ctx.user.id } });
});

// ============ Helper: generate random code ============
export function generateCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============ Helper: escape HTML ============
export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
