/**
 * D1 Database helper functions for the Cloudflare Worker.
 * These mirror the server/db.ts operations but use D1 (SQLite) instead of MySQL.
 */

export function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ============ Schema Init ============

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openId TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT UNIQUE,
  passwordHash TEXT,
  loginMethod TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  friendCode TEXT UNIQUE,
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  lastSignedIn TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  displayName TEXT,
  bio TEXT,
  skills TEXT,
  experience TEXT,
  businessInfo TEXT,
  expertise TEXT,
  industry TEXT,
  company TEXT,
  position TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS digital_twins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  systemPrompt TEXT,
  rawInput TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  isPublic INTEGER NOT NULL DEFAULT 0,
  publicBio TEXT,
  tags TEXT,
  bigFiveTraits TEXT,
  judgmentThresholds TEXT,
  virtueWaveform TEXT,
  mineWaveform TEXT,
  mbtiType TEXT,
  personalitySimilarity REAL,
  accuracyScore REAL,
  trainingIterations INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_twins_userId ON digital_twins(userId);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_friendships_userId ON friendships(userId);
CREATE INDEX IF NOT EXISTS idx_friendships_friendId ON friendships(friendId);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  sourceType TEXT NOT NULL,
  sourceId TEXT,
  title TEXT,
  content TEXT,
  summary TEXT,
  metadata TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_twinId ON knowledge_base(twinId);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER,
  filename TEXT NOT NULL,
  fileKey TEXT NOT NULL,
  url TEXT NOT NULL,
  mimeType TEXT,
  size INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  processedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_api_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  provider TEXT NOT NULL,
  apiKey TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  lastValidated TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orchestration_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  roleName TEXT NOT NULL,
  roleDescription TEXT,
  assignedProvider TEXT NOT NULL,
  assignedModel TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  title TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_userId ON chat_sessions(userId);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sessionId ON chat_messages(sessionId);

CREATE TABLE IF NOT EXISTS matching_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiatorUserId INTEGER NOT NULL,
  twin1Id INTEGER NOT NULL,
  twin2Id INTEGER NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  completedAt TEXT
);

CREATE TABLE IF NOT EXISTS matching_dialogues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  speakerTwinId INTEGER NOT NULL,
  content TEXT NOT NULL,
  aiProvider TEXT,
  aiModel TEXT,
  turnNumber INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL UNIQUE,
  compatibilityScore REAL,
  scoreBreakdown TEXT,
  collaborationPotential TEXT,
  strengths TEXT,
  challenges TEXT,
  recommendations TEXT,
  summary TEXT,
  detailedAnalysis TEXT,
  roleDistribution TEXT,
  timeline TEXT,
  resources TEXT,
  kpis TEXT,
  nextSteps TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  matchingsThisMonth INTEGER NOT NULL DEFAULT 0,
  lastResetAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS value_scenario_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  scenarioId TEXT NOT NULL,
  scenarioCategory TEXT NOT NULL,
  scenarioText TEXT NOT NULL,
  userResponse TEXT NOT NULL,
  analysisResult TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cumulative_waveforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  totalVirtueCount INTEGER NOT NULL DEFAULT 0,
  totalMineCount INTEGER NOT NULL DEFAULT 0,
  totalNeutralCount INTEGER NOT NULL DEFAULT 0,
  cumulativeJudgmentScores TEXT,
  evaluatorBreakdown TEXT,
  lastUpdated TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS other_perspective_waveforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  totalVirtueCount INTEGER NOT NULL DEFAULT 0,
  totalMineCount INTEGER NOT NULL DEFAULT 0,
  totalNeutralCount INTEGER NOT NULL DEFAULT 0,
  cumulativeJudgmentScores TEXT,
  predictorBreakdown TEXT,
  selfReportGap REAL,
  lastUpdated TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intimacy_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  totalMessageCount INTEGER NOT NULL DEFAULT 0,
  conversationDays INTEGER NOT NULL DEFAULT 0,
  lastConversationAt TEXT,
  totalPredictions INTEGER NOT NULL DEFAULT 0,
  correctPredictions INTEGER NOT NULL DEFAULT 0,
  predictionAccuracy REAL,
  intimacyScore REAL NOT NULL DEFAULT 0,
  intimacyLevel TEXT NOT NULL DEFAULT 'stranger',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,
  totalEarned INTEGER NOT NULL DEFAULT 0,
  totalSpent INTEGER NOT NULL DEFAULT 0,
  totalExpired INTEGER NOT NULL DEFAULT 0,
  lastActivityAt TEXT NOT NULL DEFAULT (datetime('now')),
  expiresAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balanceAfter INTEGER NOT NULL,
  actionType TEXT,
  referenceId TEXT,
  description TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_point_transactions_userId ON point_transactions(userId);

