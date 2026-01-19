import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free", "premium", "enterprise"]).default("free").notNull(),
  friendCode: varchar("friendCode", { length: 8 }).unique(), // Unique code for adding friends
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }), // Stripe customer ID
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }), // Active subscription ID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * User profile with business information
 */
export const userProfiles = mysqlTable("user_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  displayName: varchar("displayName", { length: 255 }),
  bio: text("bio"),
  skills: json("skills").$type<string[]>(),
  experience: text("experience"),
  businessInfo: text("businessInfo"),
  expertise: json("expertise").$type<string[]>(),
  industry: varchar("industry", { length: 255 }),
  company: varchar("company", { length: 255 }),
  position: varchar("position", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

/**
 * Digital Twin AI (分身AI) - Each user has exactly ONE digital twin
 */
// ビッグ・ファイブ性格特性の型定義
export interface BigFiveTraits {
  openness: number; // 開放性 (0-100)
  conscientiousness: number; // 誠実性 (0-100)
  extraversion: number; // 外向性 (0-100)
  agreeableness: number; // 協調性 (0-100)
  neuroticism: number; // 神経症的傾向 (0-100)
}

// 9つの判断基準の閾値型定義
export interface JudgmentThresholds {
  goodEvil: number; // 善悪 (0-100: 0=厄いことに寛容, 100=厄いことに厳しい)
  likesDislike: number; // 好き嫌い (0-100: 0=何でもOK, 100=こだわりが強い)
  profitLoss: number; // 損得 (0-100: 0=損得気にしない, 100=損得重視)
  interest: number; // 利害 (0-100: 0=利害気にしない, 100=利害重視)
  pleasurePain: number; // 苦楽 (0-100: 0=苦労をいとわない, 100=楽さ重視)
  difficulty: number; // 難易 (0-100: 0=難しいことに挑戦, 100=簡単なことを好む)
  possibility: number; // 可否 (0-100: 0=何でも試す, 100=確実なことのみ)
  comfort: number; // 快不快 (0-100: 0=不快に寛容, 100=快適さ重視)
  rightWrong: number; // 正誤 (0-100: 0=曖昧さを許容, 100=正確さ重視)
}

// MBTI性格タイプの型定義
export interface MBTIType {
  type: string; // INTJ, ENFP, etc.
  dimensions: {
    EI: number; // -100 (Introvert) to +100 (Extravert)
    SN: number; // -100 (Sensing) to +100 (iNtuition)
    TF: number; // -100 (Thinking) to +100 (Feeling)
    JP: number; // -100 (Judging) to +100 (Perceiving)
  };
  description: string;
  strengths: string[];
  weaknesses: string[];
  compatibleTypes: string[];
  careerSuggestions: string[];
}

// 徳波形・地雷波形の型定義（特許ドキュメント準拠）
export interface ValueWaveform {
  // 各評価者（他の分身AI）からの評価結果
  evaluations: {
    evaluatorId: number; // 評価した分身AIのID
    evaluatorName: string; // 評価した分身AIの名前
    virtueScore: number; // 徳スコア (0-100)
    mineScore: number; // 地雷スコア (0-100)
    virtueReasons: string[]; // 徳と評価した理由
    mineReasons: string[]; // 地雷と評価した理由
    // 9つの判断基準に基づく評価
    judgmentScores: {
      goodEvil: number; // 善悪 (-100～100)
      likesDislike: number; // 好き嫌い (-100～100)
      profitLoss: number; // 損得 (-100～100)
      interest: number; // 利害 (-100～100)
      pleasurePain: number; // 苦楽 (-100～100)
      difficulty: number; // 難易 (-100～100)
      possibility: number; // 可否 (-100～100)
      comfort: number; // 快不快 (-100～100)
      rightWrong: number; // 正誤 (-100～100)
    };
  }[];
  // 総合スコア
  totalVirtueScore: number;
  totalMineScore: number;
  // 9つの判断基準の平均スコア
  averageJudgmentScores?: {
    goodEvil: number;
    likesDislike: number;
    profitLoss: number;
    interest: number;
    pleasurePain: number;
    difficulty: number;
    possibility: number;
    comfort: number;
    rightWrong: number;
  };
  lastUpdated: string; // ISO date string
}

export const digitalTwins = mysqlTable("digital_twins", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // UNIQUE: 1 user = 1 twin
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  personality: text("personality"),
  systemPrompt: text("systemPrompt"),
  rawInput: text("rawInput"), // User's raw input that AI will analyze
  status: mysqlEnum("status", ["active", "inactive", "training"]).default("inactive").notNull(),
  isPublic: int("isPublic").default(0).notNull(), // 0 = private, 1 = public (searchable)
  publicBio: text("publicBio"), // Short bio for public profile
  tags: json("tags").$type<string[]>(), // Tags for search/discovery
  // 人格評価システムのフィールド
  bigFiveTraits: json("bigFiveTraits").$type<BigFiveTraits>(), // ビッグ・ファイブ性格特性
  judgmentThresholds: json("judgmentThresholds").$type<JudgmentThresholds>(), // 9つの判断基準の閾値
  virtueWaveform: json("virtueWaveform").$type<ValueWaveform>(), // 徳波形 G+(U)
  mineWaveform: json("mineWaveform").$type<ValueWaveform>(), // 地雷波形 G-(U)
  mbtiType: json("mbtiType").$type<MBTIType>(), // MBTI性格タイプ
  personalitySimilarity: decimal("personalitySimilarity", { precision: 5, scale: 2 }), // ユーザーとの性格類似度 (0-100%)
  accuracyScore: decimal("accuracyScore", { precision: 5, scale: 2 }), // 分身AIの精度スコア (0-100%)
  trainingIterations: int("trainingIterations").default(0).notNull(), // 学習回数
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DigitalTwin = typeof digitalTwins.$inferSelect;
export type InsertDigitalTwin = typeof digitalTwins.$inferInsert;

/**
 * Friendships between users (友達関係)
 */
export const friendships = mysqlTable("friendships", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // The user who initiated or is part of the friendship
  friendId: int("friendId").notNull(), // The friend user
  status: mysqlEnum("status", ["pending", "accepted", "rejected", "blocked"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Friendship = typeof friendships.$inferSelect;
export type InsertFriendship = typeof friendships.$inferInsert;

/**
 * Knowledge base entries for digital twins
 */
export const knowledgeBase = mysqlTable("knowledge_base", {
  id: int("id").autoincrement().primaryKey(),
  twinId: int("twinId").notNull(),
  sourceType: mysqlEnum("sourceType", ["upload", "api", "manual"]).notNull(),
  sourceId: varchar("sourceId", { length: 255 }),
  title: varchar("title", { length: 500 }),
  content: text("content"),
  summary: text("summary"),
  embedding: json("embedding").$type<number[]>(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KnowledgeEntry = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeEntry = typeof knowledgeBase.$inferInsert;

/**
 * Uploaded files for knowledge base
 */
export const uploadedFiles = mysqlTable("uploaded_files", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId"),
  filename: varchar("filename", { length: 500 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  url: varchar("url", { length: 1000 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  size: int("size"),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type InsertUploadedFile = typeof uploadedFiles.$inferInsert;

/**
 * External AI API configurations
 */
export const aiApiConfigs = mysqlTable("ai_api_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["openai", "gemini", "anthropic", "grok"]).notNull(),
  apiKey: varchar("apiKey", { length: 500 }).notNull(),
  isActive: int("isActive").default(1).notNull(),
  lastValidated: timestamp("lastValidated"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiApiConfig = typeof aiApiConfigs.$inferSelect;
export type InsertAiApiConfig = typeof aiApiConfigs.$inferInsert;

/**
 * AI Orchestration roles configuration
 */
export const orchestrationRoles = mysqlTable("orchestration_roles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  roleName: varchar("roleName", { length: 255 }).notNull(),
  roleDescription: text("roleDescription"),
  assignedProvider: mysqlEnum("assignedProvider", ["openai", "gemini", "anthropic", "grok", "builtin"]).notNull(),
  assignedModel: varchar("assignedModel", { length: 255 }),
  priority: int("priority").default(1).notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OrchestrationRole = typeof orchestrationRoles.$inferSelect;
export type InsertOrchestrationRole = typeof orchestrationRoles.$inferInsert;

/**
 * Chat sessions with digital twins
 */
export const chatSessions = mysqlTable("chat_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  title: varchar("title", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * Chat messages
 */
export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Business matching sessions (友達の分身AI同士の対話)
 */
export const matchingSessions = mysqlTable("matching_sessions", {
  id: int("id").autoincrement().primaryKey(),
  initiatorUserId: int("initiatorUserId").notNull(), // User who started the matching
  twin1Id: int("twin1Id").notNull(), // Initiator's twin
  twin2Id: int("twin2Id").notNull(), // Friend's twin
  theme: varchar("theme", { length: 500 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type MatchingSession = typeof matchingSessions.$inferSelect;
export type InsertMatchingSession = typeof matchingSessions.$inferInsert;

/**
 * Matching dialogue messages
 */
export const matchingDialogues = mysqlTable("matching_dialogues", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  speakerTwinId: int("speakerTwinId").notNull(),
  content: text("content").notNull(),
  aiProvider: varchar("aiProvider", { length: 100 }),
  aiModel: varchar("aiModel", { length: 255 }),
  turnNumber: int("turnNumber").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MatchingDialogue = typeof matchingDialogues.$inferSelect;
export type InsertMatchingDialogue = typeof matchingDialogues.$inferInsert;

/**
 * Matching analysis results
 */
// スコア内訳の型定義
export interface ScoreBreakdown {
  skillMatch: { score: number; reason: string };
  valueAlignment: { score: number; reason: string };
  communicationStyle: { score: number; reason: string };
  businessGoalFit: { score: number; reason: string };
  complementaryStrengths: { score: number; reason: string };
}

export const matchingResults = mysqlTable("matching_results", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull().unique(),
  compatibilityScore: decimal("compatibilityScore", { precision: 5, scale: 2 }),
  scoreBreakdown: json("scoreBreakdown").$type<ScoreBreakdown>(), // スコア内訳
  collaborationPotential: text("collaborationPotential"),
  strengths: json("strengths").$type<string[]>(),
  challenges: json("challenges").$type<string[]>(),
  recommendations: json("recommendations").$type<string[]>(),
  summary: text("summary"),
  detailedAnalysis: text("detailedAnalysis"),
  roleDistribution: text("roleDistribution"), // 役割分担
  timeline: text("timeline"), // タイムライン
  resources: text("resources"), // 必要リソース
  kpis: text("kpis"), // KPI
  nextSteps: text("nextSteps"), // 次のステップ
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MatchingResult = typeof matchingResults.$inferSelect;
export type InsertMatchingResult = typeof matchingResults.$inferInsert;

/**
 * Plan limits configuration
 * Defines the limits for each subscription plan
 */
export const planLimits = {
  free: {
    maxTwins: 1,
    maxFriends: 5,
    maxMatchingsPerMonth: 3,
    maxKnowledgeEntries: 10,
    maxFileUploads: 5,
    maxFileSizeMB: 5,
    canUseExternalAI: false,
    canCustomizeOrchestration: false,
  },
  premium: {
    maxTwins: 3,
    maxFriends: 50,
    maxMatchingsPerMonth: 30,
    maxKnowledgeEntries: 100,
    maxFileUploads: 50,
    maxFileSizeMB: 25,
    canUseExternalAI: true,
    canCustomizeOrchestration: true,
  },
  enterprise: {
    maxTwins: -1, // unlimited
    maxFriends: -1, // unlimited
    maxMatchingsPerMonth: -1, // unlimited
    maxKnowledgeEntries: -1, // unlimited
    maxFileUploads: -1, // unlimited
    maxFileSizeMB: 100,
    canUseExternalAI: true,
    canCustomizeOrchestration: true,
  },
} as const;

export type PlanType = keyof typeof planLimits;
export type PlanLimits = typeof planLimits[PlanType];

/**
 * Usage tracking for plan limits
 */
export const usageTracking = mysqlTable("usage_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  matchingsThisMonth: int("matchingsThisMonth").default(0).notNull(),
  lastResetAt: timestamp("lastResetAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UsageTracking = typeof usageTracking.$inferSelect;
export type InsertUsageTracking = typeof usageTracking.$inferInsert;

/**
 * Value scenario responses - ユーザーの価値観シナリオへの回答
 * 具体的な状況に対するユーザーの反応を記録
 */
export const valueScenarioResponses = mysqlTable("value_scenario_responses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(), // ユーザーの分身AI
  scenarioId: varchar("scenarioId", { length: 100 }).notNull(), // シナリオの識別子
  scenarioCategory: varchar("scenarioCategory", { length: 100 }).notNull(), // カテゴリ（災害、ビジネス、人間関係など）
  scenarioText: text("scenarioText").notNull(), // シナリオの内容
  userResponse: text("userResponse").notNull(), // ユーザーの回答
  // AIによる分析結果
  analysisResult: json("analysisResult").$type<{
    judgmentScores: {
      goodEvil: number; // 善悪 (-100～100)
      likesDislike: number; // 好き嫌い (-100～100)
      profitLoss: number; // 損得 (-100～100)
      interest: number; // 利害 (-100～100)
      pleasurePain: number; // 苦楽 (-100～100)
      difficulty: number; // 難易 (-100～100)
      possibility: number; // 可否 (-100～100)
      comfort: number; // 快不快 (-100～100)
      rightWrong: number; // 正誤 (-100～100)
    };
    virtueIndicators: string[]; // 徳の指標
    mineIndicators: string[]; // 地雷の指標
    analysisNotes: string; // 分析メモ
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ValueScenarioResponse = typeof valueScenarioResponses.$inferSelect;
export type InsertValueScenarioResponse = typeof valueScenarioResponses.$inferInsert;

/**
 * Value evaluations - 他の分身AIによる価値観評価
 * 複数の模倣人格がユーザーの言動を評価した結果
 */
export const valueEvaluations = mysqlTable("value_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  targetUserId: int("targetUserId").notNull(), // 評価対象のユーザー
  targetTwinId: int("targetTwinId").notNull(), // 評価対象の分身AI
  evaluatorTwinId: int("evaluatorTwinId").notNull(), // 評価した分身AI
  evaluatorUserId: int("evaluatorUserId").notNull(), // 評価した分身AIの所有者
  scenarioResponseId: int("scenarioResponseId"), // 評価対象のシナリオ回答（オプション）
  // 評価結果
  verdict: mysqlEnum("verdict", ["virtue", "mine", "neutral"]).notNull(), // 徳/地雷/問題なし
  judgmentScores: json("judgmentScores").$type<{
    goodEvil: number;
    likesDislike: number;
    profitLoss: number;
    interest: number;
    pleasurePain: number;
    difficulty: number;
    possibility: number;
    comfort: number;
    rightWrong: number;
  }>(),
  reason: text("reason"), // 評価理由
  confidence: decimal("confidence", { precision: 5, scale: 2 }), // 評価の確信度 (0-100)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ValueEvaluation = typeof valueEvaluations.$inferSelect;
export type InsertValueEvaluation = typeof valueEvaluations.$inferInsert;

/**
 * Cumulative value waveform - 累積価値観波形
 * 各ユーザーの徳波形・地雷波形の累積データ
 */
export const cumulativeWaveforms = mysqlTable("cumulative_waveforms", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  // 累積スコア
  totalVirtueCount: int("totalVirtueCount").default(0).notNull(), // 徳評価の累積回数
  totalMineCount: int("totalMineCount").default(0).notNull(), // 地雷評価の累積回数
  totalNeutralCount: int("totalNeutralCount").default(0).notNull(), // 問題なし評価の累積回数
  // 9つの判断基準の累積スコア
  cumulativeJudgmentScores: json("cumulativeJudgmentScores").$type<{
    goodEvil: { sum: number; count: number };
    likesDislike: { sum: number; count: number };
    profitLoss: { sum: number; count: number };
    interest: { sum: number; count: number };
    pleasurePain: { sum: number; count: number };
    difficulty: { sum: number; count: number };
    possibility: { sum: number; count: number };
    comfort: { sum: number; count: number };
    rightWrong: { sum: number; count: number };
  }>(),
  // 評価者ごとの累積データ
  evaluatorBreakdown: json("evaluatorBreakdown").$type<{
    [evaluatorTwinId: string]: {
      evaluatorName: string;
      virtueCount: number;
      mineCount: number;
      neutralCount: number;
      judgmentScores: {
        goodEvil: { sum: number; count: number };
        likesDislike: { sum: number; count: number };
        profitLoss: { sum: number; count: number };
        interest: { sum: number; count: number };
        pleasurePain: { sum: number; count: number };
        difficulty: { sum: number; count: number };
        possibility: { sum: number; count: number };
        comfort: { sum: number; count: number };
        rightWrong: { sum: number; count: number };
      };
    };
  }>(),
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CumulativeWaveform = typeof cumulativeWaveforms.$inferSelect;
export type InsertCumulativeWaveform = typeof cumulativeWaveforms.$inferInsert;
