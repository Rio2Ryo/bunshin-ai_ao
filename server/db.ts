import { eq, and, desc, or, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users, User,
  userProfiles, InsertUserProfile, UserProfile,
  digitalTwins, InsertDigitalTwin, DigitalTwin,
  friendships, InsertFriendship, Friendship,
  knowledgeBase, InsertKnowledgeEntry, KnowledgeEntry,
  uploadedFiles, InsertUploadedFile, UploadedFile,
  aiApiConfigs, InsertAiApiConfig, AiApiConfig,
  orchestrationRoles, InsertOrchestrationRole, OrchestrationRole,
  chatSessions, InsertChatSession, ChatSession,
  chatMessages, InsertChatMessage, ChatMessage,
  matchingSessions, InsertMatchingSession, MatchingSession,
  matchingDialogues, InsertMatchingDialogue, MatchingDialogue,
  matchingResults, InsertMatchingResult, MatchingResult,
  planLimits, PlanType, usageTracking, UsageTracking,
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

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function searchUsers(query: string, excludeUserId: number): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];
  // Simple search by name or email
  return db.select().from(users)
    .where(and(
      ne(users.id, excludeUserId),
      or(
        sql`${users.name} LIKE ${`%${query}%`}`,
        sql`${users.email} LIKE ${`%${query}%`}`
      )
    ))
    .limit(20);
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

// ============ Digital Twin Functions (1 user = 1 twin) ============
export async function getOrCreateDigitalTwin(userId: number): Promise<DigitalTwin | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await db.select().from(digitalTwins).where(eq(digitalTwins.userId, userId)).limit(1);
  return existing[0] || null;
}

export async function upsertDigitalTwin(userId: number, data: Partial<InsertDigitalTwin>): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await db.select().from(digitalTwins).where(eq(digitalTwins.userId, userId)).limit(1);
  
  if (existing.length > 0) {
    // Update existing
    await db.update(digitalTwins).set({
      name: data.name,
      description: data.description,
      personality: data.personality,
      systemPrompt: data.systemPrompt,
      rawInput: data.rawInput,
      status: data.status,
    }).where(eq(digitalTwins.id, existing[0].id));
    return existing[0].id;
  } else {
    // Create new
    const result = await db.insert(digitalTwins).values({
      userId,
      name: data.name || "My Digital Twin",
      description: data.description,
      personality: data.personality,
      systemPrompt: data.systemPrompt,
      rawInput: data.rawInput,
      status: data.status || "inactive",
    });
    return result[0].insertId;
  }
}

export async function getDigitalTwinByUser(userId: number): Promise<DigitalTwin | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(digitalTwins).where(eq(digitalTwins.userId, userId)).limit(1);
  return result[0];
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

// ============ Friendship Functions ============
export async function sendFriendRequest(userId: number, friendId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if already exists
  const existing = await db.select().from(friendships)
    .where(or(
      and(eq(friendships.userId, userId), eq(friendships.friendId, friendId)),
      and(eq(friendships.userId, friendId), eq(friendships.friendId, userId))
    ))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0].id;
  }
  
  const result = await db.insert(friendships).values({
    userId,
    friendId,
    status: "pending",
  });
  return result[0].insertId;
}

export async function acceptFriendRequest(requestId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Only the friend (receiver) can accept
  await db.update(friendships)
    .set({ status: "accepted" })
    .where(and(eq(friendships.id, requestId), eq(friendships.friendId, userId)));
}

export async function rejectFriendRequest(requestId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(friendships)
    .set({ status: "rejected" })
    .where(and(eq(friendships.id, requestId), eq(friendships.friendId, userId)));
}

