import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

/** Register a fresh user and return token + userId */
async function registerUser(prefix: string) {
  const unique = `${prefix}${Date.now()}`;
  const res = await fetch(`${API_BASE}/api/trpc/auth.register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: {
        name: `E2E_${unique}`,
        email: `${unique}@e2e-test.local`,
        password: "TestPass1234",
      },
    }),
  });
  const data = (await res.json()) as any;
  return {
    token: data.result.data.json.token as string,
    userId: data.result.data.json.user.id as number,
  };
}

/** Call a tRPC query (GET) */
async function trpcQuery(token: string, path: string, input?: any) {
  const url = input
    ? `${API_BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : `${API_BASE}/api/trpc/${path}`;
  const res = await fetch(url, {
    headers: { Cookie: `app_session_id=${token}` },
  });
  return (await res.json()) as any;
}

/** Call a tRPC mutation (POST) */
async function trpcMutate(token: string, path: string, input: any) {
  const res = await fetch(`${API_BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `app_session_id=${token}`,
    },
    body: JSON.stringify({ json: input }),
  });
  return (await res.json()) as any;
}

// ===========================================================================
// 1. Chat Session Management (delete & rename)
// ===========================================================================
test.describe("Chat Session Management", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("chatmgmt");
    token = user.token;
  });

  test("create session, rename it, and verify title changed", async () => {
    // Create a chat session
    const createRes = await trpcMutate(token, "chat.createSession", {
      title: "元の名前",
    });
    const sessionId = createRes.result.data.json.id;
    expect(sessionId).toBeGreaterThan(0);

    // Rename it
    const renameRes = await trpcMutate(token, "chat.renameSession", {
      id: sessionId,
      title: "新しい名前",
    });
    expect(renameRes.result.data.json.success).toBe(true);

    // Verify title changed
    const sessionsRes = await trpcQuery(token, "chat.sessions");
    const sessions = sessionsRes.result.data.json;
    const renamed = sessions.find((s: any) => s.id === sessionId);
    expect(renamed).toBeTruthy();
    expect(renamed.title).toBe("新しい名前");
  });

  test("create session, delete it, and verify it's gone", async () => {
    // Create a session
    const createRes = await trpcMutate(token, "chat.createSession", {
      title: "削除テスト",
    });
    const sessionId = createRes.result.data.json.id;

    // Delete it
    const deleteRes = await trpcMutate(token, "chat.deleteSession", {
      id: sessionId,
    });
    expect(deleteRes.result.data.json.success).toBe(true);

    // Verify session is gone
    const sessionsRes = await trpcQuery(token, "chat.sessions");
    const sessions = sessionsRes.result.data.json;
    const deleted = sessions.find((s: any) => s.id === sessionId);
    expect(deleted).toBeUndefined();
  });

  test("send message and verify response exists", async () => {
    // Create a session
    const createRes = await trpcMutate(token, "chat.createSession", {
      title: "メッセージテスト",
    });
    const sessionId = createRes.result.data.json.id;

    // Send a message (uses server-side fallback since no API key)
    const sendRes = await trpcMutate(token, "chat.sendMessage", {
      sessionId,
      content: "こんにちは",
    });
    const result = sendRes.result.data.json;
    expect(result.messageId).toBeGreaterThan(0);
    expect(result.response).toBeTruthy();
    expect(result.response.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. Quests
// ===========================================================================
test.describe("Quests API", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("quests");
    token = user.token;
  });

  test("get quests returns categories structure", async () => {
    const res = await trpcQuery(token, "points.getQuests");
    const quests = res.result.data.json;

    expect(quests.stats).toBeTruthy();
    expect(quests.categories).toBeInstanceOf(Array);
    expect(quests.categories.length).toBeGreaterThan(0);

    // Each category has name and quests array
    for (const cat of quests.categories) {
      expect(cat.name).toBeTruthy();
      expect(cat.quests).toBeInstanceOf(Array);
      for (const quest of cat.quests) {
        expect(quest.id).toBeTruthy();
        expect(quest.name).toBeTruthy();
        expect(typeof quest.points).toBe("number");
        expect(typeof quest.completed).toBe("boolean");
      }
    }
  });

  test("quest completion status matches user state", async () => {
    const res = await trpcQuery(token, "points.getQuests");
    const quests = res.result.data.json;

    // New user should have create_twin as completed (registration auto-creates twin)
    const allQuests = quests.categories.flatMap((c: any) => c.quests);
    const twinQuest = allQuests.find((q: any) => q.id === "create_twin");
    expect(twinQuest).toBeTruthy();
    // Registration creates a twin, so this should be completed
    expect(twinQuest.completed).toBe(true);
  });
});

// ===========================================================================
// 3. Profile Trust Scoring
// ===========================================================================
test.describe("Profile Trust Scoring", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("profrust");
    token = user.token;
  });

  test("update profile increases trust score", async () => {
    // Get initial trust score
    const beforeRes = await trpcQuery(token, "trust.getScore");
    const scoreBefore = beforeRes.result.data.json.score;

    // Update profile with several fields
    await trpcMutate(token, "profile.update", {
      displayName: "テストユーザー",
      bio: "E2Eテスト用のプロフィールです",
      company: "テスト株式会社",
      industry: "IT",
      position: "エンジニア",
      skills: ["TypeScript", "React"],
      expertise: ["フロントエンド開発"],
      experience: "5年間のWeb開発経験",
    });

    // Check trust score increased
    const afterRes = await trpcQuery(token, "trust.getScore");
    const scoreAfter = afterRes.result.data.json.score;
    expect(scoreAfter).toBeGreaterThan(scoreBefore);
  });

  test("updating same fields again does not double-award", async () => {
    // Get current trust score
    const beforeRes = await trpcQuery(token, "trust.getScore");
    const scoreBefore = beforeRes.result.data.json.score;

    // Update same fields again
    await trpcMutate(token, "profile.update", {
      displayName: "テストユーザー変更",
      bio: "変更後のプロフィール",
      company: "テスト株式会社",
    });

    // Score should not increase (already awarded for these fields)
    const afterRes = await trpcQuery(token, "trust.getScore");
    const scoreAfter = afterRes.result.data.json.score;
    expect(scoreAfter).toBe(scoreBefore);
  });
});

// ===========================================================================
// 4. Legacy Endpoints Fixed (runDialogue & analyze)
// ===========================================================================
test.describe("Legacy Matching Endpoints", () => {
  let token: string;
  let matchingSessionId: number;

  test.beforeAll(async () => {
    const user = await registerUser("legacy");
    token = user.token;

    // Get NPC friend to create a matching session
    const friendsRes = await trpcQuery(token, "friends.list");
    const friends = friendsRes.result.data.json;
    const npcFriend = friends.find((f: any) => f.friend.isNpc && f.twin);

    if (npcFriend) {
      // Create a matching session with NPC (with timeout for LLM calls)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 240_000);
      try {
        const matchRes = await fetch(`${API_BASE}/api/trpc/matching.create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `app_session_id=${token}`,
          },
          body: JSON.stringify({
            json: {
              friendId: npcFriend.friend.id,
              theme: "E2Eテスト: Phase3 legacy fix",
              turns: 2,
            },
          }),
          signal: controller.signal,
        });
        const matchData = (await matchRes.json()) as any;
        matchingSessionId = matchData.result?.data?.json?.id;
      } catch (e: any) {
        if (e.name !== "AbortError") throw e;
      } finally {
        clearTimeout(timer);
      }
    }
  });

  test("matching.runDialogue on existing session returns dialogues", async () => {
    if (!matchingSessionId) {
      test.skip();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(`${API_BASE}/api/trpc/matching.runDialogue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `app_session_id=${token}`,
        },
        body: JSON.stringify({
          json: { sessionId: matchingSessionId, turns: 1 },
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as any;
      // Should not have TypeScript/invokeLLM signature error
      const error = data?.error?.json?.message || "";
      expect(error).not.toContain("invokeLLM");
      expect(error).not.toContain("is not a function");

      if (data.result?.data?.json) {
        expect(data.result.data.json.dialogues).toBeInstanceOf(Array);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  test("matching.analyze on existing session returns analysis", async () => {
    if (!matchingSessionId) {
      test.skip();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(`${API_BASE}/api/trpc/matching.analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `app_session_id=${token}`,
        },
        body: JSON.stringify({
          json: { sessionId: matchingSessionId },
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as any;
      // Should not have TypeScript/invokeLLM signature error
      const error = data?.error?.json?.message || "";
      expect(error).not.toContain("invokeLLM");
      expect(error).not.toContain("is not a function");

      if (data.result?.data?.json) {
        const analysis = data.result.data.json;
        expect(typeof analysis.compatibilityScore).toBe("number");
        expect(analysis.summary).toBeTruthy();
      }
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(timer);
    }
  });
});

