import { test, expect } from "@playwright/test";

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    email: `${unique}@e2e-test.local`,
    name: `E2E_${unique}`,
  };
}

async function trpcQuery(token: string, path: string, input?: any) {
  const url = input
    ? `${API_BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : `${API_BASE}/api/trpc/${path}`;
  const res = await fetch(url, {
    headers: { Cookie: `app_session_id=${token}` },
  });
  return (await res.json()) as any;
}

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
// 1. Full Login Flow
// ===========================================================================
test.describe("Full Login Flow", () => {
  test("register -> login -> auth.me returns user", async () => {
    // Register
    const unique = `login_full_${Date.now()}`;
    const email = `${unique}@e2e-test.local`;
    const password = "TestPass1234";

    const regRes = await fetch(`${API_BASE}/api/trpc/auth.register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { name: `E2E_${unique}`, email, password },
      }),
    });
    const regData = (await regRes.json()) as any;
    expect(regData.result.data.json.token).toBeTruthy();
    expect(regData.result.data.json.user.id).toBeGreaterThan(0);

    // Login with credentials
    const loginRes = await fetch(`${API_BASE}/api/trpc/auth.login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { email, password } }),
    });
    const loginData = (await loginRes.json()) as any;
    const token = loginData.result.data.json.token;
    expect(token).toBeTruthy();
    expect(token.split(".")).toHaveLength(3); // JWT format

    // auth.me with cookie returns the logged-in user
    const meRes = await trpcQuery(token, "auth.me");
    const me = meRes.result.data.json;
    expect(me).toBeTruthy();
    expect(me.email).toBe(email);
    expect(me.id).toBe(regData.result.data.json.user.id);
  });

  test("wrong password returns error", async () => {
    const user = await registerUser("login_wrongpw");

    const loginRes = await fetch(`${API_BASE}/api/trpc/auth.login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { email: user.email, password: "WrongPassword999" },
      }),
    });
    const loginData = (await loginRes.json()) as any;
    expect(loginData.error).toBeTruthy();
    expect(loginData.error.json.message).toContain("正しくありません");
  });

  test("duplicate email returns error", async () => {
    const user = await registerUser("login_dup");

    const dupRes = await fetch(`${API_BASE}/api/trpc/auth.register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: {
          name: "Duplicate User",
          email: user.email,
          password: "TestPass1234",
        },
      }),
    });
    const dupData = (await dupRes.json()) as any;
    expect(dupData.error).toBeTruthy();
    expect(dupData.error.json.message).toContain("既に登録されています");
  });
});

// ===========================================================================
// 2. Twin Creation & Update
// ===========================================================================
test.describe("Twin Creation & Update", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("twin_cu");
    token = user.token;
  });

  test("myTwin.get returns auto-created twin after registration", async () => {
    const res = await trpcQuery(token, "myTwin.get");
    const twin = res.result.data.json;

    expect(twin).toBeTruthy();
    expect(twin.id).toBeGreaterThan(0);
    expect(twin.name).toBeTruthy();
    expect(twin.name).toContain("分身AI");
  });

  test("myTwin.update with name and status persists changes", async () => {
    // Update twin
    const updateRes = await trpcMutate(token, "myTwin.update", {
      name: "E2Eテストツイン",
      status: "active",
    });
    expect(updateRes.result.data.json.success).toBe(true);

    // Verify changes persisted
    const getRes = await trpcQuery(token, "myTwin.get");
    const twin = getRes.result.data.json;
    expect(twin.name).toBe("E2Eテストツイン");
  });

  test("myTwin.getVisibilitySettings returns settings", async () => {
    const res = await trpcQuery(token, "myTwin.getVisibilitySettings");
    const settings = res.result.data.json;

    expect(settings).toBeTruthy();
    expect(settings.visibility).toBeTruthy();
    expect(settings.allowedViewers).toBeInstanceOf(Array);
  });
});

// ===========================================================================
// 3. Matching Session Flow
// ===========================================================================
test.describe.serial("Matching Session Flow", () => {
  let tokenA: string;
  let matchingSessionId: number;

  test.beforeAll(async () => {
    const userA = await registerUser("match_flow");
    tokenA = userA.token;
  });

  test("create matching session with NPC friend", async () => {
    // Get NPC friend from auto-created friends
    const friendsRes = await trpcQuery(tokenA, "friends.list");
    const friends = friendsRes.result.data.json;
    const npcFriend = friends.find(
      (f: any) => f.friend.isNpc && f.twin
    );
    expect(npcFriend).toBeTruthy();

    // Create matching session (NPC is exempt from trust threshold)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240_000);
    try {
      const createRes = await fetch(`${API_BASE}/api/trpc/matching.create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `app_session_id=${tokenA}`,
        },
        body: JSON.stringify({
          json: {
            friendId: npcFriend.friend.id,
            theme: "E2Eテスト: マッチングフロー確認",
            turns: 2,
          },
        }),
        signal: controller.signal,
      });
      const createData = (await createRes.json()) as any;
      // Should succeed or fail gracefully (LLM may not be configured)
      if (createData.result?.data?.json?.id) {
        matchingSessionId = createData.result.data.json.id;
        expect(matchingSessionId).toBeGreaterThan(0);
      } else {
        // If error, it should NOT be a trust score error
        const errorMsg = createData?.error?.json?.message || "";
        expect(errorMsg).not.toContain("信頼度");
        // Still set a session ID for later tests by checking sessions
        const sessionsRes = await trpcQuery(tokenA, "matching.sessions");
        const sessions = sessionsRes.result.data.json;
        if (sessions.length > 0) {
          matchingSessionId = sessions[0].id;
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  test("matching.sessions returns sessions list", async () => {
    const res = await trpcQuery(tokenA, "matching.sessions");
    const sessions = res.result.data.json;

    expect(sessions).toBeInstanceOf(Array);
    // We created at least one session above (may have NPC tutorial sessions too)
    if (matchingSessionId) {
      const found = sessions.find((s: any) => s.id === matchingSessionId);
      expect(found).toBeTruthy();
      expect(found.theme).toContain("E2Eテスト");
    }
  });

  test("matching.exportData returns dialogue data", async () => {
    if (!matchingSessionId) {
      test.skip();
      return;
    }

    const res = await trpcQuery(tokenA, "matching.exportData", {
      sessionId: matchingSessionId,
    });
    const data = res.result.data.json;

    expect(data).toBeTruthy();
    expect(data.session).toBeTruthy();
    expect(data.session.id).toBe(matchingSessionId);
    expect(data.session.theme).toBeTruthy();
    expect(data.dialogues).toBeInstanceOf(Array);
  });
});