export async function getFriends(userId: number): Promise<{ friendship: Friendship; friend: User; twin: DigitalTwin | null }[]> {
  const db = await getDb();
  if (!db) return [];
  
  // Get accepted friendships where user is either userId or friendId
  const friendshipList = await db.select().from(friendships)
    .where(and(
      eq(friendships.status, "accepted"),
      or(eq(friendships.userId, userId), eq(friendships.friendId, userId))
    ));
  
  const result: { friendship: Friendship; friend: User; twin: DigitalTwin | null }[] = [];
  
  for (const f of friendshipList) {
    const friendUserId = f.userId === userId ? f.friendId : f.userId;
    const friend = await getUserById(friendUserId);
    if (friend) {
      const twin = await getDigitalTwinByUser(friendUserId) || null;
      result.push({ friendship: f, friend, twin });
    }
  }
  
  return result;
}

export async function getPendingFriendRequests(userId: number): Promise<{ friendship: Friendship; sender: User }[]> {
  const db = await getDb();
  if (!db) return [];
  
  const pending = await db.select().from(friendships)
    .where(and(eq(friendships.friendId, userId), eq(friendships.status, "pending")));
  
  const result: { friendship: Friendship; sender: User }[] = [];
  
  for (const f of pending) {
    const sender = await getUserById(f.userId);
    if (sender) {
      result.push({ friendship: f, sender });
    }
  }
  
  return result;
}

export async function getSentFriendRequests(userId: number): Promise<{ friendship: Friendship; receiver: User }[]> {
  const db = await getDb();
  if (!db) return [];
  
  const sent = await db.select().from(friendships)
    .where(and(eq(friendships.userId, userId), eq(friendships.status, "pending")));
  
  const result: { friendship: Friendship; receiver: User }[] = [];
  
  for (const f of sent) {
    const receiver = await getUserById(f.friendId);
    if (receiver) {
      result.push({ friendship: f, receiver });
    }
  }
  
  return result;
}

export async function removeFriend(userId: number, friendId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(friendships)
    .where(or(
      and(eq(friendships.userId, userId), eq(friendships.friendId, friendId)),
      and(eq(friendships.userId, friendId), eq(friendships.friendId, userId))
    ));
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

export async function getMatchingSessionsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const sessions = await db.select().from(matchingSessions)
    .where(eq(matchingSessions.initiatorUserId, userId))
    .orderBy(desc(matchingSessions.createdAt));
  
  // Fetch twin info and analysis result for each session
  const result = await Promise.all(sessions.map(async (session) => {
    const twin1 = await getDigitalTwinById(session.twin1Id);
    const twin2 = await getDigitalTwinById(session.twin2Id);
    const analysisResult = await getMatchingResultBySession(session.id);
    return { ...session, twin1, twin2, analysisResult: analysisResult || null };
  }));
  
  return result;
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

// ============ Plan & Usage Functions ============
export function getPlanLimits(plan: PlanType) {
  return planLimits[plan];
}

export async function getUserUsage(userId: number): Promise<UsageTracking | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(usageTracking).where(eq(usageTracking.userId, userId)).limit(1);
  
  if (result.length === 0) {
    // Create new usage record
    await db.insert(usageTracking).values({ userId, matchingsThisMonth: 0 });
    return { id: 0, userId, matchingsThisMonth: 0, lastResetAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
  }
  
  // Check if we need to reset monthly counters
  const lastReset = result[0].lastResetAt;
  const now = new Date();
  if (lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
    await db.update(usageTracking).set({ matchingsThisMonth: 0, lastResetAt: now }).where(eq(usageTracking.userId, userId));
    return { ...result[0], matchingsThisMonth: 0, lastResetAt: now };
  }
  
  return result[0];
}

export async function incrementMatchingCount(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(usageTracking)
    .set({ matchingsThisMonth: sql`matchingsThisMonth + 1` })
    .where(eq(usageTracking.userId, userId));
}

export async function getUserStats(userId: number, plan: PlanType) {
  const db = await getDb();
  if (!db) return null;
  
  const limits = getPlanLimits(plan);
  const usage = await getUserUsage(userId);
  
  // Count friends
  const friendCount = await db.select({ count: sql<number>`COUNT(*)` }).from(friendships)
    .where(and(
      eq(friendships.status, "accepted"),
      or(eq(friendships.userId, userId), eq(friendships.friendId, userId))
    ));
  
  // Count knowledge entries (via user's twin)
  const twin = await getDigitalTwinByUser(userId);
  let knowledgeCount = 0;
  if (twin) {
    const kbCount = await db.select({ count: sql<number>`COUNT(*)` }).from(knowledgeBase)
      .where(eq(knowledgeBase.twinId, twin.id));
    knowledgeCount = kbCount[0]?.count || 0;
  }
  
  // Count file uploads
  const fileCount = await db.select({ count: sql<number>`COUNT(*)` }).from(uploadedFiles)
    .where(eq(uploadedFiles.userId, userId));
  
  return {
    plan,
    limits,
    usage: {
      friends: friendCount[0]?.count || 0,
      matchingsThisMonth: usage?.matchingsThisMonth || 0,
      knowledgeEntries: knowledgeCount,
      fileUploads: fileCount[0]?.count || 0,
    },
    canAddFriend: limits.maxFriends === -1 || (friendCount[0]?.count || 0) < limits.maxFriends,
    canCreateMatching: limits.maxMatchingsPerMonth === -1 || (usage?.matchingsThisMonth || 0) < limits.maxMatchingsPerMonth,
    canAddKnowledge: limits.maxKnowledgeEntries === -1 || knowledgeCount < limits.maxKnowledgeEntries,
    canUploadFile: limits.maxFileUploads === -1 || (fileCount[0]?.count || 0) < limits.maxFileUploads,
    canUseExternalAI: limits.canUseExternalAI,
    canCustomizeOrchestration: limits.canCustomizeOrchestration,
  };
}

export async function updateUserPlan(userId: number, plan: PlanType): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ plan }).where(eq(users.id, userId));
}

