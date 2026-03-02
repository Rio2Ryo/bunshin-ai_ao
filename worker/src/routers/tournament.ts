import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { ensureSchema, parseJson, toJson } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const tournamentRouter = router({
  list: protectedProcedure.input(z.object({ workspaceId: z.number() })).query(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    // Verify membership
    const member = await ctx.env.DB.prepare(`SELECT * FROM workspace_members WHERE workspaceId=? AND userId=?`).bind(input.workspaceId, ctx.userId).first<any>();
    if (!member) throw new TRPCError({ code: "FORBIDDEN" });
    const rows = await ctx.env.DB.prepare(
      `SELECT t.*, u.name as creatorName FROM tournaments t LEFT JOIN users u ON u.id=t.createdBy WHERE t.workspaceId=? ORDER BY t.createdAt DESC`
    ).bind(input.workspaceId).all<any>();
    return (rows.results ?? []).map((r: any) => ({ ...r, settings: parseJson<any>(r.settings), results: parseJson<any>(r.results) }));
  }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const t = await ctx.env.DB.prepare(`SELECT * FROM tournaments WHERE id=?`).bind(input.id).first<any>();
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    const member = await ctx.env.DB.prepare(`SELECT * FROM workspace_members WHERE workspaceId=? AND userId=?`).bind(t.workspaceId, ctx.userId).first<any>();
    if (!member) throw new TRPCError({ code: "FORBIDDEN" });
    const matches = await ctx.env.DB.prepare(
      `SELECT tm.*, u1.name as player1Name, u2.name as player2Name FROM tournament_matches tm LEFT JOIN users u1 ON u1.id=tm.player1UserId LEFT JOIN users u2 ON u2.id=tm.player2UserId WHERE tm.tournamentId=? ORDER BY tm.id`
    ).bind(input.id).all<any>();
    // Build standings
    const standings: Record<number, { userId: number; name: string; wins: number; losses: number; draws: number; totalScore: number; matchCount: number }> = {};
    for (const m of (matches.results ?? []) as any[]) {
      if (m.status !== "completed") continue;
      for (const pid of [m.player1UserId, m.player2UserId]) {
        if (!standings[pid]) standings[pid] = { userId: pid, name: pid === m.player1UserId ? m.player1Name : m.player2Name, wins: 0, losses: 0, draws: 0, totalScore: 0, matchCount: 0 };
      }
      const s1 = standings[m.player1UserId]; const s2 = standings[m.player2UserId];
      if (s1 && s2) {
        s1.matchCount++; s2.matchCount++;
        s1.totalScore += m.player1Score ?? 0; s2.totalScore += m.player2Score ?? 0;
        if (m.winnerId === m.player1UserId) { s1.wins++; s2.losses++; }
        else if (m.winnerId === m.player2UserId) { s2.wins++; s1.losses++; }
        else { s1.draws++; s2.draws++; }
      }
    }
    const standingsArr = Object.values(standings).sort((a, b) => b.wins * 3 + b.draws - (a.wins * 3 + a.draws) || b.totalScore - a.totalScore);
    return {
      ...t, settings: parseJson<any>(t.settings), results: parseJson<any>(t.results),
      matches: matches.results ?? [], standings: standingsArr,
      mvp: standingsArr[0] || null,
    };
  }),

  create: protectedProcedure.input(z.object({
    workspaceId: z.number(),
    name: z.string().min(1).max(100),
    theme: z.string().min(1),
    participantIds: z.array(z.number()).min(2).max(10),
  })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const member = await ctx.env.DB.prepare(`SELECT * FROM workspace_members WHERE workspaceId=? AND userId=?`).bind(input.workspaceId, ctx.userId).first<any>();
    if (!member) throw new TRPCError({ code: "FORBIDDEN" });

    const settings = { participantIds: input.participantIds, turnCount: 5 };
    const res = await ctx.env.DB.prepare(
      `INSERT INTO tournaments (workspaceId, name, theme, status, settings, createdBy) VALUES (?,?,?,'pending',?,?)`
    ).bind(input.workspaceId, input.name, input.theme, toJson(settings), ctx.userId).run();
    const tournamentId = Number(res.meta.last_row_id);

    // Generate round-robin matches
    const ids = input.participantIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await ctx.env.DB.prepare(
          `INSERT INTO tournament_matches (tournamentId, player1UserId, player2UserId, status) VALUES (?,?,?,'pending')`
        ).bind(tournamentId, ids[i], ids[j]).run();
      }
    }

    return { id: tournamentId, matchCount: (ids.length * (ids.length - 1)) / 2 };
  }),

  runMatch: protectedProcedure.input(z.object({ matchId: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const db = ctx.env.DB;
    const match = await db.prepare(`SELECT * FROM tournament_matches WHERE id=?`).bind(input.matchId).first<any>();
    if (!match) throw new TRPCError({ code: "NOT_FOUND" });
    if (match.status === "completed") return { alreadyCompleted: true };
    const tournament = await db.prepare(`SELECT * FROM tournaments WHERE id=?`).bind(match.tournamentId).first<any>();
    if (!tournament) throw new TRPCError({ code: "NOT_FOUND" });
    const member = await db.prepare(`SELECT * FROM workspace_members WHERE workspaceId=? AND userId=?`).bind(tournament.workspaceId, ctx.userId).first<any>();
    if (!member) throw new TRPCError({ code: "FORBIDDEN" });

    // Get twins
    const twin1 = await db.prepare(`SELECT * FROM digital_twins WHERE userId=?`).bind(match.player1UserId).first<any>();
    const twin2 = await db.prepare(`SELECT * FROM digital_twins WHERE userId=?`).bind(match.player2UserId).first<any>();
    if (!twin1 || !twin2) throw new TRPCError({ code: "NOT_FOUND", message: "参加者のツインが見つかりません" });

    // Create matching session
    const sessionRes = await db.prepare(
      `INSERT INTO matching_sessions (initiatorUserId, twin1Id, twin2Id, theme, status, settings) VALUES (?,?,?,?,'pending',?)`
    ).bind(ctx.userId, twin1.id, twin2.id, tournament.theme, toJson({ tournament: true, tournamentId: tournament.id, matchId: input.matchId })).run();
    const sessionId = Number(sessionRes.meta.last_row_id);

    // Run dialogue
    const llmConfig = await getUserLLMConfig(db, ctx.userId, "matching", ctx.env);
    const settings = parseJson<any>(tournament.settings) || {};
    const turnCount = settings.turnCount || 5;
    const twins = [
      { id: twin1.id, name: twin1.name || "Player 1", personality: twin1.personality || "" },
      { id: twin2.id, name: twin2.name || "Player 2", personality: twin2.personality || "" },
    ];
    const dialogueHistory: { speaker: string; content: string }[] = [];

    for (let turn = 0; turn < turnCount; turn++) {
      const speakerIdx = turn % 2;
      const speaker = twins[speakerIdx];
      const other = twins[1 - speakerIdx];

      const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: `あなたは「${speaker.name}」です。性格: ${speaker.personality || "プロフェッショナル"}。テーマ「${tournament.theme}」について「${other.name}」とビジネス対話をしてください。150〜300文字で発言してください。` },
      ];
      for (const d of dialogueHistory) {
        msgs.push({ role: d.speaker === speaker.name ? "assistant" : "user", content: `${d.speaker}: ${d.content}` });
      }
      if (turn === 0) msgs.push({ role: "user", content: `テーマ「${tournament.theme}」について話し始めてください。` });

      let content = `${speaker.name}として${tournament.theme}について議論します。`;
      if (llmConfig) {
        try {
          const result = await invokeLLM(llmConfig, msgs, { maxTokens: 512, temperature: 0.8 });
          if (result.content) content = result.content.replace(new RegExp(`^${speaker.name}:\\s*`, "i"), "").trim();
        } catch { /* fallback */ }
      }

      dialogueHistory.push({ speaker: speaker.name, content });
      await db.prepare(
        `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES (?,?,?,?,?,?)`
      ).bind(sessionId, speaker.id, content, turn, "tournament", "auto").run();
    }

    // Run analysis
    let score1 = 50; let score2 = 50;
    if (llmConfig) {
      try {
        const transcript = dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n");
        const analysisResult = await invokeLLM(llmConfig, [
          { role: "system", content: "あなたはビジネスマッチングの審判員です。JSON形式で各プレイヤーのスコアを返してください。" },
          { role: "user", content: `テーマ: ${tournament.theme}\n\n${transcript}\n\nJSON: {"player1Score": 0-100, "player2Score": 0-100, "summary": "", "mvpReason": ""}` },
        ], { maxTokens: 1024, temperature: 0.5 });
        const m = analysisResult.content.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          score1 = Math.max(0, Math.min(100, parsed.player1Score ?? 50));
          score2 = Math.max(0, Math.min(100, parsed.player2Score ?? 50));
          // Save analysis as matching result
          await db.prepare(
            `INSERT INTO matching_results (sessionId, compatibilityScore, summary) VALUES (?,?,?)`
          ).bind(sessionId, Math.round((score1 + score2) / 2), parsed.summary || "").run();
        }
      } catch { /* fallback */ }
    }

    const winnerId = score1 > score2 ? match.player1UserId : score2 > score1 ? match.player2UserId : null;
    await db.prepare(
      `UPDATE tournament_matches SET sessionId=?, player1Score=?, player2Score=?, winnerId=?, status='completed' WHERE id=?`
    ).bind(sessionId, score1, score2, winnerId, input.matchId).run();
    await db.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();

    // Check if all matches completed
    const remaining = await db.prepare(`SELECT COUNT(*) as cnt FROM tournament_matches WHERE tournamentId=? AND status!='completed'`).bind(match.tournamentId).first<any>();
    if (remaining?.cnt === 0) {
      // Compute final results
      const allMatches = await db.prepare(`SELECT * FROM tournament_matches WHERE tournamentId=?`).bind(match.tournamentId).all<any>();
      const scores: Record<number, { wins: number; totalScore: number }> = {};
      for (const am of (allMatches.results ?? []) as any[]) {
        if (!scores[am.player1UserId]) scores[am.player1UserId] = { wins: 0, totalScore: 0 };
        if (!scores[am.player2UserId]) scores[am.player2UserId] = { wins: 0, totalScore: 0 };
        scores[am.player1UserId].totalScore += am.player1Score ?? 0;
        scores[am.player2UserId].totalScore += am.player2Score ?? 0;
        if (am.winnerId === am.player1UserId) scores[am.player1UserId].wins++;
        if (am.winnerId === am.player2UserId) scores[am.player2UserId].wins++;
      }
      const ranked = Object.entries(scores).sort(([,a], [,b]) => b.wins - a.wins || b.totalScore - a.totalScore);
      const mvpId = ranked[0] ? parseInt(ranked[0][0]) : null;
      const mvpUser = mvpId ? await db.prepare(`SELECT name FROM users WHERE id=?`).bind(mvpId).first<any>() : null;
      await db.prepare(`UPDATE tournaments SET status='completed', completedAt=datetime('now'), results=? WHERE id=?`)
        .bind(toJson({ rankings: ranked.map(([id, s]) => ({ userId: parseInt(id), ...s })), mvpId, mvpName: mvpUser?.name }), match.tournamentId).run();
    }

    return { sessionId, player1Score: score1, player2Score: score2, winnerId };
  }),

  runAll: protectedProcedure.input(z.object({ tournamentId: z.number() })).mutation(async ({ ctx, input }) => {
    await ensureSchema(ctx.env.DB);
    const tournament = await ctx.env.DB.prepare(`SELECT * FROM tournaments WHERE id=?`).bind(input.tournamentId).first<any>();
    if (!tournament) throw new TRPCError({ code: "NOT_FOUND" });
    const member = await ctx.env.DB.prepare(`SELECT * FROM workspace_members WHERE workspaceId=? AND userId=?`).bind(tournament.workspaceId, ctx.userId).first<any>();
    if (!member) throw new TRPCError({ code: "FORBIDDEN" });
    await ctx.env.DB.prepare(`UPDATE tournaments SET status='running' WHERE id=?`).bind(input.tournamentId).run();

    const pendingMatches = await ctx.env.DB.prepare(`SELECT id FROM tournament_matches WHERE tournamentId=? AND status='pending' ORDER BY id`).bind(input.tournamentId).all<any>();
    const results = [];
    for (const m of (pendingMatches.results ?? []) as any[]) {
      // We can't call our own tRPC procedure directly, so replicate the logic inline —
      // but to keep this simple, we'll just return the match IDs for the client to call runMatch sequentially
      results.push({ matchId: m.id });
    }
    return { pendingMatches: results, totalCount: results.length };
  }),
});
