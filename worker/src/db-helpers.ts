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

CREATE TABLE IF NOT EXISTS notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  notificationType TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  frequency TEXT NOT NULL DEFAULT 'immediate',
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(userId, notificationType)
);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_userId ON notification_preferences(userId);

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

CREATE TABLE IF NOT EXISTS cross_culture_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  friendCulture TEXT,
  culturePoints TEXT NOT NULL DEFAULT '[]',
  gapAlerts TEXT DEFAULT '[]',
  crossCultureScore INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS twin_knowledge_graphs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  gaps TEXT DEFAULT '[]',
  recommendations TEXT DEFAULT '[]',
  stats TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, twinId)
);

CREATE TABLE IF NOT EXISTS second_opinions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  optimistic TEXT,
  pessimistic TEXT,
  practical TEXT,
  divergenceScore REAL DEFAULT 0,
  consensusScore REAL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS negotiation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  opponentRole TEXT,
  score INTEGER,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  personaId INTEGER,
  createdAt TEXT DEFAULT (datetime('now')),
  completedAt TEXT
);

CREATE TABLE IF NOT EXISTS negotiation_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negotiationId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_emotion_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  speaker TEXT,
  sentiment TEXT,
  emotion TEXT,
  confidence INTEGER DEFAULT 50,
  intensity INTEGER DEFAULT 50,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, turnNumber)
);

CREATE TABLE IF NOT EXISTS smart_matching_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  recommendations TEXT,
  generatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId)
);

CREATE TABLE IF NOT EXISTS matching_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  highlights TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId)
);

CREATE TABLE IF NOT EXISTS twin_evolution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  eventType TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  eventData TEXT,
  eventDate TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creatorId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  startsAt TEXT DEFAULT (datetime('now')),
  endsAt TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS challenge_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challengeId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  sessionId INTEGER,
  score INTEGER,
  pointsAwarded INTEGER DEFAULT 0,
  joinedAt TEXT DEFAULT (datetime('now')),
  submittedAt TEXT,
  UNIQUE(challengeId, userId)
);

CREATE TABLE IF NOT EXISTS matching_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  theme TEXT,
  strategy TEXT,
  notes TEXT,
  review TEXT,
  effectiveness TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_collaborations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  topic TEXT NOT NULL,
  twinIds TEXT NOT NULL,
  twinNames TEXT,
  analysis TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_collaboration_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collaborationId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  twinName TEXT,
  content TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  dueDate TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  outcomeType TEXT NOT NULL,
  description TEXT,
  monetaryValue REAL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  scores TEXT,
  overallQuality INTEGER DEFAULT 0,
  strengths TEXT,
  weaknesses TEXT,
  improvements TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS knowledge_graphs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  graphData TEXT,
  generatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(twinId)
);

CREATE TABLE IF NOT EXISTS matching_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  period TEXT NOT NULL DEFAULT 'weekly',
  digestData TEXT,
  generatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_playbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  customTips TEXT,
  isShared INTEGER DEFAULT 0,
  shareCode TEXT,
  useCount INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_style_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  analysis TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, twinId)
);

CREATE TABLE IF NOT EXISTS matching_network_graphs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  graphData TEXT,
  communities TEXT,
  bridgeUsers TEXT,
  suggestions TEXT,
  generatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId)
);

CREATE TABLE IF NOT EXISTS twin_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  sourceType TEXT NOT NULL,
  sourceId INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  isPinned INTEGER DEFAULT 0,
  importance INTEGER DEFAULT 5,
  tags TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  sessionIds TEXT NOT NULL,
  comparison TEXT,
  bestSettingAdvice TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  widgetType TEXT NOT NULL,
  title TEXT NOT NULL,
  config TEXT,
  position INTEGER DEFAULT 0,
  isVisible INTEGER DEFAULT 1,
  isShared INTEGER DEFAULT 0,
  shareCode TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  summary TEXT,
  decisions TEXT,
  actionItems TEXT,
  nextAgenda TEXT,
  markdownContent TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS twin_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  label TEXT,
  personality TEXT,
  description TEXT,
  systemPrompt TEXT,
  tags TEXT,
  diff TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roi_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  targetAmount REAL DEFAULT 0,
  targetMatchCount INTEGER DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'monthly',
  label TEXT,
  currentAmount REAL DEFAULT 0,
  currentMatchCount INTEGER DEFAULT 0,
  milestones TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_coaching_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  personalityBefore TEXT,
  personalityAfter TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_coaching_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL,
  scheduledAt TEXT NOT NULL,
  notes TEXT,
  settings TEXT,
  status TEXT DEFAULT 'scheduled',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  eventId INTEGER NOT NULL,
  reminderAt TEXT NOT NULL,
  channel TEXT DEFAULT 'app',
  isSent INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sandbox_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  opponentPersonality TEXT,
  opponentDescription TEXT,
  turnCount INTEGER DEFAULT 5,
  dialogues TEXT,
  result TEXT,
  settings TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_peer_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  reviewerId INTEGER NOT NULL,
  targetUserId INTEGER NOT NULL,
  persuasion INTEGER DEFAULT 0,
  sincerity INTEGER DEFAULT 0,
  expertise INTEGER DEFAULT 0,
  flexibility INTEGER DEFAULT 0,
  originality INTEGER DEFAULT 0,
  comment TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, reviewerId, targetUserId)
);

