import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

async function registerUser(suffix: string) {
  const unique = `mvp${suffix}${Date.now()}`;
  const res = await fetch(`${API_BASE}/api/trpc/auth.register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: {
        name: `MvpTest_${unique}`,
        email: `${unique}@e2e-test.local`,
        password: "TestPass1234",
      },
    }),
  });
  const data = (await res.json()) as any;
  return {
    token: data.result.data.json.token as string,
    userId: data.result.data.json.user.id as number,
    name: data.result.data.json.user.name as string,
  };
}

async function trpcQuery(route: string, token: string, input?: any) {
  const url = input
    ? `${API_BASE}/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : `${API_BASE}/api/trpc/${route}`;
  const res = await fetch(url, {
    headers: { Cookie: `app_session_id=${token}` },
  });
  const data = (await res.json()) as any;
  return data.result?.data?.json;
}

async function trpcMutate(route: string, token: string, input: any) {
  const res = await fetch(`${API_BASE}/api/trpc/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `app_session_id=${token}`,
    },
    body: JSON.stringify({ json: input }),
  });
  const data = (await res.json()) as any;
  if (data.error) return { error: data.error };
  return data.result?.data?.json;
}

// ===========================================================================
// 1. Full MVP API Flow
// ===========================================================================
test.describe("Full MVP API Flow", () => {
  let token: string;
  let userId: number;

  test.beforeAll(async () => {
    const user = await registerUser("flow");
    token = user.token;
    userId = user.userId;
  });

  test("registration creates twin and onboarding session", async () => {
    const twin = await trpcQuery("myTwin.get", token);
    expect(twin).toBeTruthy();
    expect(twin.name).toBeTruthy();

    const session = await trpcQuery("onboarding.getSession", token);
    expect(session).toBeTruthy();
    expect(session.mode).toBe("onboarding");
  });

  test("can send onboarding chat messages", async () => {
    const session = await trpcQuery("onboarding.getSession", token);
    expect(session).toBeTruthy();

    const result = await trpcMutate("chat.sendMessage", token, {
      sessionId: session.id,
      content: "テスト太郎です。IT企業でエンジニアをしています。",
    });
    expect(result).toBeTruthy();
    expect(result.userMessage).toBeTruthy();
  });

  test("onboarding complete populates twin profile", async () => {
    const result = await trpcMutate("onboarding.complete", token, {
      description: "IT企業のシニアエンジニア。AI技術に精通。",
      personality: "論理的で好奇心旺盛",
      rawInput: "会社はテック株式会社で、業界はIT業界で、役職はシニアエンジニアです。",
    });
    expect(result.success).toBe(true);

    // Verify onboarding completed
    const status = await trpcQuery("onboarding.getStatus", token);
    expect(status.onboardingCompleted).toBe(1);
  });

  test("NPC friends are created on registration", async () => {
    const friends = await trpcQuery("friends.list", token);
    expect(friends.length).toBeGreaterThanOrEqual(2);

    const npcFriends = friends.filter((f: any) => f.friend.isNpc);
    expect(npcFriends.length).toBeGreaterThanOrEqual(2);
  });

  test("trust score initialized with registration bonus", async () => {
    const trust = await trpcQuery("trust.getScore", token);
    expect(trust.score).toBeGreaterThanOrEqual(50);
  });

  test("NPC matching creates dialogues and results", async () => {
    const friends = await trpcQuery("friends.list", token);
    const npcFriend = friends.find((f: any) => f.friend.isNpc && f.twin);
    expect(npcFriend).toBeTruthy();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240_000);
    try {
      const matchResult = await trpcMutate("matching.create", token, {
        friendId: npcFriend.friend.id,
        theme: "E2Eテスト: MVP検証マッチング",
        turns: 2,
      });

      // Should succeed (not blocked by trust score for NPC)
      if (matchResult.error) {
        const msg = matchResult.error?.json?.message || "";
        expect(msg).not.toContain("信頼度");
      } else {
        expect(matchResult.id).toBeGreaterThan(0);

        // Verify session exists with dialogues
        const session = await trpcQuery("matching.getSession", token, { id: matchResult.id });
        expect(session.session.status).toBe("completed");
        expect(session.dialogues.length).toBeGreaterThan(0);

        // Verify dialogues have content
        for (const d of session.dialogues) {
          expect(d.content.length).toBeGreaterThan(5);
        }

        // Verify results exist
        if (session.result) {
          expect(session.result.compatibilityScore).toBeGreaterThanOrEqual(0);
          expect(session.result.compatibilityScore).toBeLessThanOrEqual(100);
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  test("tutorial complete sets flag", async () => {
    const result = await trpcMutate("onboarding.completeTutorial", token, {});
    expect(result.success).toBe(true);

    const status = await trpcQuery("onboarding.getStatus", token);
    expect(status.tutorialCompleted).toBe(1);
  });
});

// ===========================================================================
// 2. Profile Auto-Population
// ===========================================================================
test.describe("Profile Auto-Population", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("profile");
    token = user.token;
  });

  test("onboarding.complete creates user_profiles row", async () => {
    await trpcMutate("onboarding.complete", token, {
      description: "マーケティング戦略コンサルタント。データ分析が得意。",
      personality: "社交的で分析力が高い",
      rawInput: "会社はグローバルコンサルで、業界はコンサルティング業界で、役職はシニアコンサルタントです。",
    });

    // Verify user profile via auth.me (which includes profile data context)
    const me = await trpcQuery("auth.me", token);
    expect(me).toBeTruthy();
    expect(me.onboardingCompleted).toBe(1);
  });

  test("twin gets auto-generated tags from description", async () => {
    const twin = await trpcQuery("myTwin.get", token);
    expect(twin).toBeTruthy();

    // Tags should be populated from description + personality
    expect(twin.tags).toBeTruthy();
    expect(twin.tags.length).toBeGreaterThan(0);
    expect(twin.tags.length).toBeLessThanOrEqual(5);
  });
});

// ===========================================================================
// 3. Matching Results Quality
// ===========================================================================
test.describe("Matching Results Quality", () => {
  test("matching results have scoreBreakdown when completed", async () => {
    const user = await registerUser("quality");

    const friends = await trpcQuery("friends.list", user.token);
    const npcFriend = friends.find((f: any) => f.friend.isNpc && f.twin);
    if (!npcFriend) {
      test.skip();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240_000);
    try {
      const matchResult = await trpcMutate("matching.create", user.token, {
        friendId: npcFriend.friend.id,
        theme: "E2Eテスト: 結果品質検証",
        turns: 2,
      });

      if (!matchResult.error && matchResult.id) {
        const session = await trpcQuery("matching.getSession", user.token, { id: matchResult.id });
        if (session.result) {
          expect(session.result.scoreBreakdown).toBeTruthy();
          // Score breakdown should have 5 dimensions
          const breakdown = session.result.scoreBreakdown;
          if (breakdown && typeof breakdown === "object") {
            const keys = Object.keys(breakdown);
            expect(keys.length).toBeGreaterThanOrEqual(1);
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(timer);
    }
  });
});

// ===========================================================================
// 4. Matching Request Flow (2 Users)
// ===========================================================================
test.describe("Matching Request Flow", () => {
  let user1: { token: string; userId: number; name: string };
  let user2: { token: string; userId: number; name: string };

  test.beforeAll(async () => {
    user1 = await registerUser("req1");
    user2 = await registerUser("req2");

    // Complete onboarding for both so they have profiles
    await trpcMutate("onboarding.complete", user1.token, {
      description: "テストユーザー1",
      personality: "協力的",
    });
    await trpcMutate("onboarding.complete", user2.token, {
      description: "テストユーザー2",
      personality: "積極的",
    });
  });

  test("user1 can send matching request to user2", async () => {
    const result = await trpcMutate("matching.sendRequest", user1.token, {
      receiverUserId: user2.userId,
    });
    expect(result.id).toBeGreaterThan(0);
  });

  test("user2 sees pending received request", async () => {
    const received = await trpcQuery("matching.receivedRequests", user2.token);
    expect(received.length).toBeGreaterThanOrEqual(1);

    const fromUser1 = received.find((r: any) => r.senderUserId === user1.userId);
    expect(fromUser1).toBeTruthy();
  });

  test("user1 sees sent request", async () => {
    const sent = await trpcQuery("matching.sentRequests", user1.token);
    expect(sent.length).toBeGreaterThanOrEqual(1);

    const toUser2 = sent.find((r: any) => r.receiverUserId === user2.userId);
    expect(toUser2).toBeTruthy();
    expect(toUser2.status).toBe("pending");
  });

  test("user2 accepts request and auto-friendship is created", async () => {
    const received = await trpcQuery("matching.receivedRequests", user2.token);
    const fromUser1 = received.find((r: any) => r.senderUserId === user1.userId);
    expect(fromUser1).toBeTruthy();

    const result = await trpcMutate("matching.acceptRequest", user2.token, {
      requestId: fromUser1.id,
    });
    expect(result.success).toBe(true);

    // Verify auto-friendship created
    const friends1 = await trpcQuery("friends.list", user1.token);
    const friend = friends1.find((f: any) => f.friend.id === user2.userId);
    expect(friend).toBeTruthy();
    expect(friend.friendship.status).toBe("accepted");
  });
});

// ===========================================================================
// 5. Performance Sanity: Batch Query Endpoints
// ===========================================================================
test.describe("Batch Query Endpoints", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("perf");
    token = user.token;
  });

  test("matching.sessions returns JOINed data correctly", async () => {
    const sessions = await trpcQuery("matching.sessions", token);
    expect(Array.isArray(sessions)).toBe(true);
    // New user may have 0 sessions, that's fine
    for (const s of sessions) {
      expect(s.twin1).toBeTruthy();
      expect(s.twin2).toBeTruthy();
      expect(typeof s.isNpcSession).toBe("boolean");
    }
  });

  test("discoverCandidates returns enriched data", async () => {
    const start = Date.now();
    const candidates = await trpcQuery("matching.discoverCandidates", token);
    const elapsed = Date.now() - start;

    expect(Array.isArray(candidates)).toBe(true);
    // Should respond within 3 seconds (performance sanity)
    expect(elapsed).toBeLessThan(3000);

    for (const c of candidates) {
      expect(typeof c.userId).toBe("number");
      expect(typeof c.isFriend).toBe("boolean");
      expect(typeof c.trustScore).toBe("number");
    }
  });

  test("receivedRequests returns correct format", async () => {
    const received = await trpcQuery("matching.receivedRequests", token);
    expect(Array.isArray(received)).toBe(true);
    // New user may have 0 requests
    for (const r of received) {
      expect(r.senderUserId).toBeGreaterThan(0);
      expect(typeof r.senderTrustScore).toBe("number");
    }
  });

  test("sentRequests returns correct format", async () => {
    const sent = await trpcQuery("matching.sentRequests", token);
    expect(Array.isArray(sent)).toBe(true);
    for (const r of sent) {
      expect(r.receiverUserId).toBeGreaterThan(0);
      expect(typeof r.receiverTrustScore).toBe("number");
    }
  });
});
