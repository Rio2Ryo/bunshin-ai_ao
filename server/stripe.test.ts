import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock database functions
vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve(null)),
  getUserById: vi.fn(() => Promise.resolve(null)),
  updateUserPlan: vi.fn(() => Promise.resolve()),
  getUserUsage: vi.fn(() => Promise.resolve({ 
    id: 1,
    userId: 1,
    matchingsThisMonth: 2,
    lastResetAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  getPlanLimits: vi.fn((plan: string) => {
    if (plan === "free") {
      return {
        maxMatchingsPerMonth: 5,
        maxFriends: 10,
        maxKnowledgeEntries: 50,
        canUseAdvancedAI: false,
      };
    } else if (plan === "premium") {
      return {
        maxMatchingsPerMonth: 30,
        maxFriends: 50,
        maxKnowledgeEntries: 200,
        canUseAdvancedAI: true,
      };
    } else {
      return {
        maxMatchingsPerMonth: -1,
        maxFriends: -1,
        maxKnowledgeEntries: -1,
        canUseAdvancedAI: true,
      };
    }
  }),
  getUserStats: vi.fn((userId: number, plan: string) => {
    const limits = plan === "free" 
      ? { maxMatchingsPerMonth: 5, maxFriends: 10, maxKnowledgeEntries: 50, canUseAdvancedAI: false }
      : plan === "premium"
        ? { maxMatchingsPerMonth: 30, maxFriends: 50, maxKnowledgeEntries: 200, canUseAdvancedAI: true }
        : { maxMatchingsPerMonth: -1, maxFriends: -1, maxKnowledgeEntries: -1, canUseAdvancedAI: true };
    
    return Promise.resolve({
      matchingsThisMonth: 2,
      friendCount: 3,
      knowledgeCount: 10,
      limits,
      canCreateMatching: true,
      canAddFriend: true,
    });
  }),
}));

// Mock Stripe
vi.mock("./stripe/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(() => Promise.resolve({
          id: "cs_test_123",
          url: "https://checkout.stripe.com/test",
        })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(() => Promise.resolve({
          url: "https://billing.stripe.com/test",
        })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(() => Promise.resolve({
        id: "sub_test_123",
        status: "active",
      })),
      cancel: vi.fn(() => Promise.resolve(true)),
    },
  },
  createCheckoutSession: vi.fn(() => Promise.resolve({
    url: "https://checkout.stripe.com/test",
    sessionId: "cs_test_123",
  })),
  createPortalSession: vi.fn(() => Promise.resolve({
    url: "https://billing.stripe.com/test",
  })),
  getSubscription: vi.fn(() => Promise.resolve({
    id: "sub_test_123",
    status: "active",
  })),
  cancelSubscription: vi.fn(() => Promise.resolve(true)),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(plan: "free" | "premium" | "enterprise" = "free"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    plan,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {
        origin: "https://example.com",
      },
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("plan router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get plan info for free user", async () => {
    const ctx = createAuthContext("free");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.plan.getInfo();

    expect(result).toHaveProperty("plan", "free");
    expect(result).toHaveProperty("limits");
    expect(result.limits).toHaveProperty("maxMatchingsPerMonth");
    expect(result.limits).toHaveProperty("maxFriends");
  });

  it("should get plan info for premium user", async () => {
    const ctx = createAuthContext("premium");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.plan.getInfo();

    expect(result).toHaveProperty("plan", "premium");
    expect(result).toHaveProperty("limits");
  });

  it("should get usage statistics", async () => {
    const ctx = createAuthContext("free");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.plan.getUsage();

    expect(result).toHaveProperty("matchingsThisMonth");
    expect(typeof result.matchingsThisMonth).toBe("number");
  });
});

describe("plan limits", () => {
  it("should have correct limits for free plan", async () => {
    const ctx = createAuthContext("free");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.plan.getInfo();

    expect(result.limits.maxMatchingsPerMonth).toBe(5);
    expect(result.limits.maxFriends).toBe(10);
    expect(result.limits.canUseAdvancedAI).toBe(false);
  });

  it("should have correct limits for premium plan", async () => {
    const ctx = createAuthContext("premium");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.plan.getInfo();

    expect(result.limits.maxMatchingsPerMonth).toBe(30);
    expect(result.limits.maxFriends).toBe(50);
    expect(result.limits.canUseAdvancedAI).toBe(true);
  });

  it("should have unlimited for enterprise plan", async () => {
    const ctx = createAuthContext("enterprise");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.plan.getInfo();

    expect(result.limits.maxMatchingsPerMonth).toBe(-1); // -1 = unlimited
    expect(result.limits.maxFriends).toBe(-1);
    expect(result.limits.canUseAdvancedAI).toBe(true);
  });
});