CREATE TABLE IF NOT EXISTS twin_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  benchmarkData TEXT,
  percentiles TEXT,
  weaknesses TEXT,
  topPatterns TEXT,
  improvements TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debate_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  topic TEXT NOT NULL,
  stance TEXT NOT NULL DEFAULT 'pro',
  opponentUserId INTEGER,
  dialogues TEXT,
  judgeResult TEXT,
  status TEXT DEFAULT 'completed',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debate_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  totalScore INTEGER DEFAULT 0,
  bestArguments TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId)
);

CREATE TABLE IF NOT EXISTS emotion_journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  sourceType TEXT NOT NULL,
  sourceId INTEGER,
  emotions TEXT NOT NULL,
  dominantEmotion TEXT,
  intensity REAL DEFAULT 0.5,
  context TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emotion_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  alertType TEXT NOT NULL,
  message TEXT,
  suggestion TEXT,
  isRead INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organizerId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  theme TEXT,
  maxParticipants INTEGER DEFAULT 10,
  scheduledAt TEXT NOT NULL,
  status TEXT DEFAULT 'upcoming',
  settings TEXT,
  reportData TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_event_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  matchingScore INTEGER,
  rank INTEGER,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(eventId, userId)
);

CREATE TABLE IF NOT EXISTS replay_commentaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  commentaries TEXT NOT NULL,
  shareCode TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS twin_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  goalType TEXT NOT NULL,
  title TEXT NOT NULL,
  targetValue REAL NOT NULL,
  currentValue REAL DEFAULT 0,
  unit TEXT,
  deadline TEXT,
  status TEXT DEFAULT 'active',
  milestones TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_heatmap_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  heatmapData TEXT NOT NULL,
  clusters TEXT,
  weaknesses TEXT,
  suggestions TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_storyboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  keyMoments TEXT,
  characters TEXT,
  structure TEXT,
  shareCode TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS storyboard_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  storyIds TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  knowledgeId INTEGER,
  question TEXT NOT NULL,
  choices TEXT NOT NULL,
  correctIndex INTEGER NOT NULL,
  explanation TEXT,
  difficulty TEXT DEFAULT 'normal',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  quizId INTEGER NOT NULL,
  selectedIndex INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  timeTakenMs INTEGER,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facilitator_interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  interventionType TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  accepted INTEGER DEFAULT 0,
  effectScore REAL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS persona_ab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  personaIds TEXT NOT NULL,
  results TEXT,
  bestPersonaId INTEGER,
  status TEXT DEFAULT 'pending',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  tag TEXT NOT NULL,
  category TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, tag)
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  weekStart TEXT NOT NULL,
  weekEnd TEXT NOT NULL,
  summary TEXT NOT NULL,
  improvements TEXT,
  deteriorations TEXT,
  recommendations TEXT,
  stats TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, weekStart)
);

CREATE TABLE IF NOT EXISTS theme_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER,
  recommendations TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS theme_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  theme TEXT NOT NULL,
  sessionCount INTEGER DEFAULT 0,
  avgScore REAL DEFAULT 0,
  maxScore REAL DEFAULT 0,
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, theme)
);

CREATE TABLE IF NOT EXISTS dialogue_style_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  styleProfile TEXT NOT NULL,
  samplePhrases TEXT,
  analysisSource TEXT,
  appliedToPrompt INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, twinId)
);

CREATE TABLE IF NOT EXISTS success_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  patternType TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  examples TEXT,
  sourceSessionIds TEXT,
  effectiveness REAL,
  tags TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactive_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER,
  theme TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  dialogue TEXT DEFAULT '[]',
  choices TEXT DEFAULT '[]',
  analysisResult TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS personality_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  reportHtml TEXT NOT NULL,
  reportData TEXT NOT NULL,
  shareCode TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, twinId)
);

CREATE TABLE IF NOT EXISTS translation_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  originalText TEXT NOT NULL,
  translatedText TEXT,
  originalLang TEXT,
  targetLang TEXT,
  qualityRating TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS translation_chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  userLang TEXT DEFAULT 'ja',
  friendLang TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active',
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, friendId)
);

CREATE TABLE IF NOT EXISTS matching_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  summary TEXT NOT NULL,
  agreements TEXT,
  openIssues TEXT,
  nextSteps TEXT,
  risks TEXT,
  feedbackRating TEXT,
  distributedTo TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS context_switch_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  ruleName TEXT NOT NULL,
  conditionType TEXT NOT NULL,
  conditionValue TEXT NOT NULL,
  actionType TEXT NOT NULL,
  actionValue TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  isActive INTEGER DEFAULT 1,
  applyCount INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context_switch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruleId INTEGER NOT NULL,
  sessionId INTEGER,
  matchedCondition TEXT,
  appliedAction TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comparison_timelines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  sessionIdA INTEGER NOT NULL,
  sessionIdB INTEGER NOT NULL,
  comparison TEXT NOT NULL,
  turnAnalysis TEXT,
  overallVerdict TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_curricula (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL,
  diagnosis TEXT,
  lessons TEXT NOT NULL,
  currentLessonIndex INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','paused')),
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS curriculum_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculumId INTEGER NOT NULL,
  lessonIndex INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
  score INTEGER,
  feedback TEXT,
  completedAt TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(curriculumId, lessonIndex)
);