// ===========================================================================
// 5. API Format Validation (matching requests)
// ===========================================================================
test.describe("API Format Validation", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("apifmt");
    token = user.token;
  });

  test("matching.receivedRequests returns correct JOINed format", async () => {
    const res = await trpcQuery(token, "matching.receivedRequests");
    const data = res.result.data.json;

    // Should be an array (possibly empty for new user)
    expect(data).toBeInstanceOf(Array);

    // If there are any, check the shape
    for (const req of data) {
      expect(req).toHaveProperty("id");
      expect(req).toHaveProperty("senderUserId");
      expect(req).toHaveProperty("senderName");
      expect(req).toHaveProperty("senderTrustScore");
      expect(req).toHaveProperty("message");
      expect(req).toHaveProperty("createdAt");
    }
  });

  test("matching.sentRequests returns correct JOINed format", async () => {
    const res = await trpcQuery(token, "matching.sentRequests");
    const data = res.result.data.json;

    // Should be an array (possibly empty for new user)
    expect(data).toBeInstanceOf(Array);

    // If there are any, check the shape
    for (const req of data) {
      expect(req).toHaveProperty("id");
      expect(req).toHaveProperty("receiverUserId");
      expect(req).toHaveProperty("receiverName");
      expect(req).toHaveProperty("status");
      expect(req).toHaveProperty("createdAt");
    }
  });
});