CREATE TABLE IF NOT EXISTS redeemable_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  imageUrl TEXT,
  pointsCost INTEGER NOT NULL,
  priceYen INTEGER,
  category TEXT,
  stock INTEGER,
  isActive INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS point_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  productId INTEGER NOT NULL,
  pointsUsed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  shippingInfo TEXT,
  fulfillmentInfo TEXT,
  notes TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS point_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actionType TEXT NOT NULL UNIQUE,
  actionName TEXT NOT NULL,
  actionDescription TEXT,
  points INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS line_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  twinId INTEGER NOT NULL,
  lineUserId TEXT NOT NULL UNIQUE,
  lineDisplayName TEXT,
  linePictureUrl TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  settings TEXT,
  clawdbotAgentId TEXT,
  clawdbotAgentCreatedAt TEXT,
  totalMessages INTEGER NOT NULL DEFAULT 0,
  lastMessageAt TEXT,
  connectedAt TEXT,
  disconnectedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clawdbot_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  twinId INTEGER NOT NULL,
  gatewayUrl TEXT NOT NULL,
  authToken TEXT,
  agentId TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'pending',
  lastConnectionTest TEXT,
  lastError TEXT,
  settings TEXT,
  totalMessages INTEGER NOT NULL DEFAULT 0,
  lastMessageAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_growth_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL UNIQUE,
  userId INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  experience INTEGER NOT NULL DEFAULT 0,
  evolutionType TEXT NOT NULL DEFAULT 'basic',
  energy INTEGER NOT NULL DEFAULT 100,
  fullness INTEGER NOT NULL DEFAULT 100,
  mood INTEGER NOT NULL DEFAULT 100,
  bond INTEGER NOT NULL DEFAULT 0,
  totalConversations INTEGER NOT NULL DEFAULT 0,
  totalImageGenerations INTEGER NOT NULL DEFAULT 0,
  totalFriendPredictions INTEGER NOT NULL DEFAULT 0,
  totalScenarioAnswers INTEGER NOT NULL DEFAULT 0,
  totalDiagnosticsCompleted INTEGER NOT NULL DEFAULT 0,
  totalKnowledgeEntries INTEGER NOT NULL DEFAULT 0,
  consecutiveLoginDays INTEGER NOT NULL DEFAULT 0,
  lastLoginDate TEXT,
  lastCareAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_skill_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  skillType TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  milestoneId TEXT NOT NULL,
  achievedAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  cardType TEXT NOT NULL DEFAULT 'business_card',
  name TEXT,
  company TEXT,
  position TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  website TEXT,
  imageUrl TEXT,
  ocrData TEXT,
  notes TEXT,
  tags TEXT,
  isFavorite INTEGER NOT NULL DEFAULT 0,
  isArchived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_userId ON cards(userId);

CREATE TABLE IF NOT EXISTS conversation_learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  twinId INTEGER NOT NULL,
  learnedTraits TEXT,
  totalConversations INTEGER NOT NULL DEFAULT 0,
  lastAnalysisAt TEXT,
  analysisCount INTEGER NOT NULL DEFAULT 0,
  pendingConversations INTEGER NOT NULL DEFAULT 0,
  autoLearnEnabled INTEGER NOT NULL DEFAULT 1,
  learningThreshold INTEGER NOT NULL DEFAULT 10,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Migrations to run after schema creation (ALTER TABLE etc.)
const MIGRATIONS_SQL = `
ALTER TABLE users ADD COLUMN passwordHash TEXT;
ALTER TABLE users ADD COLUMN onboardingCompleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN mode TEXT;
`;

let schemaReady = false;

/**
 * Split multi-statement SQL into individual statements and run them via batch().
 * D1's exec() can crash with metadata aggregation errors on large schemas,
 * so we use prepare().run() for each statement via batch().
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  const stmts = splitStatements(SCHEMA_SQL);
  // D1 batch() executes all prepared statements in a single round-trip
  await db.batch(stmts.map((s) => db.prepare(s)));

  // Run migrations (ignore errors for already-applied migrations)
  const migrations = splitStatements(MIGRATIONS_SQL);
  for (const m of migrations) {
    try {
      await db.prepare(m).run();
    } catch {
      // Column already exists or migration already applied
    }
  }

  schemaReady = true;
}

// ============ Twin helpers ============

export function normalizeTwin(row: any) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJson<string[]>(row.tags) ?? [],
    bigFiveTraits: parseJson<Record<string, number>>(row.bigFiveTraits),
    judgmentThresholds: parseJson<Record<string, number>>(row.judgmentThresholds),
    mbtiType: parseJson<any>(row.mbtiType) ?? undefined,
    virtueWaveform: parseJson<any>(row.virtueWaveform),
    mineWaveform: parseJson<any>(row.mineWaveform),
    cumulativeWaveform: parseJson<any>(row.cumulativeWaveform),
    otherPerspectiveWaveform: parseJson<any>(row.otherPerspectiveWaveform),
    scenarioProgress: parseJson<any>(row.scenarioProgress),
  };
}

export async function getMyTwin(db: D1Database, userId: number) {
  const row = await db
    .prepare(`SELECT * FROM digital_twins WHERE userId = ? LIMIT 1`)
    .bind(userId)
    .first<any>();
  return normalizeTwin(row);
}

export async function getCumulativeWaveform(db: D1Database, userId: number, twinId: number) {
  const row = await db
    .prepare(`SELECT * FROM cumulative_waveforms WHERE userId = ? AND twinId = ? LIMIT 1`)
    .bind(userId, twinId)
    .first<any>();
  if (!row) return null;
  return {
    ...row,
    cumulativeJudgmentScores: parseJson<any>(row.cumulativeJudgmentScores),
    evaluatorBreakdown: parseJson<any>(row.evaluatorBreakdown),
  };
}

export async function getOtherPerspectiveWaveform(db: D1Database, userId: number) {
  const row = await db
    .prepare(`SELECT * FROM other_perspective_waveforms WHERE userId = ? LIMIT 1`)
    .bind(userId)
    .first<any>();
  if (!row) return null;
  return {
    ...row,
    cumulativeJudgmentScores: parseJson<any>(row.cumulativeJudgmentScores),
    predictorBreakdown: parseJson<any>(row.predictorBreakdown),
  };
}