CREATE TABLE IF NOT EXISTS emotion_flow_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  emotionData TEXT NOT NULL,
  transitionPoints TEXT,
  syncScore REAL,
  summary TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS external_connectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  serviceType TEXT NOT NULL CHECK(serviceType IN ('google_calendar','notion','slack','github','custom')),
  serviceName TEXT NOT NULL,
  config TEXT,
  syncSchedule TEXT DEFAULT 'manual' CHECK(syncSchedule IN ('manual','daily','weekly')),
  lastSyncAt TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','error')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connector_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connectorId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  itemsSynced INTEGER DEFAULT 0,
  itemsAdded INTEGER DEFAULT 0,
  itemsUpdated INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success' CHECK(status IN ('success','partial','error')),
  errorMessage TEXT,
  syncedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS multi_perspective_replays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  perspectives TEXT NOT NULL,
  perspectiveGap TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS learning_journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  sessionId INTEGER,
  entryType TEXT DEFAULT 'reflection' CHECK(entryType IN ('reflection','milestone','insight','monthly_report')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  lessons TEXT,
  failures TEXT,
  improvements TEXT,
  aiSummary TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journalEntryId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  comment TEXT NOT NULL,
  appliedToTwin INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme TEXT NOT NULL,
  creatorUserId INTEGER NOT NULL,
  teamAMembers TEXT NOT NULL,
  teamBMembers TEXT NOT NULL,
  teamAStrategy TEXT,
  teamBStrategy TEXT,
  dialogue TEXT,
  result TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_battle_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battleId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  team TEXT NOT NULL CHECK(team IN ('A','B')),
  role TEXT DEFAULT 'supporter' CHECK(role IN ('leader','supporter','specialist')),
  UNIQUE(battleId, userId)
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER,
  userId INTEGER NOT NULL,
  friendId INTEGER,
  riskLevel TEXT NOT NULL CHECK(riskLevel IN ('high','medium','low')),
  risks TEXT NOT NULL,
  mitigations TEXT,
  verified INTEGER DEFAULT 0,
  actualOutcome TEXT,
  accuracy INTEGER,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  scene TEXT NOT NULL CHECK(scene IN ('sales','presentation','complaint','interview')),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('beginner','intermediate','advanced')),
  roleName TEXT NOT NULL,
  dialogue TEXT,
  coachingHints TEXT,
  evaluation TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS impact_map_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  sessionId INTEGER,
  outcomeType TEXT NOT NULL CHECK(outcomeType IN ('deal','partnership','introduction','idea','meeting','other')),
  title TEXT NOT NULL,
  description TEXT,
  monetaryValue REAL DEFAULT 0,
  linkedEntryId INTEGER,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS impact_map_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  period TEXT NOT NULL,
  reportData TEXT NOT NULL,
  totalImpactScore REAL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS strategy_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  tag TEXT NOT NULL CHECK(tag IN ('attack','defend','empathy','gather','propose','consensus','avoid')),
  comment TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, turnNumber, userId)
);

CREATE TABLE IF NOT EXISTS twin_clones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceType TEXT NOT NULL CHECK(sourceType IN ('clone','fork')),
  sourceTwinId INTEGER NOT NULL,
  sourceUserId INTEGER NOT NULL,
  clonedTwinId INTEGER NOT NULL,
  clonedByUserId INTEGER NOT NULL,
  diffLog TEXT DEFAULT '[]',
  feedbackMessage TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dialogue_quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  turnScores TEXT NOT NULL DEFAULT '[]',
  overallScores TEXT,
  improvementHints TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS rehearsal_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  friendId INTEGER,
  theme TEXT NOT NULL,
  dialogue TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed')),
  readinessScore INTEGER,
  evaluation TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consensus_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  agreements TEXT NOT NULL DEFAULT '[]',
  disagreements TEXT NOT NULL DEFAULT '[]',
  consensusRate REAL DEFAULT 0,
  followUpTasks TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS emotion_calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  empathy INTEGER NOT NULL DEFAULT 50 CHECK(empathy BETWEEN 0 AND 100),
  aggression INTEGER NOT NULL DEFAULT 20 CHECK(aggression BETWEEN 0 AND 100),
  optimism INTEGER NOT NULL DEFAULT 60 CHECK(optimism BETWEEN 0 AND 100),
  caution INTEGER NOT NULL DEFAULT 50 CHECK(caution BETWEEN 0 AND 100),
  humor INTEGER NOT NULL DEFAULT 40 CHECK(humor BETWEEN 0 AND 100),
  presetName TEXT,
  targetFriendId INTEGER,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS trust_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER NOT NULL,
  trustLevel INTEGER NOT NULL DEFAULT 1 CHECK(trustLevel BETWEEN 1 AND 5),
  matchCount INTEGER NOT NULL DEFAULT 0,
  unlockedThemes TEXT DEFAULT '[]',
  achievements TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, friendId)
);

