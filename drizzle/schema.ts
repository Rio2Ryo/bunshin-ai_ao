import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal, boolean } from "drizzle-orm/mysql-core";

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


/**
 * Intimacy scores - 親密度スコア
 * 友達間の親密度を追跡（会話量と予測精度に基づく）
 */
export const intimacyScores = mysqlTable("intimacy_scores", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // 親密度の対象ユーザー
  friendId: int("friendId").notNull(), // 友達のユーザーID
  // 会話量ベースのスコア
  totalMessageCount: int("totalMessageCount").default(0).notNull(), // 総メッセージ数
  conversationDays: int("conversationDays").default(0).notNull(), // 会話した日数
  lastConversationAt: timestamp("lastConversationAt"), // 最後の会話日時
  // 予測精度ベースのスコア
  totalPredictions: int("totalPredictions").default(0).notNull(), // 予測した回数
  correctPredictions: int("correctPredictions").default(0).notNull(), // 的中した回数
  predictionAccuracy: decimal("predictionAccuracy", { precision: 5, scale: 2 }), // 予測精度 (0-100%)
  // 総合親密度スコア
  intimacyScore: decimal("intimacyScore", { precision: 5, scale: 2 }).default("0").notNull(), // 親密度 (0-100)
  intimacyLevel: mysqlEnum("intimacyLevel", ["stranger", "acquaintance", "friend", "close_friend", "best_friend"]).default("stranger").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type IntimacyScore = typeof intimacyScores.$inferSelect;
export type InsertIntimacyScore = typeof intimacyScores.$inferInsert;

/**
 * Friend predictions - 友達による予測
 * 友達の分身AIが「この人ならどう答えるか」を予測した記録
 */
export const friendPredictions = mysqlTable("friend_predictions", {
  id: int("id").autoincrement().primaryKey(),
  targetUserId: int("targetUserId").notNull(), // 予測対象のユーザー
  targetTwinId: int("targetTwinId").notNull(), // 予測対象の分身AI
  predictorUserId: int("predictorUserId").notNull(), // 予測した友達のユーザーID
  predictorTwinId: int("predictorTwinId").notNull(), // 予測した友達の分身AI
  scenarioResponseId: int("scenarioResponseId"), // 対応するシナリオ回答（実際の回答後に紐付け）
  scenarioId: varchar("scenarioId", { length: 100 }).notNull(), // シナリオの識別子
  scenarioText: text("scenarioText").notNull(), // シナリオの内容
  // 予測内容
  predictedResponse: text("predictedResponse").notNull(), // 予測した回答
  predictedVerdict: mysqlEnum("predictedVerdict", ["virtue", "mine", "neutral"]).notNull(), // 予測した評価（徳/地雷/中立）
  predictedJudgmentScores: json("predictedJudgmentScores").$type<{
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
  predictionReason: text("predictionReason"), // 予測理由
  confidence: decimal("confidence", { precision: 5, scale: 2 }), // 予測の確信度 (0-100)
  // 実際の回答との比較結果（後から更新）
  actualVerdict: mysqlEnum("actualVerdict", ["virtue", "mine", "neutral"]), // 実際の評価
  isCorrect: int("isCorrect"), // 予測が当たったか (0=外れ, 1=当たり)
  similarityScore: decimal("similarityScore", { precision: 5, scale: 2 }), // 回答の類似度 (0-100)
  comparedAt: timestamp("comparedAt"), // 比較した日時
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FriendPrediction = typeof friendPredictions.$inferSelect;
export type InsertFriendPrediction = typeof friendPredictions.$inferInsert;

/**
 * Other-perspective waveform - 他者視点波形
 * 友達からの予測に基づく波形（自己申告波形とは別）
 */
export const otherPerspectiveWaveforms = mysqlTable("other_perspective_waveforms", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  // 累積スコア（友達の予測に基づく）
  totalVirtueCount: int("totalVirtueCount").default(0).notNull(),
  totalMineCount: int("totalMineCount").default(0).notNull(),
  totalNeutralCount: int("totalNeutralCount").default(0).notNull(),
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
  // 予測者ごとの内訳（親密度で重み付け）
  predictorBreakdown: json("predictorBreakdown").$type<{
    [predictorTwinId: string]: {
      predictorName: string;
      intimacyScore: number; // 親密度スコア
      intimacyLevel: string; // 親密度レベル
      weight: number; // 重み（親密度に基づく）
      virtueCount: number;
      mineCount: number;
      neutralCount: number;
      predictionAccuracy: number; // この人の予測精度
    };
  }>(),
  // 自己申告波形との乖離度
  selfReportGap: decimal("selfReportGap", { precision: 5, scale: 2 }), // 自己認識ギャップ (0-100)
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OtherPerspectiveWaveform = typeof otherPerspectiveWaveforms.$inferSelect;
export type InsertOtherPerspectiveWaveform = typeof otherPerspectiveWaveforms.$inferInsert;


/**
 * Point settings - ポイント設定（管理者が変更可能）
 * 各アクションに対するポイント付与数を管理
 */
export const pointSettings = mysqlTable("point_settings", {
  id: int("id").autoincrement().primaryKey(),
  actionType: varchar("actionType", { length: 100 }).notNull().unique(), // アクションの識別子
  actionName: varchar("actionName", { length: 255 }).notNull(), // 表示名
  actionDescription: text("actionDescription"), // アクションの説明
  points: int("points").default(1).notNull(), // 付与ポイント数
  isActive: int("isActive").default(1).notNull(), // 有効/無効
  category: varchar("category", { length: 100 }), // カテゴリ（診断、評価、対話など）
  difficulty: mysqlEnum("difficulty", ["easy", "medium", "hard"]).default("medium").notNull(), // 難易度
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PointSetting = typeof pointSettings.$inferSelect;
export type InsertPointSetting = typeof pointSettings.$inferInsert;

/**
 * User points - ユーザーポイント残高
 */
export const userPoints = mysqlTable("user_points", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  balance: int("balance").default(0).notNull(), // 現在のポイント残高
  totalEarned: int("totalEarned").default(0).notNull(), // 累計獲得ポイント
  totalSpent: int("totalSpent").default(0).notNull(), // 累計使用ポイント
  totalExpired: int("totalExpired").default(0).notNull(), // 累計失効ポイント
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(), // 最終ポイント増減日
  expiresAt: timestamp("expiresAt"), // 有効期限（最終活動日から1年）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPoint = typeof userPoints.$inferSelect;
export type InsertUserPoint = typeof userPoints.$inferInsert;

/**
 * Point transactions - ポイント取引履歴
 */
export const pointTransactions = mysqlTable("point_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["earn", "spend", "expire", "adjust"]).notNull(), // 取引タイプ
  amount: int("amount").notNull(), // ポイント数（正の値）
  balanceAfter: int("balanceAfter").notNull(), // 取引後の残高
  actionType: varchar("actionType", { length: 100 }), // 関連アクション（earnの場合）
  referenceId: varchar("referenceId", { length: 255 }), // 関連ID（シナリオID、製品IDなど）
  description: text("description"), // 取引の説明
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PointTransaction = typeof pointTransactions.$inferSelect;
export type InsertPointTransaction = typeof pointTransactions.$inferInsert;

/**
 * Redeemable products - 交換可能な製品
 */
export const redeemableProducts = mysqlTable("redeemable_products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(), // 製品名
  description: text("description"), // 製品説明
  imageUrl: varchar("imageUrl", { length: 1000 }), // 製品画像URL
  pointsCost: int("pointsCost").notNull(), // 必要ポイント数
  priceYen: int("priceYen"), // 円換算価格（参考）
  category: varchar("category", { length: 100 }), // カテゴリ
  stock: int("stock"), // 在庫数（nullは無制限）
  isActive: int("isActive").default(1).notNull(), // 有効/無効
  sortOrder: int("sortOrder").default(0).notNull(), // 表示順
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RedeemableProduct = typeof redeemableProducts.$inferSelect;
export type InsertRedeemableProduct = typeof redeemableProducts.$inferInsert;

/**
 * Point redemptions - ポイント交換履歴
 */
export const pointRedemptions = mysqlTable("point_redemptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  productId: int("productId").notNull(),
  pointsUsed: int("pointsUsed").notNull(), // 使用ポイント数
  status: mysqlEnum("status", ["pending", "processing", "completed", "cancelled", "refunded"]).default("pending").notNull(),
  shippingInfo: json("shippingInfo").$type<{
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    notes?: string;
  }>(), // 配送情報（物理製品の場合）
  fulfillmentInfo: json("fulfillmentInfo").$type<{
    code?: string; // デジタル製品のコード
    url?: string; // ダウンロードURL
    expiresAt?: string; // 有効期限
  }>(), // 履行情報
  notes: text("notes"), // 管理者メモ
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PointRedemption = typeof pointRedemptions.$inferSelect;
export type InsertPointRedemption = typeof pointRedemptions.$inferInsert;


// ============================================
// Clawdbot風機能のテーブル
// ============================================

/**
 * Daily memory logs - 日次メモリログ
 * Clawdbotのmemory/YYYY-MM-DD.md相当
 */
export const dailyMemoryLogs = mysqlTable("daily_memory_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  logDate: varchar("logDate", { length: 10 }).notNull(), // YYYY-MM-DD形式
  content: text("content").notNull(), // Markdown形式のログ内容
  summary: text("summary"), // AIによる要約
  keyPoints: json("keyPoints").$type<string[]>(), // 重要ポイント
  emotionalTone: varchar("emotionalTone", { length: 50 }), // その日の感情トーン
  topics: json("topics").$type<string[]>(), // 話題のタグ
  messageCount: int("messageCount").default(0).notNull(), // その日のメッセージ数
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyMemoryLog = typeof dailyMemoryLogs.$inferSelect;
export type InsertDailyMemoryLog = typeof dailyMemoryLogs.$inferInsert;

/**
 * Long-term memory - 長期記憶
 * Clawdbotのmemory.md相当（キュレートされた重要情報）
 */
export const longTermMemory = mysqlTable("long_term_memory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  category: mysqlEnum("category", [
    "preference", // 好み・嗜好
    "fact", // 事実・情報
    "decision", // 決定事項
    "goal", // 目標
    "relationship", // 人間関係
    "skill", // スキル・能力
    "experience", // 経験
    "belief", // 信念・価値観
    "routine", // 習慣・ルーティン
    "other" // その他
  ]).notNull(),
  title: varchar("title", { length: 255 }).notNull(), // 記憶のタイトル
  content: text("content").notNull(), // 記憶の内容
  importance: int("importance").default(5).notNull(), // 重要度 (1-10)
  source: varchar("source", { length: 100 }), // 情報源（会話、診断、ファイルなど）
  sourceId: varchar("sourceId", { length: 255 }), // 情報源のID
  tags: json("tags").$type<string[]>(), // タグ
  embedding: json("embedding").$type<number[]>(), // ベクトル埋め込み（検索用）
  lastAccessedAt: timestamp("lastAccessedAt"), // 最後にアクセスした日時
  accessCount: int("accessCount").default(0).notNull(), // アクセス回数
  isActive: int("isActive").default(1).notNull(), // 有効/無効
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LongTermMemoryEntry = typeof longTermMemory.$inferSelect;
export type InsertLongTermMemory = typeof longTermMemory.$inferInsert;

/**
 * Skills - スキル（プラグイン）定義
 */
export const skills = mysqlTable("skills", {
  id: int("id").autoincrement().primaryKey(),
  skillId: varchar("skillId", { length: 100 }).notNull().unique(), // スキルの識別子
  name: varchar("name", { length: 255 }).notNull(), // スキル名
  description: text("description"), // スキルの説明
  category: mysqlEnum("category", [
    "productivity", // 生産性（カレンダー、タスク管理など）
    "communication", // コミュニケーション（メール、メッセージなど）
    "information", // 情報収集（天気、ニュースなど）
    "entertainment", // エンターテイメント
    "health", // 健康・フィットネス
    "finance", // 金融・家計
    "learning", // 学習
    "social", // ソーシャル
    "custom" // カスタム
  ]).notNull(),
  type: mysqlEnum("type", ["builtin", "community", "custom"]).default("builtin").notNull(),
  version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
  author: varchar("author", { length: 255 }),
  authorId: int("authorId"), // カスタムスキルの作成者
  // スキルの設定
  config: json("config").$type<{
    triggers?: string[]; // トリガーワード
    requiredPermissions?: string[]; // 必要な権限
    requiredApis?: string[]; // 必要なAPI
    parameters?: {
      name: string;
      type: string;
      description: string;
      required: boolean;
      default?: unknown;
    }[];
  }>(),
  // スキルの実行コード（カスタムスキルの場合）
  executionCode: text("executionCode"), // JavaScript/TypeScriptコード
  systemPrompt: text("systemPrompt"), // スキル用のシステムプロンプト
  // 統計
  usageCount: int("usageCount").default(0).notNull(),
  rating: decimal("rating", { precision: 3, scale: 2 }), // 評価 (0-5)
  ratingCount: int("ratingCount").default(0).notNull(),
  isActive: int("isActive").default(1).notNull(),
  isPublic: int("isPublic").default(0).notNull(), // 公開/非公開
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Skill = typeof skills.$inferSelect;
export type InsertSkill = typeof skills.$inferInsert;

/**
 * User skills - ユーザーが有効にしているスキル
 */
export const userSkills = mysqlTable("user_skills", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  skillId: int("skillId").notNull(),
  isEnabled: int("isEnabled").default(1).notNull(),
  // スキルごとのユーザー設定
  userConfig: json("userConfig").$type<Record<string, unknown>>(),
  // 使用統計
  usageCount: int("usageCount").default(0).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSkill = typeof userSkills.$inferSelect;
export type InsertUserSkill = typeof userSkills.$inferInsert;

/**
 * Heartbeat settings - ハートビート設定
 * 分身AIからの定期連絡設定
 */
export const heartbeatSettings = mysqlTable("heartbeat_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  isEnabled: int("isEnabled").default(0).notNull(),
  // スケジュール設定
  frequency: mysqlEnum("frequency", ["daily", "weekly", "custom"]).default("daily").notNull(),
  preferredTime: varchar("preferredTime", { length: 5 }), // HH:MM形式
  preferredDays: json("preferredDays").$type<number[]>(), // 曜日（0=日曜）
  timezone: varchar("timezone", { length: 50 }).default("Asia/Tokyo").notNull(),
  // カスタムcron式（frequencyがcustomの場合）
  cronExpression: varchar("cronExpression", { length: 100 }),
  // ハートビートの内容設定
  messageTypes: json("messageTypes").$type<{
    dailyBriefing: boolean; // 今日の予定・リマインダー
    progressCheck: boolean; // 進捗確認
    motivational: boolean; // モチベーションメッセージ
    learningTip: boolean; // 学習のヒント
    randomThought: boolean; // ランダムな思考・質問
  }>(),
  customPrompt: text("customPrompt"), // カスタムプロンプト
  // 通知チャネル
  notificationChannels: json("notificationChannels").$type<{
    inApp: boolean;
    line: boolean;
    email: boolean;
  }>(),
  // 統計
  totalSent: int("totalSent").default(0).notNull(),
  lastSentAt: timestamp("lastSentAt"),
  nextScheduledAt: timestamp("nextScheduledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type HeartbeatSetting = typeof heartbeatSettings.$inferSelect;
export type InsertHeartbeatSetting = typeof heartbeatSettings.$inferInsert;

/**
 * Heartbeat messages - ハートビートメッセージ履歴
 */
export const heartbeatMessages = mysqlTable("heartbeat_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  settingId: int("settingId").notNull(),
  messageType: varchar("messageType", { length: 50 }).notNull(),
  content: text("content").notNull(),
  // 配信状態
  status: mysqlEnum("status", ["pending", "sent", "delivered", "read", "failed"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  deliveredAt: timestamp("deliveredAt"),
  readAt: timestamp("readAt"),
  // ユーザーの反応
  userResponse: text("userResponse"),
  respondedAt: timestamp("respondedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HeartbeatMessage = typeof heartbeatMessages.$inferSelect;
export type InsertHeartbeatMessage = typeof heartbeatMessages.$inferInsert;

/**
 * Multi-agent tasks - マルチエージェントタスク
 * 複数の分身AI間での協力タスク
 */
export const multiAgentTasks = mysqlTable("multi_agent_tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  creatorUserId: int("creatorUserId").notNull(),
  creatorTwinId: int("creatorTwinId").notNull(),
  status: mysqlEnum("status", ["draft", "active", "paused", "completed", "cancelled"]).default("draft").notNull(),
  // 参加者
  participants: json("participants").$type<{
    twinId: number;
    userId: number;
    twinName: string;
    role: string; // タスク内での役割
    status: "invited" | "accepted" | "declined" | "active";
    joinedAt?: string;
  }[]>(),
  // タスクの設定
  taskType: mysqlEnum("taskType", [
    "brainstorm", // ブレインストーミング
    "project", // プロジェクト協力
    "discussion", // ディスカッション
    "research", // 共同リサーチ
    "planning", // 計画立案
    "review", // レビュー・フィードバック
    "custom" // カスタム
  ]).default("discussion").notNull(),
  // 進捗
  progress: int("progress").default(0).notNull(), // 0-100%
  milestones: json("milestones").$type<{
    id: string;
    title: string;
    description?: string;
    status: "pending" | "in_progress" | "completed";
    assignedTo?: number; // twinId
    completedAt?: string;
  }[]>(),
  // 成果物
  deliverables: json("deliverables").$type<{
    id: string;
    title: string;
    type: string;
    content?: string;
    url?: string;
    createdBy: number; // twinId
    createdAt: string;
  }[]>(),
  deadline: timestamp("deadline"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MultiAgentTask = typeof multiAgentTasks.$inferSelect;
export type InsertMultiAgentTask = typeof multiAgentTasks.$inferInsert;

/**
 * Multi-agent messages - マルチエージェントタスク内のメッセージ
 */
export const multiAgentMessages = mysqlTable("multi_agent_messages", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  senderTwinId: int("senderTwinId").notNull(),
  senderUserId: int("senderUserId").notNull(),
  content: text("content").notNull(),
  messageType: mysqlEnum("messageType", [
    "message", // 通常メッセージ
    "proposal", // 提案
    "question", // 質問
    "answer", // 回答
    "decision", // 決定事項
    "action_item", // アクションアイテム
    "summary", // 要約
    "system" // システムメッセージ
  ]).default("message").notNull(),
  // メンション
  mentions: json("mentions").$type<number[]>(), // twinIds
  // リアクション
  reactions: json("reactions").$type<{
    twinId: number;
    reaction: string;
  }[]>(),
  // 参照
  replyToId: int("replyToId"), // 返信先メッセージID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MultiAgentMessage = typeof multiAgentMessages.$inferSelect;
export type InsertMultiAgentMessage = typeof multiAgentMessages.$inferInsert;

/**
 * LINE connections - LINE連携設定
 */
export const lineConnections = mysqlTable("line_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  twinId: int("twinId").notNull(),
  // LINE情報
  lineUserId: varchar("lineUserId", { length: 255 }).notNull().unique(),
  lineDisplayName: varchar("lineDisplayName", { length: 255 }),
  linePictureUrl: varchar("linePictureUrl", { length: 1000 }),
  // 連携状態
  status: mysqlEnum("status", ["pending", "active", "paused", "disconnected"]).default("pending").notNull(),
  // 設定
  settings: json("settings").$type<{
    receiveHeartbeat: boolean; // ハートビートを受信
    receiveNotifications: boolean; // 通知を受信
    allowVoiceMessages: boolean; // 音声メッセージを許可
    language: string; // 言語設定
  }>(),
  // Clawdbotエージェント設定
  clawdbotAgentId: varchar("clawdbotAgentId", { length: 255 }), // ユーザー固有のClawdbotエージェントID (bunshin_user_{userId})
  clawdbotAgentCreatedAt: timestamp("clawdbotAgentCreatedAt"), // エージェント作成日時
  // 統計
  totalMessages: int("totalMessages").default(0).notNull(),
  lastMessageAt: timestamp("lastMessageAt"),
  connectedAt: timestamp("connectedAt"),
  disconnectedAt: timestamp("disconnectedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LineConnection = typeof lineConnections.$inferSelect;
export type InsertLineConnection = typeof lineConnections.$inferInsert;

/**
 * LINE group observations - グループLINE観察データ
 */
export const lineGroupObservations = mysqlTable("line_group_observations", {
  id: int("id").autoincrement().primaryKey(),
  groupId: varchar("groupId", { length: 255 }).notNull(),
  groupName: varchar("groupName", { length: 255 }),
  // 観察対象のユーザー（LINE連携済み）
  observedLineUserId: varchar("observedLineUserId", { length: 255 }).notNull(),
  observedUserId: int("observedUserId").notNull(),
  // 観察データ
  messageContent: text("messageContent").notNull(),
  messageType: varchar("messageType", { length: 50 }).default("text").notNull(),
  // 分析結果
  analyzedTraits: json("analyzedTraits").$type<{
    communicationStyle?: string;
    topics?: string[];
    sentiment?: string;
    keywords?: string[];
  }>(),
  isProcessed: boolean("isProcessed").default(false).notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LineGroupObservation = typeof lineGroupObservations.$inferSelect;
export type InsertLineGroupObservation = typeof lineGroupObservations.$inferInsert;

/**
 * LINE message history - LINEメッセージ履歴
 */
export const lineMessages = mysqlTable("line_messages", {
  id: int("id").autoincrement().primaryKey(),
  connectionId: int("connectionId").notNull(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  // メッセージ情報
  lineMessageId: varchar("lineMessageId", { length: 255 }),
  direction: mysqlEnum("direction", ["incoming", "outgoing"]).notNull(),
  messageType: mysqlEnum("messageType", ["text", "image", "audio", "video", "sticker", "location", "flex"]).default("text").notNull(),
  content: text("content"),
  // メディア情報（画像・音声・動画の場合）
  mediaUrl: varchar("mediaUrl", { length: 1000 }),
  // 処理状態
  status: mysqlEnum("status", ["received", "processing", "sent", "delivered", "read", "failed"]).default("received").notNull(),
  // 関連するチャットセッション
  chatSessionId: int("chatSessionId"),
  chatMessageId: int("chatMessageId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LineMessage = typeof lineMessages.$inferSelect;
export type InsertLineMessage = typeof lineMessages.$inferInsert;


// ============================================
// Clawdbot連携テーブル
// ============================================

/**
 * Clawdbot connections - Clawdbot Gateway接続設定
 * ユーザーが自分のClawdbotインスタンスと分身AIを連携
 */
export const clawdbotConnections = mysqlTable("clawdbot_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  twinId: int("twinId").notNull(),
  // Clawdbot Gateway設定
  gatewayUrl: varchar("gatewayUrl", { length: 500 }).notNull(), // ws://host:port または http://host:port
  authToken: varchar("authToken", { length: 500 }), // Gateway認証トークン（暗号化して保存）
  agentId: varchar("agentId", { length: 100 }).default("main").notNull(), // Clawdbotのエージェント ID
  // 接続状態
  status: mysqlEnum("status", ["pending", "testing", "active", "error", "disconnected"]).default("pending").notNull(),
  lastConnectionTest: timestamp("lastConnectionTest"),
  lastError: text("lastError"),
  // 機能設定
  settings: json("settings").$type<{
    enableMemorySync: boolean; // Clawdbotのメモリを分身AIと同期
    enableSkillAccess: boolean; // Clawdbotのスキルを分身AIから利用
    enableChannelBridge: boolean; // LINE/WhatsApp等のチャンネルブリッジ
    preferredModel: string; // 使用するモデル
    sessionPersistence: boolean; // セッション永続化
  }>(),
  // 統計
  totalMessages: int("totalMessages").default(0).notNull(),
  lastMessageAt: timestamp("lastMessageAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClawdbotConnection = typeof clawdbotConnections.$inferSelect;
export type InsertClawdbotConnection = typeof clawdbotConnections.$inferInsert;

/**
 * Clawdbot message logs - Clawdbot経由のメッセージログ
 */
export const clawdbotMessageLogs = mysqlTable("clawdbot_message_logs", {
  id: int("id").autoincrement().primaryKey(),
  connectionId: int("connectionId").notNull(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  // メッセージ情報
  direction: mysqlEnum("direction", ["to_clawdbot", "from_clawdbot"]).notNull(),
  content: text("content").notNull(),
  // Clawdbot固有の情報
  clawdbotSessionKey: varchar("clawdbotSessionKey", { length: 255 }), // Clawdbotのセッションキー
  sourceChannel: varchar("sourceChannel", { length: 50 }), // 元のチャンネル（line, whatsapp, telegram等）
  // 処理状態
  status: mysqlEnum("status", ["pending", "sent", "received", "error"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  // レスポンス時間
  responseTimeMs: int("responseTimeMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClawdbotMessageLog = typeof clawdbotMessageLogs.$inferSelect;
export type InsertClawdbotMessageLog = typeof clawdbotMessageLogs.$inferInsert;


/**
 * Conversation learning data - 会話から学習した人格データ
 * Clawdbot経由の会話を分析して抽出した人格特性
 */
export interface LearnedPersonalityTraits {
  // 好み・嫌い
  likes: string[];
  dislikes: string[];
  // 価値観
  values: string[];
  priorities: string[];
  // コミュニケーションスタイル
  communicationStyle: {
    formality: number; // 0=カジュアル, 100=フォーマル
    verbosity: number; // 0=簡潔, 100=詳細
    emotionality: number; // 0=論理的, 100=感情的
    directness: number; // 0=婉曲, 100=直接的
  };
  // 口癖・よく使う表現
  catchphrases: string[];
  frequentExpressions: string[];
  // 興味・関心分野
  interests: string[];
  expertise: string[];
  // 行動パターン
  decisionMakingStyle: string; // 慎重/即断/相談型など
  conflictResolutionStyle: string; // 回避/対決/妥協など
  // 感情パターン
  emotionalTriggers: {
    positive: string[]; // 喜ぶこと
    negative: string[]; // 怒ること・悲しむこと
  };
  // 最終更新
  lastAnalyzedAt: string;
  totalConversationsAnalyzed: number;
}

export const conversationLearning = mysqlTable("conversation_learning", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  twinId: int("twinId").notNull(),
  // 学習した人格特性
  learnedTraits: json("learnedTraits").$type<LearnedPersonalityTraits>(),
  // 学習の進捗
  totalConversations: int("totalConversations").default(0).notNull(),
  lastAnalysisAt: timestamp("lastAnalysisAt"),
  analysisCount: int("analysisCount").default(0).notNull(), // 分析実行回数
  // 未分析の会話数（閾値に達したら分析実行）
  pendingConversations: int("pendingConversations").default(0).notNull(),
  // 設定
  autoLearnEnabled: int("autoLearnEnabled").default(1).notNull(), // 自動学習有効
  learningThreshold: int("learningThreshold").default(10).notNull(), // 何会話ごとに分析するか
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ConversationLearning = typeof conversationLearning.$inferSelect;
export type InsertConversationLearning = typeof conversationLearning.$inferInsert;

/**
 * Conversation snippets - 学習用に保存された会話断片
 * 人格分析に使用する会話の抜粋
 */
export const conversationSnippets = mysqlTable("conversation_snippets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  twinId: int("twinId").notNull(),
  // 会話の種類
  source: mysqlEnum("source", ["clawdbot", "web_chat", "matching", "group", "line"]).notNull(),
  sourceId: varchar("sourceId", { length: 255 }), // 元のメッセージID等
  // 会話内容
  userMessage: text("userMessage").notNull(), // ユーザーの発言
  context: text("context"), // 前後の文脈（他者の発言など）
  // 抽出された特徴
  extractedFeatures: json("extractedFeatures").$type<{
    sentiment: string; // positive/negative/neutral
    topics: string[]; // 話題
    expressedPreferences: string[]; // 表明された好み
    expressedValues: string[]; // 表明された価値観
    emotionalState: string; // 感情状態
    communicationPatterns: string[]; // コミュニケーションパターン
  }>(),
  // 分析状態
  isAnalyzed: int("isAnalyzed").default(0).notNull(),
  analyzedAt: timestamp("analyzedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ConversationSnippet = typeof conversationSnippets.$inferSelect;
export type InsertConversationSnippet = typeof conversationSnippets.$inferInsert;

/**
 * Group conversation observations - グループ会話の観察記録
 * グループLINE等での会話を観察して学習
 */
export const groupConversationObservations = mysqlTable("group_conversation_observations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // 観察対象のユーザー
  twinId: int("twinId").notNull(),
  // グループ情報
  groupId: varchar("groupId", { length: 255 }).notNull(), // LINEグループID等
  groupName: varchar("groupName", { length: 255 }),
  // 会話内容
  speakerType: mysqlEnum("speakerType", ["self", "other"]).notNull(), // 自分/他者
  speakerName: varchar("speakerName", { length: 255 }), // 他者の場合の名前
  message: text("message").notNull(),
  // 文脈情報
  replyToId: int("replyToId"), // 返信先のID
  threadContext: text("threadContext"), // スレッドの文脈
  // 分析用フラグ
  isRelevantForLearning: int("isRelevantForLearning").default(0).notNull(), // 学習に使うか
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GroupConversationObservation = typeof groupConversationObservations.$inferSelect;
export type InsertGroupConversationObservation = typeof groupConversationObservations.$inferInsert;


/**
 * Webhook debug logs - Webhookデバッグログ
 * LINE Webhookの受信状況を記録
 */
export const webhookDebugLogs = mysqlTable("webhook_debug_logs", {
  id: int("id").autoincrement().primaryKey(),
  source: varchar("source", { length: 50 }).notNull(), // line, clawdbot等
  eventType: varchar("eventType", { length: 50 }), // message, follow等
  requestBody: text("requestBody"), // リクエストボディ
  headers: text("headers"), // ヘッダー情報
  processingStep: varchar("processingStep", { length: 100 }), // 処理ステップ
  result: varchar("result", { length: 50 }), // success, error
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WebhookDebugLog = typeof webhookDebugLogs.$inferSelect;
export type InsertWebhookDebugLog = typeof webhookDebugLogs.$inferInsert;


/**
 * Image Generation AI Settings - 画像生成AI設定
 * ユーザーごとの画像生成AIの設定を管理
 */
export const imageGenerationSettings = mysqlTable("image_generation_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  // 使用する画像生成AI
  provider: mysqlEnum("provider", [
    "nano_banana_pro",  // Nano Banana Pro（デフォルト）
    "dall_e",           // DALL-E
    "stable_diffusion", // Stable Diffusion
    "midjourney",       // Midjourney
    "flux",             // Flux
  ]).default("nano_banana_pro").notNull(),
  // プロバイダー固有の設定
  settings: json("settings").$type<{
    // 共通設定
    defaultSize?: string;      // デフォルト画像サイズ
    defaultQuality?: string;   // デフォルト品質
    defaultStyle?: string;     // デフォルトスタイル
    // プロバイダー固有の設定
    apiKey?: string;           // カスタムAPIキー（オプション）
    modelVersion?: string;     // モデルバージョン
  }>(),
  // 使用統計
  totalGenerations: int("totalGenerations").default(0).notNull(),
  lastGeneratedAt: timestamp("lastGeneratedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImageGenerationSetting = typeof imageGenerationSettings.$inferSelect;
export type InsertImageGenerationSetting = typeof imageGenerationSettings.$inferInsert;

// 利用可能な画像生成AIプロバイダーの情報
export const imageGenerationProviders = {
  nano_banana_pro: {
    name: "Nano Banana Pro",
    description: "高品質な画像生成AI（デフォルト）",
    isDefault: true,
    requiresApiKey: false,
  },
  dall_e: {
    name: "DALL-E",
    description: "OpenAIの画像生成AI",
    isDefault: false,
    requiresApiKey: true,
  },
  stable_diffusion: {
    name: "Stable Diffusion",
    description: "オープンソースの画像生成AI",
    isDefault: false,
    requiresApiKey: true,
  },
  midjourney: {
    name: "Midjourney",
    description: "アート特化の画像生成AI",
    isDefault: false,
    requiresApiKey: true,
  },
  flux: {
    name: "Flux",
    description: "高速な画像生成AI",
    isDefault: false,
    requiresApiKey: false,
  },
} as const;

export type ImageGenerationProvider = keyof typeof imageGenerationProviders;
