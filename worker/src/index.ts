import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import superjson from "superjson";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

type Env = {
  DB: D1Database;
};

type Context = {
  env: Env;
  userId: number; // Phase 1: no auth, single anon user
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const router = t.router;
const publicProcedure = t.procedure;

let schemaReady = false;
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  // D1 can be finicky with multi-statement exec in some environments.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS twins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        name TEXT NOT NULL,
        rawInput TEXT,
        status TEXT DEFAULT 'active',
        isPublic INTEGER DEFAULT 0,
        publicBio TEXT,
        tags TEXT,
        accuracyScore INTEGER,
        trainingIterations INTEGER,
        bigFiveTraits TEXT,
        judgmentThresholds TEXT,
        mbtiType TEXT,
        virtueWaveform TEXT,
        cumulativeWaveform TEXT,
        otherPerspectiveWaveform TEXT,
        scenarioProgress TEXT,
        createdAt TEXT DEFAULT (datetime('now')),
        updatedAt TEXT DEFAULT (datetime('now'))
      )`
    )
    .run();

  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_twins_userId ON twins(userId)`)
    .run();

  schemaReady = true;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function serializeJson(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

async function getMyTwin(db: D1Database, userId: number) {
  const row = await db
    .prepare(`SELECT * FROM twins WHERE userId = ? LIMIT 1`)
    .bind(userId)
    .first<any>();

  if (!row) return null;

  return {
    ...row,
    // Normalize fields expected by the UI.
    tags: parseJson<string[]>(row.tags) ?? [],
    bigFiveTraits: parseJson<Record<string, number>>(row.bigFiveTraits),
    judgmentThresholds: parseJson<Record<string, number>>(row.judgmentThresholds),
    mbtiType: parseJson<any>(row.mbtiType) ?? undefined,
    virtueWaveform: parseJson<any>(row.virtueWaveform),
    cumulativeWaveform: parseJson<any>(row.cumulativeWaveform),
    otherPerspectiveWaveform: parseJson<any>(row.otherPerspectiveWaveform),
    scenarioProgress: parseJson<any>(row.scenarioProgress),
  };
}

const appRouter = router({
  auth: router({
    me: publicProcedure.query(async () => null),
  }),

  myTwin: router({
    get: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      return getMyTwin(ctx.env.DB, ctx.userId);
    }),

    upsert: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          rawInput: z.string().optional().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);

        const existing = await getMyTwin(ctx.env.DB, ctx.userId);

        if (!existing) {
          const res = await ctx.env.DB
            .prepare(
              `INSERT INTO twins (userId, name, rawInput, updatedAt) VALUES (?, ?, ?, datetime('now'))`
            )
            .bind(ctx.userId, input.name, input.rawInput ?? null)
            .run();

          const id = Number(res.meta.last_row_id);
          return await ctx.env.DB
            .prepare(`SELECT * FROM twins WHERE id = ?`)
            .bind(id)
            .first();
        }

        await ctx.env.DB
          .prepare(
            `UPDATE twins SET name = ?, rawInput = ?, updatedAt = datetime('now') WHERE id = ?`
          )
          .bind(input.name, input.rawInput ?? null, existing.id)
          .run();

        return getMyTwin(ctx.env.DB, ctx.userId);
      }),

    update: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          rawInput: z.string().optional().nullable(),
        })
      )
      .mutation(async (opts) => appRouter.createCaller(opts.ctx).myTwin.upsert(opts.input)),

    updatePublicSettings: publicProcedure
      .input(
        z.object({
          isPublic: z.boolean(),
          publicBio: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!existing) return null;

        await ctx.env.DB
          .prepare(
            `UPDATE twins SET isPublic = ?, publicBio = ?, tags = ?, updatedAt = datetime('now') WHERE id = ?`
          )
          .bind(
            input.isPublic ? 1 : 0,
            input.publicBio ?? null,
            serializeJson(input.tags ?? existing.tags) ?? null,
            existing.id
          )
          .run();

        return getMyTwin(ctx.env.DB, ctx.userId);
      }),

    // Phase 1 stubs (keep UI from hard-crashing if clicked)
    runFullAnalysis: publicProcedure.mutation(async () => ({ ok: true })),
    generateSelfWaveform: publicProcedure.mutation(async () => ({ ok: true })),
    evaluateByAllTwins: publicProcedure.mutation(async () => ({ totalResponses: 0, totalEvaluators: 0, evaluatedCount: 0, totalEvaluations: 0 })),
    getScenarioProgress: publicProcedure.query(async () => ({ completed: 0, total: 0 })),
    personalityInterview: publicProcedure.mutation(async () => ({ ok: true })),
    mbtiInterview: publicProcedure.mutation(async () => ({ ok: true })),
    valueScenarioInterview: publicProcedure.mutation(async () => ({ ok: true })),
    searchPublic: publicProcedure.query(async () => ([])),
    getPublicTwin: publicProcedure
      .input(z.object({ twinId: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const row = await ctx.env.DB
          .prepare(`SELECT * FROM twins WHERE id = ? AND isPublic = 1 LIMIT 1`)
          .bind(input.twinId)
          .first<any>();
        if (!row) return null;
        return {
          ...row,
          tags: parseJson<string[]>(row.tags) ?? [],
          bigFiveTraits: parseJson<Record<string, number>>(row.bigFiveTraits),
          judgmentThresholds: parseJson<Record<string, number>>(row.judgmentThresholds),
          mbtiType: parseJson<any>(row.mbtiType) ?? undefined,
          virtueWaveform: parseJson<any>(row.virtueWaveform),
          cumulativeWaveform: parseJson<any>(row.cumulativeWaveform),
          otherPerspectiveWaveform: parseJson<any>(row.otherPerspectiveWaveform),
          scenarioProgress: parseJson<any>(row.scenarioProgress),
        };
      }),
  }),

  friends: router({
    generateFriendPredictions: publicProcedure.mutation(async () => ({ friendsProcessed: 0, successfulPredictions: 0, totalPredictions: 0 })),
  }),
});

export type AppRouter = typeof appRouter;

const api = new Hono<{ Bindings: Env }>();

// Phase 1: allow Pages origin to call the Worker API directly
api.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

api.get("/", (c) => c.json({ message: "Bunshin AI API. Use /api/* endpoints." }));
api.get("/api/health", (c) => c.json({ ok: true }));

api.all("/api/trpc/*", (c) => {
  // Phase 1: no auth; single user.
  const userId = 1;

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ env: c.env as Env, userId }),
  });
});

export default api;