export async function generateFriendCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars like 0/O, 1/I
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function getUserByFriendCode(friendCode: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.friendCode, friendCode)).limit(1);
  return result[0];
}

export async function setUserFriendCode(userId: number, friendCode: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ friendCode }).where(eq(users.id, userId));
}

// ============ Public Digital Twin Functions ============
export async function searchPublicTwins(query: string, excludeUserId: number, limit: number = 20): Promise<{ twin: DigitalTwin; user: User }[]> {
  const db = await getDb();
  if (!db) return [];
  
  const twins = await db.select().from(digitalTwins)
    .where(and(
      eq(digitalTwins.isPublic, 1),
      ne(digitalTwins.userId, excludeUserId),
      or(
        sql`${digitalTwins.name} LIKE ${`%${query}%`}`,
        sql`${digitalTwins.publicBio} LIKE ${`%${query}%`}`,
        sql`JSON_SEARCH(${digitalTwins.tags}, 'one', ${`%${query}%`}) IS NOT NULL`
      )
    ))
    .limit(limit);
  
  const result: { twin: DigitalTwin; user: User }[] = [];
  
  for (const twin of twins) {
    const user = await getUserById(twin.userId);
    if (user) {
      result.push({ twin, user });
    }
  }
  
  return result;
}

export async function getPublicTwins(excludeUserId: number, limit: number = 50): Promise<{ twin: DigitalTwin; user: User }[]> {
  const db = await getDb();
  if (!db) return [];
  
  const twins = await db.select().from(digitalTwins)
    .where(and(
      eq(digitalTwins.isPublic, 1),
      ne(digitalTwins.userId, excludeUserId)
    ))
    .orderBy(sql`RAND()`)
    .limit(limit);
  
  const result: { twin: DigitalTwin; user: User }[] = [];
  
  for (const twin of twins) {
    const user = await getUserById(twin.userId);
    if (user) {
      result.push({ twin, user });
    }
  }
  
  return result;
}

export async function updateTwinPublicSettings(twinId: number, isPublic: boolean, publicBio?: string, tags?: string[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(digitalTwins).set({
    isPublic: isPublic ? 1 : 0,
    publicBio: publicBio || null,
    tags: tags || null,
  }).where(eq(digitalTwins.id, twinId));
}
