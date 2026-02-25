import { test, expect } from "@playwright/test";

const API_BASE = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";

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
// 1. Matching Algorithm Improvements
// ===========================================================================
test.describe("Matching Algorithm", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("p5match");
    token = user.token;
  });

  test("suggestedCandidates returns scored results", async () => {
    const res = await trpcQuery(token, "matching.suggestedCandidates");
    const candidates = res.result.data.json;

    expect(candidates).toBeInstanceOf(Array);
    // NPC friends should appear as candidates
    expect(candidates.length).toBeGreaterThan(0);

    for (const c of candidates) {
      expect(typeof c.score).toBe("number");
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(c.scoreSource).toBeTruthy();
      expect(c.friend).toBeTruthy();
      expect(c.twin).toBeTruthy();
    }
  });

  test("suggestedCandidates sorted by score descending", async () => {
    const res = await trpcQuery(token, "matching.suggestedCandidates");
    const candidates = res.result.data.json;

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].score).toBeGreaterThanOrEqual(candidates[i].score);
    }
  });

  test("discoverCandidates returns relevance-sorted results", async () => {
    const res = await trpcQuery(token, "matching.discoverCandidates");
    const candidates = res.result.data.json;

    expect(candidates).toBeInstanceOf(Array);
    // Each candidate should have the relevance field
    for (const c of candidates) {
      expect(typeof c.relevance).toBe("number");
      expect(c.commonTags).toBeInstanceOf(Array);
    }
  });

  test("discoverCandidates sorted by relevance descending", async () => {
    const res = await trpcQuery(token, "matching.discoverCandidates");
    const candidates = res.result.data.json;

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].relevance).toBeGreaterThanOrEqual(candidates[i].relevance);
    }
  });
});

// ===========================================================================
// 2. Chat Auto-Title & UX Improvements
// ===========================================================================
test.describe("Chat Auto-Title", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("p5chat");
    token = user.token;
  });

  test("session title auto-updates from first message", async () => {
    // Create session with default title
    const createRes = await trpcMutate(token, "chat.createSession", {
      title: "テストAIとのチャット",
    });
    const sessionId = createRes.result.data.json.id;

    // Send first message
    await trpcMutate(token, "chat.sendMessage", {
      sessionId,
      content: "今日のニュースについて教えてください",
    });

    // Check title was auto-updated
    const sessions = await trpcQuery(token, "chat.sessions");
    const session = sessions.result.data.json.find((s: any) => s.id === sessionId);
    expect(session.title).toBe("今日のニュースについて教えてください");
  });

  test("session list includes message count", async () => {
    const sessions = await trpcQuery(token, "chat.sessions");
    const sessionsList = sessions.result.data.json;

    expect(sessionsList.length).toBeGreaterThan(0);
    for (const s of sessionsList) {
      expect(typeof s.messageCount).toBe("number");
    }
  });

  test("session with messages has correct count", async () => {
    // Create session and send 2 messages
    const createRes = await trpcMutate(token, "chat.createSession", {
      title: "カウントテスト",
    });
    const sessionId = createRes.result.data.json.id;

    await trpcMutate(token, "chat.sendMessage", { sessionId, content: "メッセージ1" });
    await trpcMutate(token, "chat.sendMessage", { sessionId, content: "メッセージ2" });

    const sessions = await trpcQuery(token, "chat.sessions");
    const session = sessions.result.data.json.find((s: any) => s.id === sessionId);
    // 2 user + 2 assistant = 4 messages
    expect(session.messageCount).toBeGreaterThanOrEqual(4);
  });

  test("getSession returns message timestamps", async () => {
    const sessions = await trpcQuery(token, "chat.sessions");
    const firstSession = sessions.result.data.json[0];
    if (!firstSession) return;

    const sessionData = await trpcQuery(token, "chat.getSession", { id: firstSession.id });
    const messages = sessionData.result.data.json.messages;

    for (const msg of messages) {
      expect(msg.createdAt).toBeTruthy();
    }
  });
});

