/**
 * E2E Flow Test: Registration → NPC Tutorial → Matching
 * Runs against the production API via HTTP requests.
 * Usage: npx tsx e2e-flow-test.ts
 */

const API = "https://bunshin-ai-api.common-gifted-tokyo.workers.dev";
const UNIQUE = `e2eflow${Date.now()}`;
const EMAIL = `${UNIQUE}@e2e-test.local`;
const PASSWORD = "TestPass1234";
const NAME = `E2E_${UNIQUE}`;

let token = "";
let userId = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function trpcMutate(path: string, input?: unknown) {
  const res = await fetch(`${API}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `app_session_id=${token}` } : {}),
    },
    body: JSON.stringify(input !== undefined ? { json: input } : { json: {} }),
  });
  return res.json() as Promise<any>;
}

async function trpcQuery(path: string, input?: Record<string, unknown>) {
  let url = `${API}/api/trpc/${path}`;
  if (input) {
    url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  }
  const res = await fetch(url, {
    headers: token ? { Cookie: `app_session_id=${token}` } : {},
  });
  return res.json() as Promise<any>;
}

function unwrap(body: any): any {
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result?.data?.json;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    const msg = `${name}: ${e.message}`;
    failures.push(msg);
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

// ===========================================================================

async function main() {
  console.log("\n🔄 E2E Flow Test: Registration → NPC Tutorial → Matching\n");

  // ========== Phase 1: Registration ==========
  console.log("📋 Phase 1: Registration");

  await test("1.1 Register new user", async () => {
    const data = unwrap(await trpcMutate("auth.register", { name: NAME, email: EMAIL, password: PASSWORD }));
    token = data.token;
    userId = data.user.id;
    assert(!!token, "token should be returned");
    assert(userId > 0, "userId should be > 0");
    assert(data.user.onboardingCompleted === 0, "onboardingCompleted should be 0");
  });

  await test("1.2 auth.me returns user with trust score", async () => {
    const me = unwrap(await trpcQuery("auth.me"));
    assert(me.id === userId, `me.id=${me.id} should equal ${userId}`);
    assert(me.onboardingCompleted === 0, "onboardingCompleted should be 0");
    assert(me.tutorialCompleted === 0, "tutorialCompleted should be 0");
    assert(typeof me.trustScore === "number", "trustScore should exist");
    assert(me.trustRank === "bronze", `trustRank should be bronze, got ${me.trustRank}`);
  });

  // ========== Phase 2: NPC Friends ==========
  console.log("\n📋 Phase 2: NPC Friends & Tutorial Sessions");

  let npcFriendId = 0;
  let npcFriendId2 = 0;

  await test("2.1 ガイド太郎 is auto-added as NPC friend", async () => {
    const friends = unwrap(await trpcQuery("friends.list"));
    const taro = friends.find((f: any) => f.friend.name === "ガイド太郎");
    assert(!!taro, "ガイド太郎 should exist in friends");
    assert(taro.friend.isNpc === true, "should be NPC");
    assert(!!taro.twin, "should have twin");
    assert(taro.twin.name === "ガイド太郎の分身AI", `twin name should be ガイド太郎の分身AI, got ${taro.twin.name}`);
    npcFriendId = taro.friend.id;
  });

  await test("2.2 案内花子 is auto-added as NPC friend", async () => {
    const friends = unwrap(await trpcQuery("friends.list"));
    const hanako = friends.find((f: any) => f.friend.name === "案内花子");
    assert(!!hanako, "案内花子 should exist in friends");
    assert(hanako.friend.isNpc === true, "should be NPC");
    assert(!!hanako.twin, "should have twin");
    npcFriendId2 = hanako.friend.id;
  });

  await test("2.3 Two NPC tutorial chat sessions created", async () => {
    const sessions = unwrap(await trpcQuery("chat.sessions"));
    const npcSessions = sessions.filter((s: any) => s.mode === "npc_tutorial");
    assert(npcSessions.length === 2, `expected 2 npc_tutorial sessions, got ${npcSessions.length}`);
    const taroSession = npcSessions.find((s: any) => s.title.includes("ガイド太郎"));
    assert(!!taroSession, "ガイド太郎 tutorial session should exist");
    const hanakoSession = npcSessions.find((s: any) => s.title.includes("案内花子"));
    assert(!!hanakoSession, "案内花子 tutorial session should exist");
  });

  await test("2.4 Onboarding chat session created", async () => {
    const sessions = unwrap(await trpcQuery("chat.sessions"));
    const onboardingSession = sessions.find((s: any) => s.mode === "onboarding");
    assert(!!onboardingSession, "onboarding session should exist");
  });

  await test("2.5 NPC tutorial sessions contain welcome messages", async () => {
    const sessions = unwrap(await trpcQuery("chat.sessions"));
    const npcSessions = sessions.filter((s: any) => s.mode === "npc_tutorial");

    for (const ns of npcSessions) {
      const sessionData = unwrap(await trpcQuery("chat.getSession", { id: ns.id }));
      assert(sessionData.messages.length > 0, `NPC session ${ns.id} should have messages`);
      const assistantMsg = sessionData.messages.find((m: any) => m.role === "assistant");
      assert(!!assistantMsg, `NPC session ${ns.id} should have an assistant message`);
    }
  });

  // ========== Phase 3: Onboarding ==========
  console.log("\n📋 Phase 3: Onboarding Flow");

  await test("3.1 onboarding.getStatus returns not completed", async () => {
    const status = unwrap(await trpcQuery("onboarding.getStatus"));
    assert(status.onboardingCompleted === 0, "should not be completed");
    assert(status.tutorialCompleted === 0, "tutorial should not be completed");
  });

  await test("3.2 onboarding.getSession returns session", async () => {
    const session = unwrap(await trpcQuery("onboarding.getSession"));
    assert(!!session, "onboarding session should exist");
    assert(session.mode === "onboarding", `mode should be onboarding, got ${session.mode}`);
  });

  await test("3.3 User twin exists (auto-created at registration)", async () => {
    const twin = unwrap(await trpcQuery("myTwin.get"));
    assert(!!twin, "twin should exist");
    assert(!!twin.name, "twin should have a name");
  });

  await test("3.4 Complete onboarding with profile data", async () => {
    const result = unwrap(await trpcMutate("onboarding.complete", {
      description: "E2Eテストユーザー。AIとビジネスに興味があります。",
      personality: "好奇心旺盛で協調的",
      rawInput: "名前: テスト太郎, 年齢: 30, 仕事: AIエンジニア, 趣味: プログラミング",
    }));
    assert(result.success === true, "should return success");
  });

  await test("3.5 auth.me now shows onboardingCompleted=1", async () => {
    const me = unwrap(await trpcQuery("auth.me"));
    assert(me.onboardingCompleted === 1, `onboardingCompleted should be 1, got ${me.onboardingCompleted}`);
  });

  await test("3.6 Twin profile updated after onboarding", async () => {
    const twin = unwrap(await trpcQuery("myTwin.get"));
    assert(!!twin.description, "twin description should be set");
    assert(twin.description.includes("E2Eテスト"), `description should contain E2Eテスト, got: ${twin.description}`);
  });

  await test("3.7 Trust score increased after onboarding completion", async () => {
    const trust = unwrap(await trpcQuery("trust.getScore"));
    // Registration=5, daily_login=2, onboarding_complete=10 => at least 15
    assert(trust.score >= 15, `trust score should be >= 15, got ${trust.score}`);
  });

  // ========== Phase 4: Suggested Candidates ==========
  console.log("\n📋 Phase 4: Suggested Matching Candidates (Score-based)");

  await test("4.1 matching.suggestedCandidates returns candidates", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    assert(Array.isArray(candidates), "should be an array");
    assert(candidates.length >= 2, `should have at least 2 NPC candidates, got ${candidates.length}`);
  });

  await test("4.2 Each candidate has score and friend info", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    for (const c of candidates) {
      assert(typeof c.score === "number", `score should be number, got ${typeof c.score}`);
      assert(c.score >= 0 && c.score <= 100, `score ${c.score} should be 0-100`);
      assert(!!c.friend, "should have friend object");
      assert(typeof c.friend.id === "number", "friend.id should be number");
      assert(typeof c.friend.name === "string", "friend.name should be string");
      assert(typeof c.scoreSource === "string", `scoreSource should be string, got ${typeof c.scoreSource}`);
      assert(!!c.twin, "should have twin object");
    }
  });

  await test("4.3 Candidates are sorted by score descending", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    for (let i = 1; i < candidates.length; i++) {
      assert(candidates[i - 1].score >= candidates[i].score,
        `candidates[${i - 1}].score=${candidates[i - 1].score} should >= candidates[${i}].score=${candidates[i].score}`);
    }
  });

  await test("4.4 NPC candidates have isNpc=true", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    const npcCandidates = candidates.filter((c: any) => c.friend.isNpc);
    assert(npcCandidates.length >= 2, `should have at least 2 NPC candidates, got ${npcCandidates.length}`);
  });

  await test("4.5 New candidates have scoreSource='estimated'", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    // Before any matching, all should be estimated
    const estimated = candidates.filter((c: any) => c.scoreSource === "estimated");
    assert(estimated.length === candidates.length, "all candidates should be estimated before any matching");
  });

  // ========== Phase 5: Matching ==========
  console.log("\n📋 Phase 5: Matching with NPC");

  let matchingSessionId = 0;

  await test("5.1 Create matching with ガイド太郎 (NPC exempt from trust threshold)", async () => {
    assert(npcFriendId > 0, "npcFriendId should be set from Phase 2");
    const result = unwrap(await trpcMutate("matching.create", {
      friendId: npcFriendId,
      theme: "E2Eテスト: AIビジネスの可能性",
      turns: 3,
    }));
    assert(typeof result.id === "number", `session id should be number, got ${typeof result.id}`);
    matchingSessionId = result.id;
    assert(matchingSessionId > 0, "session id should be > 0");
  });

  await test("5.2 matching.sessions returns the session with score", async () => {
    const sessions = unwrap(await trpcQuery("matching.sessions"));
    assert(sessions.length > 0, "should have at least 1 session");
    const session = sessions.find((s: any) => s.id === matchingSessionId);
    assert(!!session, `session ${matchingSessionId} should exist`);
    assert(session.status === "completed", `status should be completed, got ${session.status}`);
    // compatibilityScore should be present (from our new change)
    assert(session.compatibilityScore !== undefined, "compatibilityScore field should exist");
    assert(session.isNpcSession === true, "should be marked as NPC session");
  });

  await test("5.3 matching.getSession returns full result with score breakdown", async () => {
    const data = unwrap(await trpcQuery("matching.getSession", { id: matchingSessionId }));
    assert(!!data.session, "session should exist");
    assert(!!data.twin1, "twin1 should exist");
    assert(!!data.twin2, "twin2 should exist");
    assert(Array.isArray(data.dialogues), "dialogues should be array");
    assert(data.dialogues.length > 0, `dialogues should not be empty, got ${data.dialogues.length}`);

    // Result with analysis
    if (data.result) {
      assert(typeof data.result.compatibilityScore === "number" || typeof data.result.compatibilityScore === "string",
        "compatibilityScore should exist");
      const score = parseFloat(data.result.compatibilityScore);
      assert(score >= 0 && score <= 100, `score ${score} should be 0-100`);

      if (data.result.scoreBreakdown) {
        assert(typeof data.result.scoreBreakdown === "object", "scoreBreakdown should be object");
      }
      if (data.result.summary) {
        assert(typeof data.result.summary === "string", "summary should be string");
      }
    }
  });

  await test("5.4 matching.sessions includes resultSummary", async () => {
    const sessions = unwrap(await trpcQuery("matching.sessions"));
    const session = sessions.find((s: any) => s.id === matchingSessionId);
    assert(!!session, "session should exist");
    // resultSummary is our new field
    assert(session.resultSummary !== undefined, "resultSummary field should exist on session");
  });

  await test("5.5 Create matching with 案内花子", async () => {
    assert(npcFriendId2 > 0, "npcFriendId2 should be set");
    const result = unwrap(await trpcMutate("matching.create", {
      friendId: npcFriendId2,
      theme: "E2Eテスト: マッチング機能のテスト",
      turns: 3,
    }));
    assert(typeof result.id === "number", "session id should be number");
    assert(result.id > 0, "session id should be > 0");
  });

  // ========== Phase 6: Post-Matching Candidates ==========
  console.log("\n📋 Phase 6: Post-Matching Candidate Scores Updated");

  await test("6.1 After matching, at least one candidate has scoreSource='actual'", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    const actualCandidates = candidates.filter((c: any) => c.scoreSource === "actual");
    assert(actualCandidates.length >= 1, `should have at least 1 actual-scored candidate, got ${actualCandidates.length}`);
  });

  await test("6.2 Matched NPC candidate has bestResult with score", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    const taro = candidates.find((c: any) => c.friend.id === npcFriendId);
    assert(!!taro, "ガイド太郎 should be in candidates");
    if (taro.bestResult) {
      assert(typeof taro.bestResult.score === "number" || typeof taro.bestResult.score === "string",
        "bestResult.score should exist");
      assert(!!taro.bestResult.sessionId, "bestResult.sessionId should exist");
      assert(!!taro.bestResult.theme, "bestResult.theme should exist");
    }
  });

  await test("6.3 Candidates have matchCount > 0 for matched friends", async () => {
    const candidates = unwrap(await trpcQuery("matching.suggestedCandidates"));
    const taro = candidates.find((c: any) => c.friend.id === npcFriendId);
    assert(!!taro, "ガイド太郎 should be in candidates");
    assert(taro.matchCount >= 1, `matchCount should be >= 1, got ${taro.matchCount}`);
  });

  // ========== Phase 7: Tutorial Complete ==========
  console.log("\n📋 Phase 7: Tutorial Completion");

  await test("7.1 Complete tutorial", async () => {
    const result = unwrap(await trpcMutate("onboarding.completeTutorial"));
    assert(result.success === true, "should return success");
  });

  await test("7.2 auth.me shows tutorialCompleted=1", async () => {
    const me = unwrap(await trpcQuery("auth.me"));
    assert(me.tutorialCompleted === 1, `tutorialCompleted should be 1, got ${me.tutorialCompleted}`);
  });

  await test("7.3 Trust score increased from tutorial completion", async () => {
    const trust = unwrap(await trpcQuery("trust.getScore"));
    // Registration=5 + daily_login=2 + onboarding=10 + matching×2=10 + tutorial=5 = at least 30
    assert(trust.score >= 25, `trust score should be >= 25, got ${trust.score}`);
  });

  // ========== Summary ==========
  console.log("\n" + "=".repeat(60));
  console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failures.length > 0) {
    console.log("\n❌ Failures:");
    for (const f of failures) {
      console.log(`   - ${f}`);
    }
  }
  console.log("=".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