CREATE TABLE IF NOT EXISTS multimodal_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  inputType TEXT NOT NULL CHECK(inputType IN ('voice','image','screenshot')),
  rawContent TEXT,
  processedText TEXT,
  knowledgeEntryId INTEGER,
  accuracy REAL,
  feedbackRating TEXT CHECK(feedbackRating IN ('good','bad',NULL)),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brainstorm_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  friendId INTEGER,
  theme TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'diverge' CHECK(phase IN ('diverge','converge','complete')),
  ideas TEXT NOT NULL DEFAULT '[]',
  clusters TEXT DEFAULT '[]',
  topPlans TEXT DEFAULT '[]',
  evaluation TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_voice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  turnNumber INTEGER,
  userId INTEGER NOT NULL,
  transcript TEXT NOT NULL,
  summary TEXT,
  actionItems TEXT,
  duration INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS twin_faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twinId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  isPublic INTEGER DEFAULT 1,
  sortOrder INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  briefingDate TEXT NOT NULL,
  content TEXT NOT NULL,
  recommendations TEXT,
  followUps TEXT,
  isDismissed INTEGER DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, briefingDate)
);

CREATE TABLE IF NOT EXISTS session_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  category TEXT DEFAULT 'default',
  note TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(sessionId, userId)
);

CREATE TABLE IF NOT EXISTS twin_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  twinId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  systemPrompt TEXT,
  tags TEXT,
  isPublic INTEGER DEFAULT 0,
  useCount INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS action_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL,
  items TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS matching_streaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  currentStreak INTEGER NOT NULL DEFAULT 0,
  longestStreak INTEGER NOT NULL DEFAULT 0,
  lastMatchDate TEXT,
  totalBonusEarned INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matching_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  achievementKey TEXT NOT NULL,
  unlockedAt TEXT DEFAULT (datetime('now')),
  claimed INTEGER NOT NULL DEFAULT 0,
  claimedAt TEXT,
  UNIQUE(userId, achievementKey)
);

CREATE TABLE IF NOT EXISTS friend_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  activityType TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_friend_activities_userId ON friend_activities(userId);
CREATE INDEX IF NOT EXISTS idx_friend_activities_createdAt ON friend_activities(createdAt);

CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'error',
  path TEXT,
  message TEXT,
  context TEXT,
  userId INTEGER,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(createdAt);

ALTER TABLE users ADD COLUMN subscriptionStatus TEXT;
ALTER TABLE users ADD COLUMN paymentFailedAt TEXT;

-- Note: SQLite doesn't support ALTER TABLE ADD CONSTRAINT, but we can enforce via triggers
-- For new inserts we use CHECK constraints on the table definition.
-- Since tables already exist, we add validation via INSERT/UPDATE triggers.

CREATE TRIGGER IF NOT EXISTS trg_users_plan_check
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.plan IS NOT NULL AND NEW.plan NOT IN ('free', 'premium', 'enterprise')
BEGIN
  SELECT RAISE(ABORT, 'Invalid plan value');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_plan_check_update
BEFORE UPDATE OF plan ON users
FOR EACH ROW
WHEN NEW.plan IS NOT NULL AND NEW.plan NOT IN ('free', 'premium', 'enterprise')
BEGIN
  SELECT RAISE(ABORT, 'Invalid plan value');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_role_check
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.role IS NOT NULL AND NEW.role NOT IN ('user', 'admin')
BEGIN
  SELECT RAISE(ABORT, 'Invalid role value');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_role_check_update
BEFORE UPDATE OF role ON users
FOR EACH ROW
WHEN NEW.role IS NOT NULL AND NEW.role NOT IN ('user', 'admin')
BEGIN
  SELECT RAISE(ABORT, 'Invalid role value');
END;

CREATE TRIGGER IF NOT EXISTS trg_friendships_status_check
BEFORE INSERT ON friendships
FOR EACH ROW
WHEN NEW.status NOT IN ('pending', 'accepted', 'rejected', 'blocked')
BEGIN
  SELECT RAISE(ABORT, 'Invalid friendship status');
END;

CREATE TRIGGER IF NOT EXISTS trg_friendships_status_check_update
BEFORE UPDATE OF status ON friendships
FOR EACH ROW
WHEN NEW.status NOT IN ('pending', 'accepted', 'rejected', 'blocked')
BEGIN
  SELECT RAISE(ABORT, 'Invalid friendship status');
END;

CREATE TRIGGER IF NOT EXISTS trg_matching_sessions_status_check
BEFORE INSERT ON matching_sessions
FOR EACH ROW
WHEN NEW.status NOT IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'Invalid matching session status');
END;

CREATE TRIGGER IF NOT EXISTS trg_matching_sessions_status_check_update
BEFORE UPDATE OF status ON matching_sessions
FOR EACH ROW
WHEN NEW.status NOT IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'Invalid matching session status');
END;
`;

// ============ Missing Indexes ============
// Adds indexes on FK / lookup columns not already covered by existing indexes or UNIQUE constraints.
// Convention: idx_tablename_column or idx_tablename_col1_col2 for composites.
const INDEX_SQL = `
-- SCHEMA_SQL tables --

-- chat_sessions: missing twinId (userId already indexed)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_twinId ON chat_sessions(twinId);

-- intimacy_scores: missing friendId (userId already indexed)
CREATE INDEX IF NOT EXISTS idx_intimacy_friendId ON intimacy_scores(friendId);
CREATE INDEX IF NOT EXISTS idx_intimacy_userId_friendId ON intimacy_scores(userId, friendId);

-- line_connections: missing userId
CREATE INDEX IF NOT EXISTS idx_line_connections_userId ON line_connections(userId);

