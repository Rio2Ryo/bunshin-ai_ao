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

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

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
  avatarUrl TEXT,
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
CREATE INDEX IF NOT EXISTS idx_knowledge_twin_source ON knowledge_base(twinId, sourceType);

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
CREATE INDEX IF NOT EXISTS idx_uploaded_files_userId ON uploaded_files(userId);

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
CREATE INDEX IF NOT EXISTS idx_ai_api_configs_userId ON ai_api_configs(userId);

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
CREATE INDEX IF NOT EXISTS idx_orch_roles_userId ON orchestration_roles(userId);

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
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(sessionId, createdAt);

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
CREATE INDEX IF NOT EXISTS idx_matching_sessions_initiator ON matching_sessions(initiatorUserId);
CREATE INDEX IF NOT EXISTS idx_matching_sessions_initiator_created ON matching_sessions(initiatorUserId, createdAt);
CREATE INDEX IF NOT EXISTS idx_matching_sessions_twin1 ON matching_sessions(twin1Id);
CREATE INDEX IF NOT EXISTS idx_matching_sessions_twin2 ON matching_sessions(twin2Id);

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
CREATE INDEX IF NOT EXISTS idx_matching_results_sessionId ON matching_results(sessionId);

CREATE TABLE IF NOT EXISTS usage_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  matchingsThisMonth INTEGER NOT NULL DEFAULT 0,
  lastResetAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_userId ON usage_tracking(userId);

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
CREATE INDEX IF NOT EXISTS idx_vsr_userId ON value_scenario_responses(userId);

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
CREATE INDEX IF NOT EXISTS idx_cum_waveforms_userId ON cumulative_waveforms(userId);

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
CREATE INDEX IF NOT EXISTS idx_other_waveforms_userId ON other_perspective_waveforms(userId);

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
CREATE INDEX IF NOT EXISTS idx_intimacy_userId ON intimacy_scores(userId);

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
CREATE INDEX IF NOT EXISTS idx_point_transactions_user_created ON point_transactions(userId, createdAt);

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
  userId INTEGER,
  twinId INTEGER,
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

CREATE INDEX IF NOT EXISTS idx_line_connections_lineuser_status ON line_connections(lineUserId, status);

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
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS persona_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creatorUserId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  systemPrompt TEXT,
  tags TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  price INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'points',
  previewBio TEXT,
  rating REAL DEFAULT 0,
  ratingCount INTEGER NOT NULL DEFAULT 0,
  purchaseCount INTEGER NOT NULL DEFAULT 0,
  isPublished INTEGER NOT NULL DEFAULT 0,
  isApproved INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_templates_creator ON persona_templates(creatorUserId);

CREATE TABLE IF NOT EXISTS persona_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  templateId INTEGER NOT NULL,
  pointsSpent INTEGER NOT NULL DEFAULT 0,
  appliedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(userId, templateId)
);
CREATE INDEX IF NOT EXISTS idx_persona_purchases_userId ON persona_purchases(userId);

CREATE TABLE IF NOT EXISTS persona_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  templateId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(templateId, userId)
);

CREATE TABLE IF NOT EXISTS trust_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  score INTEGER NOT NULL DEFAULT 0,
  rank TEXT NOT NULL DEFAULT 'bronze',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trust_score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  action TEXT NOT NULL,
  delta INTEGER NOT NULL,
  scoreAfter INTEGER NOT NULL,
  description TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trust_history_userId ON trust_score_history(userId);

CREATE TABLE IF NOT EXISTS matching_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  senderUserId INTEGER NOT NULL,
  receiverUserId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matching_req_sender ON matching_requests(senderUserId);
CREATE INDEX IF NOT EXISTS idx_matching_req_receiver ON matching_requests(receiverUserId);

CREATE TABLE IF NOT EXISTS auto_matching_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  theme TEXT NOT NULL DEFAULT '協業の可能性',
  turns INTEGER NOT NULL DEFAULT 5,
  isActive INTEGER NOT NULL DEFAULT 1,
  lastRunAt TEXT,
  nextRunAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auto_matching_userId ON auto_matching_schedules(userId);

CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  slackWebhookUrl TEXT,
  lineNotify INTEGER NOT NULL DEFAULT 1,
  emailNotify INTEGER NOT NULL DEFAULT 0,
  matchingComplete INTEGER NOT NULL DEFAULT 1,
  scheduledMatching INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporterUserId INTEGER NOT NULL,
  targetType TEXT NOT NULL,
  targetId INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewedBy INTEGER,
  reviewedAt TEXT,
  action TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adminUserId INTEGER NOT NULL,
  targetType TEXT NOT NULL,
  targetId INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_visibility_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  viewerUserId INTEGER NOT NULL,
  permission TEXT NOT NULL DEFAULT 'view',
  grantedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(twinId, viewerUserId)
);
CREATE INDEX IF NOT EXISTS idx_twin_visibility_twinId ON twin_visibility_rules(twinId);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId TEXT NOT NULL UNIQUE,
  eventType TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data TEXT,
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_userId_read ON notifications(userId, isRead);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(userId, createdAt);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification_tokens(token);

CREATE TABLE IF NOT EXISTS user_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  blockedUserId INTEGER NOT NULL,
  reason TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(userId, blockedUserId)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_userId ON user_blocks(userId);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blockedUserId ON user_blocks(blockedUserId);

CREATE TABLE IF NOT EXISTS matching_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  turnNumber INTEGER,
  content TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matching_comments_session ON matching_comments(sessionId);

CREATE TABLE IF NOT EXISTS matching_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'like',
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId, turnNumber, type)
);
CREATE INDEX IF NOT EXISTS idx_matching_reactions_session ON matching_reactions(sessionId);

CREATE TABLE IF NOT EXISTS personality_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  bigFive TEXT,
  mbti TEXT,
  mbtiScores TEXT,
  valueProfile TEXT,
  interviewLog TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  questionCount INTEGER NOT NULL DEFAULT 0,
  analyzedAt TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personality_profiles_userId ON personality_profiles(userId);

CREATE TABLE IF NOT EXISTS dialogue_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
  comment TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, turnNumber, userId)
);
CREATE INDEX IF NOT EXISTS idx_dialogue_feedback_session ON dialogue_feedback(sessionId);
CREATE INDEX IF NOT EXISTS idx_dialogue_feedback_user ON dialogue_feedback(userId);

CREATE TABLE IF NOT EXISTS matching_session_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msp_sessionId ON matching_session_participants(sessionId);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subs_userId ON push_subscriptions(userId);

CREATE TABLE IF NOT EXISTS matching_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, turnNumber, userId)
);
CREATE INDEX IF NOT EXISTS idx_matching_notes_session ON matching_notes(sessionId);
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  ownerId INTEGER NOT NULL,
  settings TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_ownerId ON workspaces(ownerId);

CREATE TABLE IF NOT EXISTS workspace_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joinedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(workspaceId, userId)
);
CREATE INDEX IF NOT EXISTS idx_ws_members_ws ON workspace_members(workspaceId);
CREATE INDEX IF NOT EXISTS idx_ws_members_user ON workspace_members(userId);

CREATE TABLE IF NOT EXISTS workspace_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceId INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  metadata TEXT,
  createdBy INTEGER NOT NULL,
  lastEditedBy INTEGER,
  positionX REAL DEFAULT 0,
  positionY REAL DEFAULT 0,
  width REAL DEFAULT 300,
  height REAL DEFAULT 200,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ws_items_ws ON workspace_items(workspaceId);

CREATE TABLE IF NOT EXISTS workspace_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  targetScore INTEGER,
  currentScore INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  dueDate TEXT,
  createdBy INTEGER NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ws_goals_ws ON workspace_goals(workspaceId);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  keyHash TEXT NOT NULL UNIQUE,
  keyPrefix TEXT NOT NULL,
  permissions TEXT,
  lastUsedAt TEXT,
  revokedAt TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_userId ON api_keys(userId);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(keyHash);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  lastTriggeredAt TEXT,
  failCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhooks_userId ON webhooks(userId);

