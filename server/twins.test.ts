import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock database functions
vi.mock("./db", () => ({
  getDb: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
  upsertUserProfile: vi.fn().mockResolvedValue(undefined),
  getDigitalTwinsByUser: vi.fn().mockResolvedValue([]),
  getDigitalTwinById: vi.fn().mockResolvedValue(null),
  createDigitalTwin: vi.fn().mockResolvedValue(1),
  updateDigitalTwin: vi.fn().mockResolvedValue(undefined),
  deleteDigitalTwin: vi.fn().mockResolvedValue(undefined),
  getKnowledgeByTwin: vi.fn().mockResolvedValue([]),
  addKnowledgeEntry: vi.fn().mockResolvedValue(1),
  deleteKnowledgeEntry: vi.fn().mockResolvedValue(undefined),
  getUploadedFilesByUser: vi.fn().mockResolvedValue([]),
  createUploadedFile: vi.fn().mockResolvedValue(1),
  getAiApiConfigs: vi.fn().mockResolvedValue([]),
  upsertAiApiConfig: vi.fn().mockResolvedValue(undefined),
  deleteAiApiConfig: vi.fn().mockResolvedValue(undefined),
  getOrchestrationRoles: vi.fn().mockResolvedValue([]),
  createOrchestrationRole: vi.fn().mockResolvedValue(1),
  updateOrchestrationRole: vi.fn().mockResolvedValue(undefined),
  deleteOrchestrationRole: vi.fn().mockResolvedValue(undefined),
  getChatSessionsByUser: vi.fn().mockResolvedValue([]),
  getChatSessionById: vi.fn().mockResolvedValue(null),
  createChatSession: vi.fn().mockResolvedValue(1),
  getChatMessagesBySession: vi.fn().mockResolvedValue([]),
  addChatMessage: vi.fn().mockResolvedValue(1),
  getAllMatchingSessions: vi.fn().mockResolvedValue([]),
  getMatchingSessionById: vi.fn().mockResolvedValue(null),
  createMatchingSession: vi.fn().mockResolvedValue(1),
  updateMatchingSessionStatus: vi.fn().mockResolvedValue(undefined),
  getMatchingDialoguesBySession: vi.fn().mockResolvedValue([]),
  addMatchingDialogue: vi.fn().mockResolvedValue(1),
  getMatchingResultBySession: vi.fn().mockResolvedValue(null),
  createMatchingResult: vi.fn().mockResolvedValue(1),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("twins router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list twins for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.twins.list();

    expect(Array.isArray(result)).toBe(true);
  });

  it("should create a new twin", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.twins.create({
      name: "Test Twin",
      description: "A test digital twin",
      personality: "Friendly and helpful",
    });

    expect(result).toHaveProperty("id");
    expect(result.id).toBe(1);
  });
});

describe("profile router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get user profile", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.profile.get();

    expect(result).toBeDefined();
  });

  it("should update user profile", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.profile.update({
      displayName: "Updated Name",
      bio: "Updated bio",
      skills: ["JavaScript", "TypeScript"],
      expertise: ["AI", "Web Development"],
    });

    expect(result).toEqual({ success: true });
  });
});

describe("aiConfig router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list AI configs for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.aiConfig.list();

    expect(Array.isArray(result)).toBe(true);
  });

  it("should upsert AI config", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.aiConfig.upsert({
      provider: "openai",
      apiKey: "sk-test-key-12345",
    });

    expect(result).toEqual({ success: true });
  });
});

describe("orchestration router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get orchestration settings", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orchestration.getSettings();

    expect(result).toHaveProperty("taskAssignments");
    expect(result).toHaveProperty("autoSelect");
    expect(result.taskAssignments).toHaveProperty("conversation");
    expect(result.taskAssignments).toHaveProperty("analysis");
  });

  it("should update orchestration settings", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orchestration.updateSettings({
      taskAssignments: {
        conversation: "openai",
        analysis: "gemini",
        knowledge: "builtin",
        reasoning: "anthropic",
      },
      autoSelect: false,
      costOptimization: 70,
      qualityPriority: 80,
    });

    expect(result).toEqual({ success: true });
  });
});