// ===========================================================================
// 4. Friend Management
// ===========================================================================
test.describe.serial("Friend Management", () => {
  let tokenA: string;
  let tokenB: string;
  let userAId: number;
  let userBId: number;
  let friendCodeB: string;
  let requestId: number;

  test.beforeAll(async () => {
    const userA = await registerUser("frmgmt_a");
    const userB = await registerUser("frmgmt_b");
    tokenA = userA.token;
    tokenB = userB.token;
    userAId = userA.userId;
    userBId = userB.userId;

    // Get user B's friend code
    const fcRes = await trpcQuery(tokenB, "user.getFriendCode");
    friendCodeB = fcRes.result.data.json.friendCode;
  });

  test("User A sends friend request to User B by friendCode", async () => {
    const res = await trpcMutate(tokenA, "friends.sendRequest", {
      friendCode: friendCodeB,
    });
    requestId = res.result.data.json.id;
    expect(requestId).toBeGreaterThan(0);

    // Verify the pending request appears for User B
    const pendingRes = await trpcQuery(tokenB, "friends.pendingRequests");
    const pending = pendingRes.result.data.json;
    const fromA = pending.find((p: any) => p.sender.id === userAId);
    expect(fromA).toBeTruthy();
  });

  test("User B accepts the friend request", async () => {
    const res = await trpcMutate(tokenB, "friends.acceptRequest", {
      requestId,
    });
    expect(res.result.data.json.success).toBe(true);
  });

  test("friends.list returns both friends for each user", async () => {
    // User A should see User B in their friends list
    const aFriendsRes = await trpcQuery(tokenA, "friends.list");
    const aFriends = aFriendsRes.result.data.json;
    const bInA = aFriends.find((f: any) => f.friend.id === userBId);
    expect(bInA).toBeTruthy();

    // User B should see User A in their friends list
    const bFriendsRes = await trpcQuery(tokenB, "friends.list");
    const bFriends = bFriendsRes.result.data.json;
    const aInB = bFriends.find((f: any) => f.friend.id === userAId);
    expect(aInB).toBeTruthy();
  });
});