`;

// Migrations to run after schema creation (ALTER TABLE etc.)
const MIGRATIONS_SQL = `
ALTER TABLE users ADD COLUMN passwordHash TEXT;
ALTER TABLE users ADD COLUMN onboardingCompleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN mode TEXT;
ALTER TABLE other_perspective_waveforms ADD COLUMN evaluatorTwinId INTEGER;
ALTER TABLE other_perspective_waveforms ADD COLUMN scenarioId TEXT;
ALTER TABLE other_perspective_waveforms ADD COLUMN virtueScore REAL;
ALTER TABLE other_perspective_waveforms ADD COLUMN mineScore REAL;
ALTER TABLE other_perspective_waveforms ADD COLUMN comment TEXT;
ALTER TABLE value_scenario_responses ADD COLUMN evaluation TEXT;
ALTER TABLE value_scenario_responses ADD COLUMN evaluatedAt TEXT;
ALTER TABLE value_scenario_responses ADD COLUMN virtueScore REAL;
ALTER TABLE value_scenario_responses ADD COLUMN mineScore REAL;
ALTER TABLE cumulative_waveforms ADD COLUMN waveformType TEXT DEFAULT 'self';
ALTER TABLE cumulative_waveforms ADD COLUMN waveformData TEXT;
ALTER TABLE users ADD COLUMN isNpc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboardingStep INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN tutorialCompleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matching_sessions ADD COLUMN settings TEXT;
ALTER TABLE matching_results ADD COLUMN webSearchData TEXT;
ALTER TABLE users ADD COLUMN tosAcceptedAt TEXT;
ALTER TABLE users ADD COLUMN tosVersion TEXT;
ALTER TABLE digital_twins ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE digital_twins ADD COLUMN allowedViewerIds TEXT;
ALTER TABLE user_profiles ADD COLUMN avatarUrl TEXT;
ALTER TABLE users ADD COLUMN emailVerified INTEGER;
ALTER TABLE twin_milestones ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE twin_milestones ADD COLUMN description TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS scheduler_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  availableSlots TEXT,
  preferredThemes TEXT,
  autoExecute INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  lastSuggestionAt TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduler_pref_userId ON scheduler_preferences(userId);
ALTER TABLE digital_twins ADD COLUMN avatarUrl TEXT;
CREATE TABLE IF NOT EXISTS matching_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  predictedScore INTEGER NOT NULL,
  predictedBreakdown TEXT,
  reasoning TEXT,
  actualScore INTEGER,
  actualSessionId INTEGER,
  accuracy REAL,
  createdAt TEXT DEFAULT (datetime('now')),
  resolvedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_matching_predictions_userId ON matching_predictions(userId);
CREATE INDEX IF NOT EXISTS idx_matching_predictions_resolved ON matching_predictions(userId, resolvedAt);
CREATE TABLE IF NOT EXISTS matching_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creatorUserId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  systemPromptTemplate TEXT NOT NULL,
  turnCount INTEGER NOT NULL DEFAULT 5,
  analysisPromptTemplate TEXT,
  tags TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  isPublished INTEGER NOT NULL DEFAULT 0,
  isApproved INTEGER NOT NULL DEFAULT 0,
  usageCount INTEGER NOT NULL DEFAULT 0,
  rating REAL DEFAULT 0,
  ratingCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matching_scenarios_creator ON matching_scenarios(creatorUserId);
CREATE INDEX IF NOT EXISTS idx_matching_scenarios_published ON matching_scenarios(isPublished, isApproved);
CREATE TABLE IF NOT EXISTS scenario_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  scenarioId INTEGER NOT NULL,
  pointsSpent INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, scenarioId)
);
CREATE INDEX IF NOT EXISTS idx_scenario_purchases_userId ON scenario_purchases(userId);
CREATE TABLE IF NOT EXISTS scenario_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenarioId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(scenarioId, userId)
);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceId INTEGER NOT NULL,
  name TEXT NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  settings TEXT,
  results TEXT,
  createdBy INTEGER NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  completedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_tournaments_workspace ON tournaments(workspaceId);
CREATE TABLE IF NOT EXISTS tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournamentId INTEGER NOT NULL,
  player1UserId INTEGER NOT NULL,
  player2UserId INTEGER NOT NULL,
  sessionId INTEGER,
  player1Score INTEGER,
  player2Score INTEGER,
  winnerId INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournamentId);

CREATE TABLE IF NOT EXISTS feed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT,
  visibility TEXT NOT NULL DEFAULT 'friends' CHECK(visibility IN ('public','friends','private')),
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feed_items_user ON feed_items(userId);
CREATE INDEX IF NOT EXISTS idx_feed_items_created ON feed_items(createdAt);

CREATE TABLE IF NOT EXISTS feed_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedItemId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(feedItemId, userId)
);

