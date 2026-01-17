import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  userProfiles, InsertUserProfile, UserProfile,
  digitalTwins, InsertDigitalTwin, DigitalTwin,
  knowledgeBase, InsertKnowledgeEntry, KnowledgeEntry,
  uploadedFiles, InsertUploadedFile, UploadedFile,
  aiApiConfigs, InsertAiApiConfig, AiApiConfig,
  orchestrationRoles, InsertOrchestrationRole, OrchestrationRole,
  chatSessions, InsertChatSession, ChatSession,
  chatMessages, InsertChatMessage, ChatMessage,
  matchingSessions, InsertMatchingSession, MatchingSession,
  matchingDialogues, InsertMatchingDialogue, MatchingDialogue,
  matchingResults, InsertMatchingResult, MatchingResult,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ User Functions ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ User Profile Functions ============
export async function getUserProfile(userId: number): Promise<UserProfile | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return result[0];
}

export async function upsertUserProfile(profile: InsertUserProfile): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(userProfiles).values(profile).onDuplicateKeyUpdate({
    set: {
      displayName: profile.displayName,
      bio: profile.bio,
      skills: profile.skills,
      experience: profile.experience,
      businessInfo: profile.businessInfo,
      expertise: profile.expertise,
      industry: profile.industry,
      company: profile.company,
      position: profile.position,
    }
  });
}

// ============ Digital Twin Functions ============
export async function createDigitalTwin(twin: InsertDigitalTwin): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(digitalTwins).values(twin);
  return result[0].insertId;
}

export async function getDigitalTwinsByUser(userId: number): Promise<DigitalTwin[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(digitalTwins).where(eq(digitalTwins.userId, userId)).orderBy(desc(digitalTwins.createdAt));
}

export async function getDigitalTwinById(id: number): Promise<DigitalTwin | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(digitalTwins).where(eq(digitalTwins.id, id)).limit(1);
  return result[0];
}

export async function updateDigitalTwin(id: number, data: Partial<InsertDigitalTwin>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(digitalTwins).set(data).where(eq(digitalTwins.id, id));
}

export async function deleteDigitalTwin(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(digitalTwins).where(eq(digitalTwins.id, id));
}

// ============ Knowledge Base Functions ============
export async function addKnowledgeEntry(entry: InsertKnowledgeEntry): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(knowledgeBase).values(entry);
  return result[0].insertId;
}

export async function getKnowledgeByTwin(twinId: number): Promise<KnowledgeEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(knowledgeBase).where(eq(knowledgeBase.twinId, twinId)).orderBy(desc(knowledgeBase.createdAt));
}

export async function deleteKnowledgeEntry(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
}

// ============ Uploaded Files Functions ============
export async function createUploadedFile(file: InsertUploadedFile): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(uploadedFiles).values(file);
  return result[0].insertId;
}

export async function getUploadedFilesByUser(userId: number): Promise<UploadedFile[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(uploadedFiles).where(eq(uploadedFiles.userId, userId)).orderBy(desc(uploadedFiles.createdAt));
}

export async function updateUploadedFileStatus(id: number, status: "pending" | "processing" | "completed" | "failed"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, unknown> = { status };
  if (status === "completed") {
    updateData.processedAt = new Date();
  }
  await db.update(uploadedFiles).set(updateData).where(eq(uploadedFiles.id, id));
}

// ============ AI API Config Functions ============
export async function getAiApiConfigs(userId: number): Promise<AiApiConfig[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiApiConfigs).where(eq(aiApiConfigs.userId, userId));
}

export async function upsertAiApiConfig(config: InsertAiApiConfig): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(aiApiConfigs)
    .where(and(eq(aiApiConfigs.userId, config.userId), eq(aiApiConfigs.provider, config.provider)))
    .limit(1);
  
  if (existing.length > 0) {
    await db.update(aiApiConfigs).set({ apiKey: config.apiKey, isActive: config.isActive ?? 1 })
      .where(eq(aiApiConfigs.id, existing[0].id));
  } else {
    await db.insert(aiApiConfigs).values(config);
  }
}

export async function deleteAiApiConfig(userId: number, provider: "openai" | "gemini" | "anthropic" | "grok"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(aiApiConfigs).where(and(eq(aiApiConfigs.userId, userId), eq(aiApiConfigs.provider, provider)));
}

// ============ Orchestration Roles Functions ============
export async function getOrchestrationRoles(userId: number): Promise<OrchestrationRole[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orchestrationRoles).where(eq(orchestrationRoles.userId, userId)).orderBy(orchestrationRoles.priority);
}

export async function createOrchestrationRole(role: InsertOrchestrationRole): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(orchestrationRoles).values(role);
  return result[0].insertId;
}

export async function updateOrchestrationRole(id: number, data: Partial<InsertOrchestrationRole>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(orchestrationRoles).set(data).where(eq(orchestrationRoles.id, id));
}

export async function deleteOrchestrationRole(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(orchestrationRoles).where(eq(orchestrationRoles.id, id));
}

// ============ Chat Session Functions ============
export async function createChatSession(session: InsertChatSession): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatSessions).values(session);
  return result[0].insertId;
}

export async function getChatSessionsByUser(userId: number): Promise<ChatSession[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatSessions).where(eq(chatSessions.userId, userId)).orderBy(desc(chatSessions.updatedAt));
}

export async function getChatSessionById(id: number): Promise<ChatSession | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
  return result[0];
}

// ============ Chat Message Functions ============
export async function addChatMessage(message: InsertChatMessage): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatMessages).values(message);
  return result[0].insertId;
}

export async function getChatMessagesBySession(sessionId: number): Promise<ChatMessage[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);
}

// ============ Matching Session Functions ============
export async function createMatchingSession(session: InsertMatchingSession): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(matchingSessions).values(session);
  return result[0].insertId;
}

export async function getMatchingSessionsByTwin(twinId: number): Promise<MatchingSession[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(matchingSessions)
    .where(eq(matchingSessions.twin1Id, twinId))
    .orderBy(desc(matchingSessions.createdAt));
}

export async function getAllMatchingSessions(): Promise<MatchingSession[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(matchingSessions).orderBy(desc(matchingSessions.createdAt));
}

export async function getMatchingSessionById(id: number): Promise<MatchingSession | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(matchingSessions).where(eq(matchingSessions.id, id)).limit(1);
  return result[0];
}

export async function updateMatchingSessionStatus(id: number, status: "pending" | "running" | "completed" | "failed"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, unknown> = { status };
  if (status === "completed") {
    updateData.completedAt = new Date();
  }
  await db.update(matchingSessions).set(updateData).where(eq(matchingSessions.id, id));
}

// ============ Matching Dialogue Functions ============
export async function addMatchingDialogue(dialogue: InsertMatchingDialogue): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(matchingDialogues).values(dialogue);
  return result[0].insertId;
}

export async function getMatchingDialoguesBySession(sessionId: number): Promise<MatchingDialogue[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(matchingDialogues).where(eq(matchingDialogues.sessionId, sessionId)).orderBy(matchingDialogues.turnNumber);
}

// ============ Matching Result Functions ============
export async function createMatchingResult(result: InsertMatchingResult): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const res = await db.insert(matchingResults).values(result);
  return res[0].insertId;
}

export async function getMatchingResultBySession(sessionId: number): Promise<MatchingResult | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(matchingResults).where(eq(matchingResults.sessionId, sessionId)).limit(1);
  return result[0];
}