// ===========================================================================
// 3. Profile Public View & Preview
// ===========================================================================
test.describe("Profile Public View", () => {
  let token: string;
  let userId: number;

  test.beforeAll(async () => {
    const user = await registerUser("p5pubprof");
    token = user.token;
    userId = user.userId;

    // Fill profile
    await trpcMutate(token, "profile.update", {
      displayName: "公開テストユーザー",
      bio: "公開プロフィールのテスト",
      company: "テスト株式会社",
      industry: "IT",
      position: "CTO",
      skills: ["Go", "Rust"],
      expertise: ["バックエンド開発"],
      experience: "10年",
    });
  });

  test("getPublic returns public profile fields", async () => {
    const res = await trpcQuery(token, "profile.getPublic", { userId });
    const pub = res.result.data.json;

    expect(pub).toBeTruthy();
    expect(pub.displayName).toBe("公開テストユーザー");
    expect(pub.bio).toBe("公開プロフィールのテスト");
    expect(pub.company).toBe("テスト株式会社");
    expect(pub.industry).toBe("IT");
    expect(pub.skills).toContain("Go");
    expect(pub.skills).toContain("Rust");
    expect(pub.trustScore).toBeGreaterThanOrEqual(0);
  });

  test("getPublic includes twin info", async () => {
    const res = await trpcQuery(token, "profile.getPublic", { userId });
    const pub = res.result.data.json;

    // Registration creates a twin, so twin should exist
    expect(pub.twin).toBeTruthy();
    expect(pub.twin.name).toBeTruthy();
  });

  test("getPublic for non-existent user returns null", async () => {
    const res = await trpcQuery(token, "profile.getPublic", { userId: 999999 });
    expect(res.result.data.json).toBeNull();
  });
});

// ===========================================================================
// 4. Daily Login Trust Scoring & Streak
// ===========================================================================
test.describe("Daily Login & Streak", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("p5login");
    token = user.token;
  });

  test("auth.me returns loginStreak", async () => {
    const res = await trpcQuery(token, "auth.me");
    const me = res.result.data.json;

    expect(me).toBeTruthy();
    expect(typeof me.loginStreak).toBe("number");
    expect(me.loginStreak).toBeGreaterThanOrEqual(1); // Just registered = 1 day
  });

  test("daily login awards trust points", async () => {
    // First call should have awarded daily login
    const historyRes = await trpcQuery(token, "trust.getHistory", { limit: 10 });
    const history = historyRes.result.data.json;

    const dailyLogin = history.find((h: any) => h.action === "daily_login");
    expect(dailyLogin).toBeTruthy();
    expect(dailyLogin.points).toBe(2);
  });

  test("second auth.me call same day does not double-award", async () => {
    // Get score
    const before = await trpcQuery(token, "trust.getScore");
    const scoreBefore = before.result.data.json.score;

    // Call auth.me again
    await trpcQuery(token, "auth.me");

    // Score should not increase
    const after = await trpcQuery(token, "trust.getScore");
    expect(after.result.data.json.score).toBe(scoreBefore);
  });
});

// ===========================================================================
// 5. Profile Trust Scoring (expanded fields)
// ===========================================================================
test.describe("Expanded Profile Trust", () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await registerUser("p5exptrust");
    token = user.token;
  });

  test("skills and expertise fields award trust points", async () => {
    const beforeRes = await trpcQuery(token, "trust.getScore");
    const scoreBefore = beforeRes.result.data.json.score;

    await trpcMutate(token, "profile.update", {
      skills: ["Python", "Machine Learning"],
      expertise: ["AI研究"],
      experience: "8年間のAI開発経験",
    });

    const afterRes = await trpcQuery(token, "trust.getScore");
    const scoreAfter = afterRes.result.data.json.score;
    expect(scoreAfter).toBeGreaterThan(scoreBefore);

    // Check specific actions
    const historyRes = await trpcQuery(token, "trust.getHistory", { limit: 20 });
    const history = historyRes.result.data.json;
    const skillsAction = history.find((h: any) => h.action === "profile_field_skills");
    const expertiseAction = history.find((h: any) => h.action === "profile_field_expertise");
    const experienceAction = history.find((h: any) => h.action === "profile_field_experience");

    expect(skillsAction).toBeTruthy();
    expect(expertiseAction).toBeTruthy();
    expect(experienceAction).toBeTruthy();
  });
});