-- point_redemptions: missing userId, status
CREATE INDEX IF NOT EXISTS idx_point_redemptions_userId ON point_redemptions(userId);
CREATE INDEX IF NOT EXISTS idx_point_redemptions_status ON point_redemptions(status);

-- twin_skill_levels: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_twin_skill_levels_twinId ON twin_skill_levels(twinId);
CREATE INDEX IF NOT EXISTS idx_twin_skill_levels_userId ON twin_skill_levels(userId);

-- twin_milestones: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_twin_milestones_twinId ON twin_milestones(twinId);
CREATE INDEX IF NOT EXISTS idx_twin_milestones_userId ON twin_milestones(userId);

-- conversation_learning: userId is UNIQUE, but twinId is not indexed
CREATE INDEX IF NOT EXISTS idx_conversation_learning_twinId ON conversation_learning(twinId);

-- ai_provider_settings: missing userId
CREATE INDEX IF NOT EXISTS idx_ai_provider_settings_userId ON ai_provider_settings(userId);

-- persona_reviews: (templateId, userId) is UNIQUE — templateId covered, need userId alone
CREATE INDEX IF NOT EXISTS idx_persona_reviews_userId ON persona_reviews(userId);

-- moderation_actions: missing adminUserId
CREATE INDEX IF NOT EXISTS idx_moderation_actions_adminUserId ON moderation_actions(adminUserId);

-- content_reports: has status, missing reporterUserId
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporterUserId);

-- matching_session_participants: has sessionId, missing userId
CREATE INDEX IF NOT EXISTS idx_msp_userId ON matching_session_participants(userId);

-- matching_comments: has sessionId, missing userId
CREATE INDEX IF NOT EXISTS idx_matching_comments_userId ON matching_comments(userId);

-- value_scenario_responses: has userId, missing twinId
CREATE INDEX IF NOT EXISTS idx_vsr_twinId ON value_scenario_responses(twinId);

-- cumulative_waveforms: has userId, missing twinId
CREATE INDEX IF NOT EXISTS idx_cum_waveforms_twinId ON cumulative_waveforms(twinId);

-- other_perspective_waveforms: has userId, missing twinId
CREATE INDEX IF NOT EXISTS idx_other_waveforms_twinId ON other_perspective_waveforms(twinId);

-- auto_matching_schedules: has userId, missing friendId
CREATE INDEX IF NOT EXISTS idx_auto_matching_friendId ON auto_matching_schedules(friendId);

-- uploaded_files: has userId, missing twinId
CREATE INDEX IF NOT EXISTS idx_uploaded_files_twinId ON uploaded_files(twinId);

-- matching_sessions: add status index for common WHERE status=X queries
CREATE INDEX IF NOT EXISTS idx_matching_sessions_status ON matching_sessions(status);

-- friendships: add status index for WHERE status='accepted' queries
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- error_logs: missing userId
CREATE INDEX IF NOT EXISTS idx_error_logs_userId ON error_logs(userId);

-- MIGRATIONS_SQL tables --

-- feed_likes: (feedItemId, userId) is UNIQUE — feedItemId covered, need userId alone
CREATE INDEX IF NOT EXISTS idx_feed_likes_userId ON feed_likes(userId);

-- matching_template_uses: missing templateId, userId
CREATE INDEX IF NOT EXISTS idx_matching_template_uses_templateId ON matching_template_uses(templateId);
CREATE INDEX IF NOT EXISTS idx_matching_template_uses_userId ON matching_template_uses(userId);

-- twin_personas: missing twinId
CREATE INDEX IF NOT EXISTS idx_twin_personas_twinId ON twin_personas(twinId);

-- workspace_board_items: missing workspaceId, userId
CREATE INDEX IF NOT EXISTS idx_ws_board_items_ws ON workspace_board_items(workspaceId);
CREATE INDEX IF NOT EXISTS idx_ws_board_items_userId ON workspace_board_items(userId);

-- negotiation_sessions: missing userId, status
CREATE INDEX IF NOT EXISTS idx_negotiation_sessions_userId ON negotiation_sessions(userId);
CREATE INDEX IF NOT EXISTS idx_negotiation_sessions_status ON negotiation_sessions(status);

-- negotiation_turns: missing negotiationId
CREATE INDEX IF NOT EXISTS idx_negotiation_turns_negotiationId ON negotiation_turns(negotiationId);

-- twin_evolution_events: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_twin_evolution_events_twinId ON twin_evolution_events(twinId);
CREATE INDEX IF NOT EXISTS idx_twin_evolution_events_userId ON twin_evolution_events(userId);

-- matching_challenges: missing creatorId, status
CREATE INDEX IF NOT EXISTS idx_matching_challenges_creatorId ON matching_challenges(creatorId);
CREATE INDEX IF NOT EXISTS idx_matching_challenges_status ON matching_challenges(status);

-- challenge_participants: (challengeId, userId) is UNIQUE — need userId alone
CREATE INDEX IF NOT EXISTS idx_challenge_participants_userId ON challenge_participants(userId);

-- matching_strategies: missing userId, friendId
CREATE INDEX IF NOT EXISTS idx_matching_strategies_userId ON matching_strategies(userId);
CREATE INDEX IF NOT EXISTS idx_matching_strategies_friendId ON matching_strategies(friendId);

