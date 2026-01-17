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
 * Digital Twin AI (分身AI) configuration
 */
export const digitalTwins = mysqlTable("digital_twins", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  personality: text("personality"),
  systemPrompt: text("systemPrompt"),
  status: mysqlEnum("status", ["active", "inactive", "training"]).default("inactive").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DigitalTwin = typeof digitalTwins.$inferSelect;
export type InsertDigitalTwin = typeof digitalTwins.$inferInsert;

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
 * Business matching sessions (分身AI同士の対話)
 */
export const matchingSessions = mysqlTable("matching_sessions", {
  id: int("id").autoincrement().primaryKey(),
  twin1Id: int("twin1Id").notNull(),
  twin2Id: int("twin2Id").notNull(),
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
export const matchingResults = mysqlTable("matching_results", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull().unique(),
  compatibilityScore: decimal("compatibilityScore", { precision: 5, scale: 2 }),
  collaborationPotential: text("collaborationPotential"),
  strengths: json("strengths").$type<string[]>(),
  challenges: json("challenges").$type<string[]>(),
  recommendations: json("recommendations").$type<string[]>(),
  summary: text("summary"),
  detailedAnalysis: text("detailedAnalysis"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MatchingResult = typeof matchingResults.$inferSelect;
export type InsertMatchingResult = typeof matchingResults.$inferInsert;
