/**
 * Integration tests for the Cloudflare Worker API.
 *
 * These tests run against a local wrangler dev instance (started in globalSetup)
 * and exercise every major tRPC endpoint through real HTTP requests and a real
 * local D1 database.
 */
import { describe, it, expect, beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = process.env.WORKER_URL ?? "http://localhost:8787";

/** Call a tRPC query (GET) and return parsed JSON. */
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  let url = `${BASE}/api/trpc/${path}`;
  if (input) {
    url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  }
  const res = await fetch(url);
  return res.json() as Promise<any>;
}

/** Call a tRPC mutation (POST) and return parsed JSON. */
async function trpcMutate(path: string, input?: unknown) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input !== undefined ? { json: input } : { json: {} }),
  });
  return res.json() as Promise<any>;
}

/** Unwrap a tRPC success response. */
function unwrap(body: any) {
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result?.data?.json;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker Health", () => {
  it("GET / returns API welcome message", async () => {
    const res = await fetch(`${BASE}/`);
    const body = await res.json() as any;
    expect(body.message).toContain("Bunshin AI API");
  });

  it("GET /api/health returns ok", async () => {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it("tRPC system.health returns ok", async () => {
    const data = unwrap(await trpcQuery("system.health"));
    expect(data.ok).toBe(true);
  });
});

describe("Auth", () => {
  it("auth.me creates and returns a user", async () => {
    const data = unwrap(await trpcQuery("auth.me"));
    expect(data).toBeTruthy();
    expect(data.id).toBeDefined();
    expect(data.role).toBe("user");
    expect(data.plan).toBe("free");
  });

  it("auth.logout returns success", async () => {
    const data = unwrap(await trpcMutate("auth.logout"));
    expect(data.success).toBe(true);
  });
});

describe("Profile", () => {
  it("profile.get returns null for new user", async () => {
    const data = unwrap(await trpcQuery("profile.get"));
    expect(data).toBeNull();
  });

  it("profile.update creates a profile", async () => {
    const data = unwrap(
      await trpcMutate("profile.update", {
        displayName: "Test User",
        bio: "Test bio",
        skills: ["TypeScript", "React"],
        industry: "IT",
      })
    );
    expect(data.success).toBe(true);
  });

  it("profile.get returns created profile", async () => {
    const data = unwrap(await trpcQuery("profile.get"));
    expect(data).toBeTruthy();
    expect(data.displayName).toBe("Test User");
    expect(data.skills).toContain("TypeScript");
  });
});

describe("My Twin", () => {
  it("myTwin.get returns null when no twin exists", async () => {
    const data = unwrap(await trpcQuery("myTwin.get"));
    expect(data).toBeNull();
  });

  it("myTwin.upsert creates a twin", async () => {
    const data = unwrap(
      await trpcMutate("myTwin.upsert", {
        name: "Test Twin",
        rawInput: "I am a test twin with skills in AI",
      })
    );
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe("number");
  });

  it("myTwin.get returns the created twin", async () => {
    const data = unwrap(await trpcQuery("myTwin.get"));
    expect(data).toBeTruthy();
    expect(data.name).toBe("Test Twin");
    expect(data.rawInput).toContain("test twin");
  });

  it("myTwin.update modifies the twin", async () => {
    const data = unwrap(
      await trpcMutate("myTwin.update", {
        name: "Updated Twin",
        status: "active",
      })
    );
    expect(data.success).toBe(true);
  });

  it("myTwin.get reflects the update", async () => {
    const data = unwrap(await trpcQuery("myTwin.get"));
    expect(data.name).toBe("Updated Twin");
    expect(data.status).toBe("active");
  });

  it("myTwin.updatePublicSettings works", async () => {
    const data = unwrap(
      await trpcMutate("myTwin.updatePublicSettings", {
        isPublic: true,
        publicBio: "Public test bio",
        tags: ["AI", "test"],
      })
    );
    expect(data).toBeTruthy();
    expect(data.isPublic).toBe(1);
  });

  it("myTwin.getScenarioProgress returns progress", async () => {
    const data = unwrap(await trpcQuery("myTwin.getScenarioProgress"));
    expect(data).toBeTruthy();
    expect(data.total).toBe(18);
    expect(typeof data.completed).toBe("number");
  });

  it("myTwin.getCumulativeWaveform returns null if no data", async () => {
    const data = unwrap(await trpcQuery("myTwin.getCumulativeWaveform"));
    // May be null if no waveform data
    expect(data === null || typeof data === "object").toBe(true);
  });

  it("myTwin.searchPublic returns array", async () => {
    const data = unwrap(await trpcQuery("myTwin.searchPublic"));
    expect(Array.isArray(data)).toBe(true);
  });

  // Stub endpoints
  it("myTwin.analyzeBigFive returns stub", async () => {
    const data = unwrap(await trpcMutate("myTwin.analyzeBigFive"));
    expect(data).toBeTruthy();
  });

  it("myTwin.personalityInterview returns stub", async () => {
    const data = unwrap(
      await trpcMutate("myTwin.personalityInterview", {
        previousMessages: [],
        userResponse: "test",
      })
    );
    expect(data.message).toBeDefined();
  });

  it("myTwin.mbtiInterview returns stub", async () => {
    const data = unwrap(
      await trpcMutate("myTwin.mbtiInterview", {
        previousMessages: [],
        userResponse: "test",
      })
    );
    expect(data.message).toBeDefined();
  });

  it("myTwin.valueScenarioInterview returns stub", async () => {
    const data = unwrap(
      await trpcMutate("myTwin.valueScenarioInterview", {
        previousMessages: [],
        userResponse: "test",
      })
    );
    expect(data.message).toBeDefined();
  });
});

describe("Friends", () => {
  it("friends.list returns empty array", async () => {
    const data = unwrap(await trpcQuery("friends.list"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("friends.pendingRequests returns empty array", async () => {
    const data = unwrap(await trpcQuery("friends.pendingRequests"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("friends.sentRequests returns empty array", async () => {
    const data = unwrap(await trpcQuery("friends.sentRequests"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("friends.searchUsers returns results", async () => {
    const data = unwrap(
      await trpcQuery("friends.searchUsers", { query: "test" })
    );
    expect(Array.isArray(data)).toBe(true);
  });

  it("friends.getAllIntimacyScores returns array", async () => {
    const data = unwrap(await trpcQuery("friends.getAllIntimacyScores"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("friends.getAllWaveformCompatibilities returns object", async () => {
    const data = unwrap(
      await trpcQuery("friends.getAllWaveformCompatibilities")
    );
    expect(data).toBeTruthy();
    expect(data.hasMyWaveform === true || data.hasMyWaveform === false).toBe(true);
  });
});

describe("Knowledge Base", () => {
  it("knowledge.list returns array", async () => {
    const data = unwrap(await trpcQuery("knowledge.list"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("knowledge.add creates an entry", async () => {
    const data = unwrap(
      await trpcMutate("knowledge.add", {
        sourceType: "manual",
        title: "Test Knowledge",
        content: "Test content for knowledge base",
      })
    );
    expect(data.id).toBeDefined();
  });

  it("knowledge.list returns the added entry", async () => {
    const data = unwrap(await trpcQuery("knowledge.list"));
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].title).toBe("Test Knowledge");
  });

  it("knowledge.delete removes the entry", async () => {
    const list = unwrap(await trpcQuery("knowledge.list"));
    const data = unwrap(
      await trpcMutate("knowledge.delete", { id: list[0].id })
    );
    expect(data.success).toBe(true);
  });
});

describe("Files", () => {
  it("files.list returns array", async () => {
    const data = unwrap(await trpcQuery("files.list"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("files.upload creates an entry", async () => {
    const data = unwrap(
      await trpcMutate("files.upload", {
        filename: "test.txt",
        content: "test content",
        mimeType: "text/plain",
      })
    );
    expect(data.id).toBeDefined();
    expect(data.url).toBeDefined();
  });
});

describe("AI Config", () => {
  it("aiConfig.list returns array", async () => {
    const data = unwrap(await trpcQuery("aiConfig.list"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("aiConfig.upsert creates a config", async () => {
    const data = unwrap(
      await trpcMutate("aiConfig.upsert", {
        provider: "gemini",
        apiKey: "test-api-key",
      })
    );
    expect(data.success).toBe(true);
  });

  it("aiConfig.validate returns valid", async () => {
    const data = unwrap(
      await trpcMutate("aiConfig.validate", {
        provider: "gemini",
        apiKey: "test",
      })
    );
    expect(data.valid).toBe(true);
  });
});

describe("Orchestration", () => {
  it("orchestration.roles returns array", async () => {
    const data = unwrap(await trpcQuery("orchestration.roles"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("orchestration.createRole creates a role", async () => {
    const data = unwrap(
      await trpcMutate("orchestration.createRole", {
        roleName: "test-role",
        assignedProvider: "gemini",
      })
    );
    expect(data.id).toBeDefined();
  });

  it("orchestration.getSettings returns settings", async () => {
    const data = unwrap(await trpcQuery("orchestration.getSettings"));
    expect(data.roles).toBeDefined();
    expect(data.configs).toBeDefined();
  });
});

describe("Chat", () => {
  let sessionId: number;

  it("chat.sessions returns array", async () => {
    const data = unwrap(await trpcQuery("chat.sessions"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("chat.createSession creates a session", async () => {
    const data = unwrap(
      await trpcMutate("chat.createSession", { title: "Test Chat" })
    );
    expect(data.id).toBeDefined();
    sessionId = data.id;
  });

  it("chat.sendMessage sends and gets response", async () => {
    const data = unwrap(
      await trpcMutate("chat.sendMessage", {
        sessionId,
        content: "Hello!",
      })
    );
    expect(data.messageId).toBeDefined();
    expect(data.response).toBeDefined();
  });

  it("chat.getSession returns session with messages", async () => {
    const data = unwrap(
      await trpcQuery("chat.getSession", { id: sessionId })
    );
    expect(data.session).toBeTruthy();
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Matching", () => {
  it("matching.sessions returns array", async () => {
    const data = unwrap(await trpcQuery("matching.sessions"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("matching.availableFriends returns array", async () => {
    const data = unwrap(await trpcQuery("matching.availableFriends"));
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("Points", () => {
  it("points.getBalance returns balance", async () => {
    const data = unwrap(await trpcQuery("points.getBalance"));
    expect(data).toBeTruthy();
    expect(typeof data.balance).toBe("number");
  });

  it("points.getTransactions returns array", async () => {
    const data = unwrap(await trpcQuery("points.getTransactions"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("points.getProducts returns array", async () => {
    const data = unwrap(await trpcQuery("points.getProducts"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("points.getSettings returns array", async () => {
    const data = unwrap(await trpcQuery("points.getSettings"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("points.getQuests returns object", async () => {
    const data = unwrap(await trpcQuery("points.getQuests"));
    expect(data.stats).toBeDefined();
    expect(data.categories).toBeDefined();
  });

  it("points.checkDailyLogin returns result", async () => {
    const data = unwrap(await trpcMutate("points.checkDailyLogin"));
    expect(typeof data.points).toBe("number");
  });

  it("points.checkMilestones returns result", async () => {
    const data = unwrap(await trpcMutate("points.checkMilestones"));
    expect(data.milestones).toBeDefined();
  });
});

describe("Growth", () => {
  it("growth.getStatus returns status", async () => {
    const data = unwrap(await trpcQuery("growth.getStatus"));
    expect(data).toBeTruthy();
    expect(typeof data.level).toBe("number");
  });

  it("growth.getSkillLevels returns array", async () => {
    const data = unwrap(await trpcQuery("growth.getSkillLevels"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("growth.setSkillLevel sets a skill", async () => {
    const data = unwrap(
      await trpcMutate("growth.setSkillLevel", {
        skillType: "conversation",
        level: 3,
      })
    );
    expect(data.success).toBe(true);
  });

  it("growth.setSkillLevels sets multiple skills", async () => {
    const data = unwrap(
      await trpcMutate("growth.setSkillLevels", {
        skillLevels: { conversation: 3, image_generation: 2 },
      })
    );
    expect(data.success).toBe(true);
  });

  it("growth.areSkillsConfigured returns true after setting", async () => {
    const data = unwrap(await trpcQuery("growth.areSkillsConfigured"));
    expect(data).toBe(true);
  });

  it("growth.getMilestones returns array", async () => {
    const data = unwrap(await trpcQuery("growth.getMilestones"));
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("Cards", () => {
  let cardId: number;

  it("cards.list returns array", async () => {
    const data = unwrap(await trpcQuery("cards.list"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("cards.create creates a card", async () => {
    const data = unwrap(
      await trpcMutate("cards.create", {
        cardType: "business_card",
        name: "Test Person",
        company: "Test Corp",
        email: "test@test.com",
        tags: ["test"],
      })
    );
    expect(data.id).toBeDefined();
    cardId = data.id;
  });

  it("cards.get returns the card", async () => {
    const data = unwrap(await trpcQuery("cards.get", { id: cardId }));
    expect(data).toBeTruthy();
    expect(data.name).toBe("Test Person");
    expect(data.company).toBe("Test Corp");
  });

  it("cards.update modifies the card", async () => {
    const data = unwrap(
      await trpcMutate("cards.update", { id: cardId, name: "Updated Person" })
    );
    expect(data.success).toBe(true);
  });

  it("cards.toggleFavorite works", async () => {
    const data = unwrap(
      await trpcMutate("cards.toggleFavorite", { id: cardId })
    );
    expect(data.success).toBe(true);
  });

  it("cards.search returns results", async () => {
    const data = unwrap(
      await trpcQuery("cards.search", { query: "Updated" })
    );
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("cards.getStats returns stats", async () => {
    const data = unwrap(await trpcQuery("cards.getStats"));
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("cards.toggleArchive works", async () => {
    const data = unwrap(
      await trpcMutate("cards.toggleArchive", { id: cardId })
    );
    expect(data.success).toBe(true);
  });

  it("cards.delete removes the card", async () => {
    const data = unwrap(
      await trpcMutate("cards.delete", { id: cardId })
    );
    expect(data.success).toBe(true);
  });
});

describe("Clawdbot", () => {
  it("clawdbot.getConnection returns null for new user", async () => {
    const data = unwrap(await trpcQuery("clawdbot.getConnection"));
    expect(data === null || typeof data === "object").toBe(true);
  });

  it("clawdbot.saveConnection saves a connection", async () => {
    const data = unwrap(
      await trpcMutate("clawdbot.saveConnection", {
        gatewayUrl: "https://test-gateway.example.com",
        authToken: "test-token",
      })
    );
    expect(data.success).toBe(true);
  });

  it("clawdbot.getConnection returns saved connection", async () => {
    const data = unwrap(await trpcQuery("clawdbot.getConnection"));
    expect(data).toBeTruthy();
    expect(data.gatewayUrl).toBe("https://test-gateway.example.com");
  });

  it("clawdbot.getLearningStatus returns null or object", async () => {
    const data = unwrap(await trpcQuery("clawdbot.getLearningStatus"));
    expect(data === null || typeof data === "object").toBe(true);
  });

  it("clawdbot.testConnection returns stub", async () => {
    const data = unwrap(await trpcMutate("clawdbot.testConnection"));
    expect(data.success).toBe(true);
  });

  it("clawdbot.getModels returns object", async () => {
    const data = unwrap(await trpcQuery("clawdbot.getModels"));
    expect(data.success).toBe(true);
  });
});

describe("LINE", () => {
  it("line.getConnection returns null for new user", async () => {
    const data = unwrap(await trpcQuery("line.getConnection"));
    expect(data === null || typeof data === "object").toBe(true);
  });
});

describe("Plan", () => {
  it("plan.getCurrent returns free plan", async () => {
    const data = unwrap(await trpcQuery("plan.getCurrent"));
    expect(data.plan).toBe("free");
  });

  it("plan.getInfo returns plan info with limits", async () => {
    const data = unwrap(await trpcQuery("plan.getInfo"));
    expect(data.plan).toBe("free");
    expect(data.limits).toBeTruthy();
  });

  it("plan.getStats returns stats", async () => {
    const data = unwrap(await trpcQuery("plan.getStats"));
    expect(data).toBeTruthy();
    expect(typeof data.friendCount).toBe("number");
    expect(typeof data.matchingCount).toBe("number");
    expect(data.usage).toBeTruthy();
    expect(data.limits).toBeTruthy();
  });

  it("plan.getFriendCode returns a code", async () => {
    const data = unwrap(await trpcQuery("plan.getFriendCode"));
    expect(data.friendCode).toBeDefined();
    expect(data.friendCode.length).toBeGreaterThan(0);
  });

  it("plan.getUsage returns usage", async () => {
    const data = unwrap(await trpcQuery("plan.getUsage"));
    expect(typeof data.matchingsThisMonth).toBe("number");
  });
});

describe("User", () => {
  it("user.getFriendCode returns a code", async () => {
    const data = unwrap(await trpcQuery("user.getFriendCode"));
    expect(data.friendCode).toBeDefined();
  });

  it("user.getStats returns stats", async () => {
    const data = unwrap(await trpcQuery("user.getStats"));
    expect(data).toBeTruthy();
    expect(data.plan).toBe("free");
  });
});

describe("AI Provider", () => {
  it("aiProvider.getSettings returns array", async () => {
    const data = unwrap(await trpcQuery("aiProvider.getSettings"));
    expect(Array.isArray(data)).toBe(true);
  });

  it("aiProvider.getAvailableProviders returns providers", async () => {
    const data = unwrap(await trpcQuery("aiProvider.getAvailableProviders"));
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("aiProvider.updateSetting saves a setting", async () => {
    const data = unwrap(
      await trpcMutate("aiProvider.updateSetting", {
        feature: "chat",
        provider: "gemini",
        model: "gemini-2.0-flash",
      })
    );
    expect(data.success).toBe(true);
  });
});

describe("Discover", () => {
  it("discover.search returns array", async () => {
    const data = unwrap(await trpcQuery("discover.search"));
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("Quests", () => {
  it("quests.list returns array", async () => {
    const data = unwrap(await trpcQuery("quests.list"));
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("Twin Reset (end of test)", () => {
  it("myTwin.reset deletes the twin", async () => {
    const data = unwrap(await trpcMutate("myTwin.reset"));
    expect(data.ok).toBe(true);
  });

  it("myTwin.get returns null after reset", async () => {
    const data = unwrap(await trpcQuery("myTwin.get"));
    expect(data).toBeNull();
  });
});