-- twin_collaborations: missing userId
CREATE INDEX IF NOT EXISTS idx_twin_collaborations_userId ON twin_collaborations(userId);

-- twin_collaboration_turns: missing collaborationId
CREATE INDEX IF NOT EXISTS idx_twin_collab_turns_collaborationId ON twin_collaboration_turns(collaborationId);

-- matching_action_items: missing sessionId, userId, status
CREATE INDEX IF NOT EXISTS idx_matching_action_items_sessionId ON matching_action_items(sessionId);
CREATE INDEX IF NOT EXISTS idx_matching_action_items_userId ON matching_action_items(userId);
CREATE INDEX IF NOT EXISTS idx_matching_action_items_status ON matching_action_items(status);

-- matching_outcomes: missing sessionId, userId
CREATE INDEX IF NOT EXISTS idx_matching_outcomes_sessionId ON matching_outcomes(sessionId);
CREATE INDEX IF NOT EXISTS idx_matching_outcomes_userId ON matching_outcomes(userId);

-- matching_digests: missing userId
CREATE INDEX IF NOT EXISTS idx_matching_digests_userId ON matching_digests(userId);

-- matching_playbooks: missing userId
CREATE INDEX IF NOT EXISTS idx_matching_playbooks_userId ON matching_playbooks(userId);

-- twin_memories: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_twin_memories_twinId ON twin_memories(twinId);
CREATE INDEX IF NOT EXISTS idx_twin_memories_userId ON twin_memories(userId);

-- scenario_comparisons: missing userId
CREATE INDEX IF NOT EXISTS idx_scenario_comparisons_userId ON scenario_comparisons(userId);

-- custom_widgets: missing userId
CREATE INDEX IF NOT EXISTS idx_custom_widgets_userId ON custom_widgets(userId);

-- twin_versions: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_twin_versions_twinId ON twin_versions(twinId);
CREATE INDEX IF NOT EXISTS idx_twin_versions_userId ON twin_versions(userId);

-- roi_goals: missing userId
CREATE INDEX IF NOT EXISTS idx_roi_goals_userId ON roi_goals(userId);

-- twin_coaching_sessions: missing twinId, userId, status
CREATE INDEX IF NOT EXISTS idx_twin_coaching_sessions_twinId ON twin_coaching_sessions(twinId);
CREATE INDEX IF NOT EXISTS idx_twin_coaching_sessions_userId ON twin_coaching_sessions(userId);
CREATE INDEX IF NOT EXISTS idx_twin_coaching_sessions_status ON twin_coaching_sessions(status);

-- twin_coaching_messages: missing sessionId
CREATE INDEX IF NOT EXISTS idx_twin_coaching_messages_sessionId ON twin_coaching_messages(sessionId);

-- matching_calendar_events: missing userId, status
CREATE INDEX IF NOT EXISTS idx_matching_calendar_events_userId ON matching_calendar_events(userId);
CREATE INDEX IF NOT EXISTS idx_matching_calendar_events_status ON matching_calendar_events(status);

-- matching_reminders: missing userId, eventId
CREATE INDEX IF NOT EXISTS idx_matching_reminders_userId ON matching_reminders(userId);
CREATE INDEX IF NOT EXISTS idx_matching_reminders_eventId ON matching_reminders(eventId);

-- sandbox_sessions: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_userId ON sandbox_sessions(userId);
CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_twinId ON sandbox_sessions(twinId);

-- twin_benchmarks: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_twin_benchmarks_userId ON twin_benchmarks(userId);
CREATE INDEX IF NOT EXISTS idx_twin_benchmarks_twinId ON twin_benchmarks(twinId);

-- debate_sessions: missing userId
CREATE INDEX IF NOT EXISTS idx_debate_sessions_userId ON debate_sessions(userId);

-- emotion_journal_entries: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_emotion_journal_entries_userId ON emotion_journal_entries(userId);
CREATE INDEX IF NOT EXISTS idx_emotion_journal_entries_twinId ON emotion_journal_entries(twinId);

-- emotion_alerts: missing userId
CREATE INDEX IF NOT EXISTS idx_emotion_alerts_userId ON emotion_alerts(userId);

-- community_events: missing organizerId, status
CREATE INDEX IF NOT EXISTS idx_community_events_organizerId ON community_events(organizerId);
CREATE INDEX IF NOT EXISTS idx_community_events_status ON community_events(status);

-- twin_goals: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_twin_goals_userId ON twin_goals(userId);
CREATE INDEX IF NOT EXISTS idx_twin_goals_twinId ON twin_goals(twinId);

-- matching_heatmap_analyses: missing userId
CREATE INDEX IF NOT EXISTS idx_matching_heatmap_analyses_userId ON matching_heatmap_analyses(userId);

-- storyboard_collections: missing userId
CREATE INDEX IF NOT EXISTS idx_storyboard_collections_userId ON storyboard_collections(userId);

-- knowledge_quizzes: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_knowledge_quizzes_userId ON knowledge_quizzes(userId);
CREATE INDEX IF NOT EXISTS idx_knowledge_quizzes_twinId ON knowledge_quizzes(twinId);

-- quiz_attempts: missing userId, quizId
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_userId ON quiz_attempts(userId);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quizId ON quiz_attempts(quizId);

-- facilitator_interventions: missing sessionId
CREATE INDEX IF NOT EXISTS idx_facilitator_interventions_sessionId ON facilitator_interventions(sessionId);

