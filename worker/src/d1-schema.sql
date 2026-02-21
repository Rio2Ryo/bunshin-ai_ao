-- Bunshin AI - D1 (SQLite) Schema
-- Migrated from MySQL/Drizzle to Cloudflare D1

-- ============ Core Tables ============

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openId TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  loginMethod TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','premium','enterprise')),
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
  skills TEXT, -- JSON array
  experience TEXT,
  businessInfo TEXT,
  expertise TEXT, -- JSON array
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
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active','inactive','training')),
  isPublic INTEGER NOT NULL DEFAULT 0,
  publicBio TEXT,
  tags TEXT, -- JSON array
  bigFiveTraits TEXT, -- JSON
  judgmentThresholds TEXT, -- JSON
  virtueWaveform TEXT, -- JSON
  mineWaveform TEXT, -- JSON
  mbtiType TEXT, -- JSON
  personalitySimilarity REAL,
  accuracyScore REAL,
  trainingIterations INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_twins_userId ON digital_twins(userId);

-- ============ Social Tables ============

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','blocked')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_friendships_userId ON friendships(userId);
CREATE INDEX IF NOT EXISTS idx_friendships_friendId ON friendships(friendId);

-- ============ Knowledge & Files ============

CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  sourceType TEXT NOT NULL CHECK(sourceType IN ('upload','api','manual')),
  sourceId TEXT,
  title TEXT,
  content TEXT,
  summary TEXT,
  embedding TEXT, -- JSON array of numbers
  metadata TEXT, -- JSON
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
  processedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ AI Configuration ============

CREATE TABLE IF NOT EXISTS ai_api_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openai','gemini','anthropic','grok')),
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
  assignedProvider TEXT NOT NULL CHECK(assignedProvider IN ('openai','gemini','anthropic','grok','builtin')),
  assignedModel TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Chat ============

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
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  metadata TEXT, -- JSON
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sessionId ON chat_messages(sessionId);

-- ============ Matching ============

CREATE TABLE IF NOT EXISTS matching_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiatorUserId INTEGER NOT NULL,
  twin1Id INTEGER NOT NULL,
  twin2Id INTEGER NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
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
CREATE INDEX IF NOT EXISTS idx_matching_dialogues_sessionId ON matching_dialogues(sessionId);

CREATE TABLE IF NOT EXISTS matching_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL UNIQUE,
  compatibilityScore REAL,
  scoreBreakdown TEXT, -- JSON
  collaborationPotential TEXT,
  strengths TEXT, -- JSON array
  challenges TEXT, -- JSON array
  recommendations TEXT, -- JSON array
  summary TEXT,
  detailedAnalysis TEXT,
  roleDistribution TEXT,
  timeline TEXT,
  resources TEXT,
  kpis TEXT,
  nextSteps TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Plans & Usage ============

CREATE TABLE IF NOT EXISTS usage_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  matchingsThisMonth INTEGER NOT NULL DEFAULT 0,
  lastResetAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Value Scenarios & Waveforms ============

