import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock database functions
vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve(null)),
  getDigitalTwinByUser: vi.fn(() => Promise.resolve({
    id: 1,
    userId: 1,
    name: "My Twin",
    description: "My twin description",
    isPublic: 0,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  searchPublicTwins: vi.fn(() => Promise.resolve([
    {
      twin: {
        id: 2,
        userId: 2,
        name: "Test Public Twin",
        description: "A public twin for testing",
        isPublic: 1,
        publicBio: "I am a public twin",
        tags: ["marketing", "ai"],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: 2,
        openId: "user-2",
        name: "Public User",
        email: "public@example.com",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    },
  ])),
  getPublicTwins: vi.fn(() => Promise.resolve([
    {
      twin: {
        id: 3,
        userId: 3,
        name: "Another Public Twin",
        description: "Another public twin",
        isPublic: 1,
        publicBio: "I am another public twin",
        tags: ["business", "startup"],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: 3,
        openId: "user-3",
        name: "Another User",
        email: "another@example.com",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    },
  ])),
  updateTwinPublicSettings: vi.fn(() => Promise.resolve()),
  getDigitalTwinById: vi.fn(() => Promise.resolve({
    id: 2,
    userId: 2,
    name: "Test Public Twin",
    description: "A public twin for testing",
    isPublic: 1,
    publicBio: "I am a public twin",
    tags: ["marketing", "ai"],
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  getUserById: vi.fn(() => Promise.resolve({
    id: 2,
    openId: "user-2",
    name: "Public User",
    email: "public@example.com",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  })),
  sendFriendRequest: vi.fn(() => Promise.resolve(1)),
  getFriends: vi.fn(() => Promise.resolve([])),
  getPendingFriendRequests: vi.fn(() => Promise.resolve([])),
  getSentFriendRequests: vi.fn(() => Promise.resolve([])),
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

describe("myTwin.searchPublic router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should search public twins by query", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.searchPublic({ query: "marketing" });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("twin");
    expect(result[0]).toHaveProperty("user");
    expect(result[0].twin).toHaveProperty("isPublic", 1);
  });

  it("should list public twins without query", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.searchPublic({});

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("twin");
    expect(result[0]).toHaveProperty("user");
  });

  it("should exclude current user's twins from search results", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.searchPublic({ query: "test" });

    // All results should have different userId than current user
    result.forEach((item) => {
      expect(item.twin.userId).not.toBe(ctx.user?.id);
    });
  });

  it("should return twins with tags", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.searchPublic({ query: "marketing" });

    expect(result[0].twin).toHaveProperty("tags");
    expect(Array.isArray(result[0].twin.tags)).toBe(true);
  });
});

describe("myTwin.getPublicTwin router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get public twin details", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.getPublicTwin({ twinId: 2 });

    expect(result).toHaveProperty("twin");
    expect(result).toHaveProperty("user");
    expect(result.twin.id).toBe(2);
    expect(result.twin.isPublic).toBe(1);
  });
});

describe("myTwin.updatePublicSettings router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update public settings", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.updatePublicSettings({
      isPublic: true,
      publicBio: "My public bio",
      tags: ["tag1", "tag2"],
    });

    expect(result).toEqual({ success: true });
  });

  it("should accept empty tags array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.updatePublicSettings({
      isPublic: true,
      publicBio: "My public bio",
      tags: [],
    });

    expect(result).toEqual({ success: true });
  });

  it("should allow setting isPublic to false", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.myTwin.updatePublicSettings({
      isPublic: false,
    });

    expect(result).toEqual({ success: true });
  });
});