-- persona_ab_tests: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_persona_ab_tests_userId ON persona_ab_tests(userId);
CREATE INDEX IF NOT EXISTS idx_persona_ab_tests_twinId ON persona_ab_tests(twinId);

-- session_tags: (sessionId, tag) is UNIQUE — need userId alone
CREATE INDEX IF NOT EXISTS idx_session_tags_userId ON session_tags(userId);

-- theme_recommendations: missing userId
CREATE INDEX IF NOT EXISTS idx_theme_recommendations_userId ON theme_recommendations(userId);

-- success_patterns: missing userId
CREATE INDEX IF NOT EXISTS idx_success_patterns_userId ON success_patterns(userId);

-- interactive_scenarios: missing userId, status
CREATE INDEX IF NOT EXISTS idx_interactive_scenarios_userId ON interactive_scenarios(userId);
CREATE INDEX IF NOT EXISTS idx_interactive_scenarios_status ON interactive_scenarios(status);

-- translation_chat_messages: missing sessionId
CREATE INDEX IF NOT EXISTS idx_translation_chat_messages_sessionId ON translation_chat_messages(sessionId);

-- context_switch_rules: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_context_switch_rules_userId ON context_switch_rules(userId);
CREATE INDEX IF NOT EXISTS idx_context_switch_rules_twinId ON context_switch_rules(twinId);

-- context_switch_logs: missing ruleId
CREATE INDEX IF NOT EXISTS idx_context_switch_logs_ruleId ON context_switch_logs(ruleId);

-- comparison_timelines: missing userId
CREATE INDEX IF NOT EXISTS idx_comparison_timelines_userId ON comparison_timelines(userId);

-- learning_curricula: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_learning_curricula_twinId ON learning_curricula(twinId);
CREATE INDEX IF NOT EXISTS idx_learning_curricula_userId ON learning_curricula(userId);

-- curriculum_progress: (curriculumId, lessonIndex) is UNIQUE — curriculumId covered, add status index
CREATE INDEX IF NOT EXISTS idx_curriculum_progress_status ON curriculum_progress(status);

-- external_connectors: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_external_connectors_userId ON external_connectors(userId);
CREATE INDEX IF NOT EXISTS idx_external_connectors_twinId ON external_connectors(twinId);

-- connector_sync_logs: missing connectorId, userId
CREATE INDEX IF NOT EXISTS idx_connector_sync_logs_connectorId ON connector_sync_logs(connectorId);
CREATE INDEX IF NOT EXISTS idx_connector_sync_logs_userId ON connector_sync_logs(userId);

-- learning_journal_entries: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_learning_journal_entries_twinId ON learning_journal_entries(twinId);
CREATE INDEX IF NOT EXISTS idx_learning_journal_entries_userId ON learning_journal_entries(userId);

-- journal_comments: missing journalEntryId
CREATE INDEX IF NOT EXISTS idx_journal_comments_journalEntryId ON journal_comments(journalEntryId);

-- team_battles: missing creatorUserId, status
CREATE INDEX IF NOT EXISTS idx_team_battles_creatorUserId ON team_battles(creatorUserId);
CREATE INDEX IF NOT EXISTS idx_team_battles_status ON team_battles(status);

-- risk_assessments: missing userId, sessionId
CREATE INDEX IF NOT EXISTS idx_risk_assessments_userId ON risk_assessments(userId);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_sessionId ON risk_assessments(sessionId);

-- roleplay_sessions: missing twinId, userId
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_twinId ON roleplay_sessions(twinId);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_userId ON roleplay_sessions(userId);

-- impact_map_entries: missing userId, sessionId
CREATE INDEX IF NOT EXISTS idx_impact_map_entries_userId ON impact_map_entries(userId);
CREATE INDEX IF NOT EXISTS idx_impact_map_entries_sessionId ON impact_map_entries(sessionId);

-- impact_map_reports: missing userId
CREATE INDEX IF NOT EXISTS idx_impact_map_reports_userId ON impact_map_reports(userId);

-- twin_clones: missing sourceTwinId, clonedByUserId
CREATE INDEX IF NOT EXISTS idx_twin_clones_sourceTwinId ON twin_clones(sourceTwinId);
CREATE INDEX IF NOT EXISTS idx_twin_clones_clonedByUserId ON twin_clones(clonedByUserId);

-- rehearsal_sessions: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_rehearsal_sessions_userId ON rehearsal_sessions(userId);
CREATE INDEX IF NOT EXISTS idx_rehearsal_sessions_twinId ON rehearsal_sessions(twinId);

-- emotion_calibration: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_emotion_calibration_userId ON emotion_calibration(userId);
CREATE INDEX IF NOT EXISTS idx_emotion_calibration_twinId ON emotion_calibration(twinId);

-- multimodal_inputs: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_multimodal_inputs_userId ON multimodal_inputs(userId);
CREATE INDEX IF NOT EXISTS idx_multimodal_inputs_twinId ON multimodal_inputs(twinId);

-- brainstorm_sessions: missing userId
CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_userId ON brainstorm_sessions(userId);

-- matching_voice_notes: missing sessionId, userId
CREATE INDEX IF NOT EXISTS idx_matching_voice_notes_sessionId ON matching_voice_notes(sessionId);
CREATE INDEX IF NOT EXISTS idx_matching_voice_notes_userId ON matching_voice_notes(userId);