CREATE TABLE IF NOT EXISTS feed_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedItemId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feed_comments_item ON feed_comments(feedItemId);

CREATE TABLE IF NOT EXISTS matching_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  theme TEXT NOT NULL,
  turns INTEGER NOT NULL DEFAULT 5,
  systemPrompt TEXT,
  dialoguePattern TEXT,
  tags TEXT DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('public','private')),
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matching_templates_user ON matching_templates(userId);

CREATE TABLE IF NOT EXISTS matching_template_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  templateId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  insightsData TEXT,
  generatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId)
);

CREATE TABLE IF NOT EXISTS matching_coach_advice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  advice TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, turnNumber, userId)
);

CREATE TABLE IF NOT EXISTS twin_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'default',
  personality TEXT,
  systemPrompt TEXT,
  description TEXT,
  tags TEXT,
  useCount INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_board_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  tags TEXT,
  sourceId INTEGER,
  position INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
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

  // Seed default redeemable products
  try {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO redeemable_products (id, name, description, pointsCost, category, isActive, sortOrder) VALUES (1, 'AIチャット追加枠 (10回)', '分身AIとの追加チャット枠', 100, 'デジタル', 1, 1)`),
      db.prepare(`INSERT OR IGNORE INTO redeemable_products (id, name, description, pointsCost, category, isActive, sortOrder) VALUES (2, 'プレミアムマッチング分析', '詳細なマッチング分析レポート', 500, 'デジタル', 1, 2)`),
      db.prepare(`INSERT OR IGNORE INTO redeemable_products (id, name, description, pointsCost, category, isActive, sortOrder) VALUES (3, 'Amazonギフトカード ¥500', 'Amazonギフトカード', 5000, 'ギフト', 1, 3)`),
    ]);
  } catch {
    // Products already seeded or table not ready
  }

  schemaReady = true;
}

// ============ NPC helpers ============

const NPC_DEFINITIONS = [
  {
    openId: "npc_guide_taro",
    name: "ガイド太郎",
    email: "guide.taro@npc.bunshin-ai.local",
    friendCodePrefix: "NPCGT",
    twinName: "ガイド太郎の分身AI",
    twinDescription: "分身AIサービスの案内役。サービスの使い方やマッチングの始め方を丁寧に教えてくれる頼れるガイド。ビジネスの話題にも詳しい。",
    twinPersonality: "フレンドリーで親切。わかりやすい説明が得意で、初心者にも安心感を与える。ビジネストークが好き。",
    tags: '["ガイド","チュートリアル","ビジネス"]',
    welcomeMessage: `はじめまして！ガイド太郎です。

分身AIサービスへようこそ！僕はあなたの最初の友達として、プロフィール入力からサービスの使い方までご案内します。

オンボーディングでは僕が質問しますので、お名前・年齢・お仕事・趣味など気軽に教えてくださいね。あなたの情報をもとに「デジタル分身AI」を自動で作成します。

プロフィールが完成したら、僕や案内花子との練習マッチングを試せますよ！`,
  },
  {
    openId: "npc_guide_hanako",
    name: "案内花子",
    email: "guide.hanako@npc.bunshin-ai.local",
    friendCodePrefix: "NPCHA",
    twinName: "案内花子の分身AI",
    twinDescription: "分身AIサービスのナビゲーター。マッチング機能の使い方や信頼度スコアの上げ方をアドバイスしてくれるサポーター。",
    twinPersonality: "明るく元気。サービスのTIPSを教えるのが得意で、ユーザーのモチベーションを上げる声かけが上手い。",
    tags: '["ガイド","チュートリアル","マッチング"]',
    welcomeMessage: `こんにちは！案内花子です。

私はマッチング機能のご案内を担当しています！

プロフィールが完成すると、オンボーディングの最後でマッチング候補が表示されます。私やガイド太郎との練習マッチングをぜひ試してみてくださいね！

マッチングでは、お互いの分身AI同士がビジネスの可能性について自動で対話します。信頼度スコアが上がると、実際のユーザーとのマッチングも始められますよ！`,
  },
] as const;

/**
 * Ensure NPC users + twins exist and befriend the given user.
 * Also creates tutorial chat sessions with welcome messages from each NPC.
 * Called during registration so the new user has 2 NPC friends.
 */
export async function ensureNpcFriends(db: D1Database, userId: number) {
  for (const npc of NPC_DEFINITIONS) {
    // Upsert NPC user
    let npcUser = await db.prepare(`SELECT id FROM users WHERE openId=?`).bind(npc.openId).first<any>();
    if (!npcUser) {
      const code = `${npc.friendCodePrefix}${String(Date.now()).slice(-4)}`;
      await db.prepare(
        `INSERT INTO users (openId, name, email, loginMethod, role, plan, friendCode, isNpc, onboardingCompleted) VALUES (?,?,?,'npc','npc','free',?,1,1)`
      ).bind(npc.openId, npc.name, npc.email, code).run();
      npcUser = await db.prepare(`SELECT id FROM users WHERE openId=?`).bind(npc.openId).first<any>();
    }
    if (!npcUser) continue;

    // Upsert NPC twin
    let npcTwin = await db.prepare(`SELECT id FROM digital_twins WHERE userId=?`).bind(npcUser.id).first<any>();
    if (!npcTwin) {
      await db.prepare(
        `INSERT INTO digital_twins (userId, name, description, personality, tags, status, isPublic) VALUES (?,?,?,?,?,'active',1)`
      ).bind(npcUser.id, npc.twinName, npc.twinDescription, npc.twinPersonality, npc.tags).run();
      npcTwin = await db.prepare(`SELECT id FROM digital_twins WHERE userId=?`).bind(npcUser.id).first<any>();
    }
    if (!npcTwin) continue;

    // Auto-accept friendship (skip if already friends)
    const existing = await db.prepare(
      `SELECT id FROM friendships WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)`
    ).bind(userId, npcUser.id, npcUser.id, userId).first<any>();
    if (!existing) {
      await db.prepare(
        `INSERT INTO friendships (userId, friendId, status) VALUES (?,?,'accepted')`
      ).bind(npcUser.id, userId).run();
    }

    // Create a tutorial chat session with a welcome message from this NPC
    const existingSession = await db.prepare(
      `SELECT id FROM chat_sessions WHERE userId=? AND twinId=? AND mode='npc_tutorial'`
    ).bind(userId, npcTwin.id).first<any>();
    if (!existingSession) {
      const sessionRes = await db.prepare(
        `INSERT INTO chat_sessions (userId, twinId, title, mode) VALUES (?,?,?,?)`
      ).bind(userId, npcTwin.id, `${npc.name}からのメッセージ`, "npc_tutorial").run();
      const sessionId = Number(sessionRes.meta.last_row_id);
      await db.prepare(
        `INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`
      ).bind(sessionId, "assistant", npc.welcomeMessage).run();
    }
  }
}

// ============ Trust score helpers ============

const TRUST_RANKS = [
  { min: 0, rank: "bronze", label: "Bronze" },
  { min: 30, rank: "silver", label: "Silver" },
  { min: 60, rank: "gold", label: "Gold" },
  { min: 85, rank: "platinum", label: "Platinum" },
] as const;

export function getTrustRank(score: number) {
  const s = Math.max(0, Math.min(100, score));
  return [...TRUST_RANKS].reverse().find(r => s >= r.min) ?? TRUST_RANKS[0];
}

/**
 * Add a trust score action, updating score and recording history.
 * Returns the new score.
 */
export async function addTrustAction(
  db: D1Database,
  userId: number,
  action: string,
  delta: number,
  description: string,
): Promise<number> {
  // Get or create trust_scores row
  let row = await db.prepare(`SELECT * FROM trust_scores WHERE userId=?`).bind(userId).first<any>();
  let currentScore = row?.score ?? 0;
  const newScore = Math.max(0, Math.min(100, currentScore + delta));
  const rank = getTrustRank(newScore);

  if (row) {
    await db.prepare(`UPDATE trust_scores SET score=?, rank=?, updatedAt=datetime('now') WHERE userId=?`)
      .bind(newScore, rank.rank, userId).run();
  } else {
    await db.prepare(`INSERT INTO trust_scores (userId, score, rank) VALUES (?,?,?)`)
      .bind(userId, newScore, rank.rank).run();
  }

  // Record history
  await db.prepare(
    `INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (?,?,?,?,?)`
  ).bind(userId, action, delta, newScore, description).run();

  return newScore;
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