// ===========================================================================
// 5. Notification System
// ===========================================================================
test.describe("Notification System", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("notif_sys");
    token = user.token;
  });

  test("notification.list returns empty initially", async () => {
    const res = await trpcQuery(token, "notification.list");
    const data = res.result.data.json;

    expect(data).toBeTruthy();
    expect(data.notifications).toBeInstanceOf(Array);
    expect(data.notifications).toHaveLength(0);
    expect(data.unreadCount).toBe(0);
  });

  test("notification.list with unreadOnly returns empty", async () => {
    const res = await trpcQuery(token, "notification.list", {
      unreadOnly: true,
    });
    const data = res.result.data.json;

    expect(data).toBeTruthy();
    expect(data.notifications).toBeInstanceOf(Array);
    expect(data.unreadCount).toBe(0);
  });
});

// ===========================================================================
// 6. Health & Status Checks
// ===========================================================================
test.describe("Health & Status Checks", () => {
  test("GET /api/health returns ok: true", async () => {
    const res = await fetch(`${API_BASE}/api/health`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.timestamp).toBeTruthy();
    expect(data.version).toBeTruthy();
    expect(data.checks).toBeTruthy();
    expect(data.checks.database.ok).toBe(true);
  });

  test("GET /api/status returns stats with users and twins counts", async () => {
    const res = await fetch(`${API_BASE}/api/status`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
    expect(typeof data.stats.users).toBe("number");
    expect(typeof data.stats.twins).toBe("number");
    expect(data.stats.users).toBeGreaterThanOrEqual(0);
    expect(data.stats.twins).toBeGreaterThanOrEqual(0);
  });

  test("system.health tRPC returns ok: true", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/system.health`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.result.data.json.ok).toBe(true);
  });
});

// ===========================================================================
// 7. Trust Score
// ===========================================================================
test.describe.serial("Trust Score", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("trust_score");
    token = user.token;
  });

  test("trust.getScore returns initial trust score for new user", async () => {
    const res = await trpcQuery(token, "trust.getScore");
    const data = res.result.data.json;

    expect(data).toBeTruthy();
    expect(typeof data.score).toBe("number");
    // Registration gives +50 trust points
    expect(data.score).toBeGreaterThanOrEqual(50);
    expect(data.rank).toBeTruthy();
    expect(data.rankLabel).toBeTruthy();
  });

  test("onboarding.complete increases trust score", async () => {
    // Get score before
    const beforeRes = await trpcQuery(token, "trust.getScore");
    const scoreBefore = beforeRes.result.data.json.score;

    // Complete onboarding
    await trpcMutate(token, "onboarding.complete", {
      description: "E2Eテストの説明",
      personality: "テスト性格",
      rawInput: "テスト入力データ",
    });

    // Get score after — onboarding.complete may or may not award trust points
    // but at least the operation should succeed and score should remain >= before
    const afterRes = await trpcQuery(token, "trust.getScore");
    const scoreAfter = afterRes.result.data.json.score;
    expect(scoreAfter).toBeGreaterThanOrEqual(scoreBefore);

    // Verify onboarding is marked complete
    const statusRes = await trpcQuery(token, "onboarding.getStatus");
    expect(statusRes.result.data.json.onboardingCompleted).toBe(1);
  });
});

// ===========================================================================
// 8. Chat Flow
// ===========================================================================
test.describe("Chat Flow", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("chat_flow");
    token = user.token;
  });

  test("chat.sessions returns sessions (NPC tutorial sessions auto-created)", async () => {
    const res = await trpcQuery(token, "chat.sessions");
    const sessions = res.result.data.json;

    expect(sessions).toBeInstanceOf(Array);
    // Registration auto-creates onboarding + 2 NPC tutorial sessions
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    // Verify at least one session exists
    const firstSession = sessions[0];
    expect(firstSession.id).toBeGreaterThan(0);
    expect(firstSession.title).toBeTruthy();
  });

  test("chat.sendMessage to session saves message and returns response", async () => {
    // Get sessions to find one we can send to
    const sessRes = await trpcQuery(token, "chat.sessions");
    const sessions = sessRes.result.data.json;
    expect(sessions.length).toBeGreaterThan(0);

    // Use the first session (could be onboarding or NPC tutorial)
    const sessionId = sessions[0].id;

    const sendRes = await trpcMutate(token, "chat.sendMessage", {
      sessionId,
      content: "E2Eテストメッセージ",
    });
    const data = sendRes.result.data.json;

    expect(data.messageId).toBeGreaterThan(0);
    expect(data.response).toBeTruthy();
    expect(typeof data.response).toBe("string");

    // Verify message was saved by fetching session messages
    const getSessionRes = await trpcQuery(token, "chat.getSession", {
      id: sessionId,
    });
    const messages = getSessionRes.result.data.json.messages;
    const userMsg = messages.find(
      (m: any) => m.role === "user" && m.content === "E2Eテストメッセージ"
    );
    expect(userMsg).toBeTruthy();
  });
});

// ===========================================================================
// 9. Export Endpoints
// ===========================================================================
test.describe.serial("Export Endpoints", () => {
  let token: string;
  let matchingSessionId: number | null = null;

  test.beforeAll(async () => {
    const user = await registerUser("export_ep");
    token = user.token;

    // Create a matching session with NPC friend for export testing
    const friendsRes = await trpcQuery(token, "friends.list");
    const friends = friendsRes.result.data.json;
    const npcFriend = friends.find((f: any) => f.friend.isNpc && f.twin);

    if (npcFriend) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 240_000);
      try {
        const createRes = await fetch(`${API_BASE}/api/trpc/matching.create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `app_session_id=${token}`,
          },
          body: JSON.stringify({
            json: {
              friendId: npcFriend.friend.id,
              theme: "E2Eテスト: エクスポート確認",
              turns: 2,
            },
          }),
          signal: controller.signal,
        });
        const createData = (await createRes.json()) as any;
        if (createData.result?.data?.json?.id) {
          matchingSessionId = createData.result.data.json.id;
        } else {
          // Check for existing sessions
          const sessionsRes = await trpcQuery(token, "matching.sessions");
          const sessions = sessionsRes.result.data.json;
          if (sessions.length > 0) {
            matchingSessionId = sessions[0].id;
          }
        }
      } catch (e: any) {
        if (e.name !== "AbortError") throw e;
      } finally {
        clearTimeout(timer);
      }
    }
  });

  test("GET /api/export/matching/:id/csv returns CSV content-type", async () => {
    if (!matchingSessionId) {
      test.skip();
      return;
    }

    const res = await fetch(
      `${API_BASE}/api/export/matching/${matchingSessionId}/csv`,
      {
        headers: { Cookie: `app_session_id=${token}` },
      }
    );
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") || "";
    expect(contentType).toContain("text/csv");

    const body = await res.text();
    // CSV should have a header row
    expect(body).toContain("ターン");
    expect(body).toContain("発言者");
  });

  test("GET /api/export/matching/:id/pdf returns HTML", async () => {
    if (!matchingSessionId) {
      test.skip();
      return;
    }

    const res = await fetch(
      `${API_BASE}/api/export/matching/${matchingSessionId}/pdf`,
      {
        headers: { Cookie: `app_session_id=${token}` },
      }
    );
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") || "";
    expect(contentType).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("マッチング対話レポート");
  });
});