CREATE TABLE IF NOT EXISTS value_scenario_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  scenarioId TEXT NOT NULL,
  scenarioCategory TEXT NOT NULL,
  scenarioText TEXT NOT NULL,
  userResponse TEXT NOT NULL,
  analysisResult TEXT, -- JSON
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS value_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  targetUserId INTEGER NOT NULL,
  targetTwinId INTEGER NOT NULL,
  evaluatorTwinId INTEGER NOT NULL,
  evaluatorUserId INTEGER NOT NULL,
  scenarioResponseId INTEGER,
  verdict TEXT NOT NULL CHECK(verdict IN ('virtue','mine','neutral')),
  judgmentScores TEXT, -- JSON
  reason TEXT,
  confidence REAL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cumulative_waveforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  totalVirtueCount INTEGER NOT NULL DEFAULT 0,
  totalMineCount INTEGER NOT NULL DEFAULT 0,
  totalNeutralCount INTEGER NOT NULL DEFAULT 0,
  cumulativeJudgmentScores TEXT, -- JSON
  evaluatorBreakdown TEXT, -- JSON
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
  cumulativeJudgmentScores TEXT, -- JSON
  predictorBreakdown TEXT, -- JSON
  selfReportGap REAL,
  lastUpdated TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Intimacy & Predictions ============

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
  intimacyLevel TEXT NOT NULL DEFAULT 'stranger' CHECK(intimacyLevel IN ('stranger','acquaintance','friend','close_friend','best_friend')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS friend_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  targetUserId INTEGER NOT NULL,
  targetTwinId INTEGER NOT NULL,
  predictorUserId INTEGER NOT NULL,
  predictorTwinId INTEGER NOT NULL,
  scenarioResponseId INTEGER,
  scenarioId TEXT NOT NULL,
  scenarioText TEXT NOT NULL,
  predictedResponse TEXT NOT NULL,
  predictedVerdict TEXT NOT NULL CHECK(predictedVerdict IN ('virtue','mine','neutral')),
  predictedJudgmentScores TEXT, -- JSON
  predictionReason TEXT,
  confidence REAL,
  actualVerdict TEXT CHECK(actualVerdict IN ('virtue','mine','neutral')),
  isCorrect INTEGER,
  similarityScore REAL,
  comparedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Points System ============

CREATE TABLE IF NOT EXISTS point_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actionType TEXT NOT NULL UNIQUE,
  actionName TEXT NOT NULL,
  actionDescription TEXT,
  points INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
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
  type TEXT NOT NULL CHECK(type IN ('earn','spend','expire','adjust')),
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','cancelled','refunded')),
  shippingInfo TEXT, -- JSON
  fulfillmentInfo TEXT, -- JSON
  notes TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ LINE Connection ============

CREATE TABLE IF NOT EXISTS line_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  twinId INTEGER NOT NULL,
  lineUserId TEXT NOT NULL UNIQUE,
  lineDisplayName TEXT,
  linePictureUrl TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','paused','disconnected')),
  settings TEXT, -- JSON
  clawdbotAgentId TEXT,
  clawdbotAgentCreatedAt TEXT,
  totalMessages INTEGER NOT NULL DEFAULT 0,
  lastMessageAt TEXT,
  connectedAt TEXT,
  disconnectedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Clawdbot Connection ============

CREATE TABLE IF NOT EXISTS clawdbot_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  twinId INTEGER NOT NULL,
  gatewayUrl TEXT NOT NULL,
  authToken TEXT,
  agentId TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','testing','active','error','disconnected')),
  lastConnectionTest TEXT,
  lastError TEXT,
  settings TEXT, -- JSON
  totalMessages INTEGER NOT NULL DEFAULT 0,
  lastMessageAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Growth System ============

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
CREATE INDEX IF NOT EXISTS idx_growth_twinId ON twin_growth_status(twinId);

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

-- ============ Cards (Business Cards) ============

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  cardType TEXT NOT NULL DEFAULT 'business_card' CHECK(cardType IN ('business_card','point_card','membership_card','other')),
  name TEXT,
  company TEXT,
  position TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  website TEXT,
  imageUrl TEXT,
  ocrData TEXT, -- JSON
  notes TEXT,
  tags TEXT, -- JSON array
  isFavorite INTEGER NOT NULL DEFAULT 0,
  isArchived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_userId ON cards(userId);

-- ============ Conversation Learning ============

CREATE TABLE IF NOT EXISTS conversation_learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  twinId INTEGER NOT NULL,
  learnedTraits TEXT, -- JSON
  totalConversations INTEGER NOT NULL DEFAULT 0,
  lastAnalysisAt TEXT,
  analysisCount INTEGER NOT NULL DEFAULT 0,
  pendingConversations INTEGER NOT NULL DEFAULT 0,
  autoLearnEnabled INTEGER NOT NULL DEFAULT 1,
  learningThreshold INTEGER NOT NULL DEFAULT 10,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ AI Provider Settings ============

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