-- twin_faqs: missing twinId
CREATE INDEX IF NOT EXISTS idx_twin_faqs_twinId ON twin_faqs(twinId);

-- twin_templates: missing userId, twinId
CREATE INDEX IF NOT EXISTS idx_twin_templates_userId ON twin_templates(userId);
CREATE INDEX IF NOT EXISTS idx_twin_templates_twinId ON twin_templates(twinId);

-- action_plans: missing sessionId, userId
CREATE INDEX IF NOT EXISTS idx_action_plans_sessionId ON action_plans(sessionId);
CREATE INDEX IF NOT EXISTS idx_action_plans_userId ON action_plans(userId);

-- tournaments: missing createdBy, status
CREATE INDEX IF NOT EXISTS idx_tournaments_createdBy ON tournaments(createdBy);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- tournament_matches: missing status
CREATE INDEX IF NOT EXISTS idx_tournament_matches_status ON tournament_matches(status);

-- cross_culture_analyses: (sessionId, userId) is UNIQUE — add userId alone for user lookups
CREATE INDEX IF NOT EXISTS idx_cross_culture_analyses_userId ON cross_culture_analyses(userId);

-- matching_predictions: missing friendId
CREATE INDEX IF NOT EXISTS idx_matching_predictions_friendId ON matching_predictions(friendId);
`;

let schemaReady = false;

/**
 * Split multi-statement SQL into individual statements and run them via batch().
 * D1's exec() can crash with metadata aggregation errors on large schemas,
 * so we use prepare().run() for each statement via batch().
 * Handles BEGIN...END blocks (e.g. triggers) that contain inner semicolons.
 */
function splitStatements(sql: string): string[] {
  const results: string[] = [];
  let current = "";
  let inBlock = false;

  for (const part of sql.split(";")) {
    const trimmed = part.trim();
    if (!trimmed && !inBlock) continue;

    if (inBlock) {
      current += ";" + part;
      // Check if this part closes the BEGIN block (END on its own line)
      if (/\bEND\s*$/i.test(trimmed)) {
        results.push(current.trim());
        current = "";
        inBlock = false;
      }
    } else if (/\bBEGIN\s*$/im.test(trimmed)) {
      // This part opens a BEGIN block — accumulate until END
      current = part.trim();
      inBlock = true;
    } else if (trimmed.length > 0) {
      results.push(trimmed);
    }
  }

  // If anything remains (shouldn't normally happen), push it
  if (current.trim().length > 0) {
    results.push(current.trim());
  }

  return results;
}

export async function ensureSchema(db: D1Database) {
  if (schemaReady) return;

  // 1. Core schema (CREATE TABLE/INDEX IF NOT EXISTS — always safe to re-run)
  const stmts = splitStatements(SCHEMA_SQL);
  await db.batch(stmts.map((s) => db.prepare(s)));

  // 2. Migrations with tracking (ALTER TABLE etc. — only run once)
  const migrations = splitStatements(MIGRATIONS_SQL);

  // Get already-applied migration versions
  let applied = new Set<string>();
  try {
    const rows = await db.prepare(`SELECT version FROM schema_migrations`).all<{ version: string }>();
    for (const r of rows.results ?? []) applied.add(r.version);
  } catch {
    // Table might not exist yet on very first run — will be created by SCHEMA_SQL above
  }

  // Run only unapplied migrations
  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i];
    const version = `m${String(i).padStart(4, "0")}`;
    if (applied.has(version)) continue;
    try {
      await db.prepare(m).run();
      await db.prepare(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`).bind(version).run();
    } catch {
      // Column already exists or table already exists — record as applied anyway
      try {
        await db.prepare(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`).bind(version).run();
      } catch { /* ignore */ }
    }
  }

  // 3. Indexes (CREATE INDEX IF NOT EXISTS — always safe to re-run)
  const indexStmts = splitStatements(INDEX_SQL);
  await db.batch(indexStmts.map((s) => db.prepare(s)));

  // Seed default redeemable products
  try {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO redeemable_products (id, name, description, pointCost, category, stockCount) VALUES (1, 'プレミアム1日体験', 'プレミアムプランを1日間体験できます', 100, 'plan_upgrade', 999)`),
      db.prepare(`INSERT OR IGNORE INTO redeemable_products (id, name, description, pointCost, category, stockCount) VALUES (2, 'マッチング追加枠', '今月のマッチング回数を1回追加', 50, 'matching_boost', 999)`),
      db.prepare(`INSERT OR IGNORE INTO redeemable_products (id, name, description, pointCost, category, stockCount) VALUES (3, 'カスタムテーマ', 'マッチング対話のカスタムテーマを作成', 30, 'customization', 999)`),
    ]);
  } catch { /* seed failures are non-critical */ }

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

/**
 * Record an activity for the friend activity timeline.
 * Silently fails to avoid blocking the calling operation.
 */
export async function recordFriendActivity(
  db: D1Database,
  userId: number,
  activityType: string,
  title: string,
  description?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO friend_activities (userId, activityType, title, description, metadata) VALUES (?, ?, ?, ?, ?)`
    ).bind(userId, activityType, title, description || null, metadata ? JSON.stringify(metadata) : "{}").run();
  } catch { /* non-critical — do not block caller */ }
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