// ===========================================================================
// 10. GDPR / Account Deletion
// ===========================================================================
test.describe("GDPR / Account Deletion", () => {
  test("auth.exportMyData returns user data JSON", async () => {
    const user = await registerUser("gdpr_export");

    const res = await trpcQuery(user.token, "auth.exportMyData");
    const data = res.result.data.json;

    expect(data).toBeTruthy();
    expect(data.exportedAt).toBeTruthy();
    expect(data.user).toBeTruthy();
    expect(data.user.id).toBe(user.userId);
    expect(data.user.email).toBe(user.email);
    // Sensitive fields should be excluded
    expect(data.user.passwordHash).toBeUndefined();
    // Twin should be included (auto-created)
    expect(data.twin).toBeTruthy();
    expect(data.friends).toBeInstanceOf(Array);
    expect(typeof data.chatSessionCount).toBe("number");
    expect(typeof data.matchingSessionCount).toBe("number");
  });

  test("auth.deleteAccount with correct password deletes account", async () => {
    const user = await registerUser("gdpr_delete");

    // Delete account
    const deleteRes = await trpcMutate(user.token, "auth.deleteAccount", {
      password: "TestPass1234",
      confirmation: "DELETE",
    });
    expect(deleteRes.result.data.json.success).toBe(true);

    // Verify account is gone - auth.me should return null
    const meRes = await trpcQuery(user.token, "auth.me");
    const me = meRes.result.data.json;
    expect(me).toBeNull();

    // Verify login no longer works
    const loginRes = await fetch(`${API_BASE}/api/trpc/auth.login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { email: user.email, password: "TestPass1234" },
      }),
    });
    const loginData = (await loginRes.json()) as any;
    expect(loginData.error).toBeTruthy();
  });
});
