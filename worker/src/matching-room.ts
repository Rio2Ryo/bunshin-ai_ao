/**
 * MatchingRoom Durable Object — manages WebSocket connections for a matching session.
 * Uses the Hibernation API for multi-user real-time matching with reactions.
 *
 * Protocol (client -> server):
 *   { type: "start" } — triggers dialogue generation (only initiator)
 *   { type: "comment", turnNumber?: number, content: string }
 *   { type: "reaction", turnNumber: number, reactionType: "like" }
 *
 * Protocol (server -> client):
 *   { type: "turn", turnNumber, speakerTwinId, speakerName, content }
 *   { type: "analysis_start" }
 *   { type: "analysis_complete", ...analysisData }
 *   { type: "complete", sessionId }
 *   { type: "comment", userId, userName, turnNumber, content, commentId }
 *   { type: "reaction", userId, turnNumber, reactionType, reactionId }
 *   { type: "error", message }
 *   { type: "viewers", count }
 */

import type { Env } from "./trpc";
import { ensureSchema, parseJson, toJson, normalizeTwin, addTrustAction } from "./db-helpers";
import { invokeLLM, getUserLLMConfig } from "./llm";
import { notifyMatchingComplete } from "./notifications";

export class MatchingRoom implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;
  private dialogueStarted = false;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const userId = parseInt(url.searchParams.get("userId") || "0");
    const sessionId = parseInt(url.searchParams.get("sessionId") || "0");
    const isInitiator = url.searchParams.get("isInitiator") === "true";
    const userName = url.searchParams.get("userName") || "User";

    if (!userId || !sessionId) {
      return new Response("Missing userId or sessionId", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, sessionId, isInitiator, userName });

    // Broadcast updated viewer count
    const viewerCount = this.ctx.getWebSockets().length;
    this.broadcast({ type: "viewers", count: viewerCount });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let data: any;
    try {
      data = JSON.parse(message);
    } catch {
      this.sendJson(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    const meta = ws.deserializeAttachment() as { userId: number; sessionId: number; isInitiator: boolean; userName: string } | null;
    if (!meta) {
      this.sendJson(ws, { type: "error", message: "No session metadata" });
      return;
    }

    if (data.type === "ping") {
      this.sendJson(ws, { type: "pong" });
      return;
    }

    switch (data.type) {
      case "start":
        if (!meta.isInitiator) {
          this.sendJson(ws, { type: "error", message: "Only the initiator can start the dialogue" });
          return;
        }
        if (this.dialogueStarted) {
          this.sendJson(ws, { type: "error", message: "Dialogue already started" });
          return;
        }
        this.dialogueStarted = true;
        await this.startDialogue(meta.sessionId, meta.userId);
        break;

      case "comment":
        await this.handleComment(meta, data);
        break;

      case "reaction":
        await this.handleReaction(meta, data);
        break;

      default:
        this.sendJson(ws, { type: "error", message: `Unknown message type: ${data.type}` });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
    const viewerCount = this.ctx.getWebSockets().length;
    this.broadcast({ type: "viewers", count: viewerCount });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close();
  }

  // ---- Internal Methods ----

  private sendJson(ws: WebSocket, obj: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // Client disconnected
    }
  }

  private broadcast(obj: Record<string, unknown>): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendJson(ws, obj);
    }
  }

  private async handleComment(
    meta: { userId: number; sessionId: number; userName: string },
    data: { turnNumber?: number; content?: string }
  ): Promise<void> {
    if (!data.content || typeof data.content !== "string" || data.content.trim().length === 0) return;
    const content = data.content.trim().slice(0, 500);
    const db = this.env.DB;

    try {
      await ensureSchema(db);
      const res = await db.prepare(
        `INSERT INTO matching_comments (sessionId, userId, turnNumber, content) VALUES (?,?,?,?)`
      ).bind(meta.sessionId, meta.userId, data.turnNumber ?? null, content).run();

      this.broadcast({
        type: "comment",
        userId: meta.userId,
        userName: meta.userName,
        turnNumber: data.turnNumber ?? null,
        content,
        commentId: Number(res.meta.last_row_id),
      });
    } catch (err: any) {
      // Silently fail for comments
    }
  }

  private async handleReaction(
    meta: { userId: number; sessionId: number; userName: string },
    data: { turnNumber?: number; reactionType?: string }
  ): Promise<void> {
    if (typeof data.turnNumber !== "number") return;
    const reactionType = data.reactionType || "like";
    const db = this.env.DB;

    try {
      await ensureSchema(db);
      const res = await db.prepare(
        `INSERT OR IGNORE INTO matching_reactions (sessionId, userId, turnNumber, type) VALUES (?,?,?,?)`
      ).bind(meta.sessionId, meta.userId, data.turnNumber, reactionType).run();

      if (res.meta.changes > 0) {
        this.broadcast({
          type: "reaction",
          userId: meta.userId,
          turnNumber: data.turnNumber,
          reactionType,
          reactionId: Number(res.meta.last_row_id),
        });
      }
    } catch {
      // Silently fail for reactions
    }
  }

  private async startDialogue(sessionId: number, initiatorUserId: number): Promise<void> {
    const db = this.env.DB;
    const env = this.env;

    try {
      await ensureSchema(db);

      const session = await db.prepare(`SELECT * FROM matching_sessions WHERE id=?`).bind(sessionId).first<any>();
      if (!session || session.status !== "running") {
        this.broadcast({ type: "error", message: "Session not available" });
        return;
      }

      const settings = parseJson<any>(session.settings) || {};
      const turnsToRun = Math.min(settings.turns || 5, 20);
      const friendId = settings.friendId;

      const llmConfig = await getUserLLMConfig(db, initiatorUserId, "matching", env);
      if (!llmConfig) {
        await db.prepare(`INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber) VALUES (?,?,?,?)`)
          .bind(sessionId, session.twin1Id, "AI APIキーが未設定のため、対話を生成できません。", 0).run();
        await db.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
        this.broadcast({ type: "error", message: "AI APIキーが設定されていません" });
        return;
      }

      const twin1 = await db.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin1Id).first<any>();
      const twin2 = await db.prepare(`SELECT * FROM digital_twins WHERE id=?`).bind(session.twin2Id).first<any>();
      const twin1Norm = normalizeTwin(twin1);
      const twin2Norm = normalizeTwin(twin2);
      const twin1UserId = twin1?.userId;
      const twin2UserId = twin2?.userId;

      // Fetch profiles
      const myProfile = twin1UserId ? await db.prepare(`SELECT company, industry, position, skills, expertise, bio FROM user_profiles WHERE userId=?`).bind(twin1UserId).first<any>() : null;
      const friendProfile = twin2UserId ? await db.prepare(`SELECT company, industry, position, skills, expertise, bio FROM user_profiles WHERE userId=?`).bind(twin2UserId).first<any>() : null;

      // Fetch knowledge base
      const myKnowledge = (await db.prepare(`SELECT title, summary, content FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 5`).bind(session.twin1Id).all<any>()).results ?? [];
      const friendKnowledge = (await db.prepare(`SELECT title, summary, content FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 5`).bind(session.twin2Id).all<any>()).results ?? [];

      const twins = [
        { id: session.twin1Id, name: twin1Norm?.name || "Twin 1", desc: twin1?.description || "", personality: twin1?.personality || "", profile: myProfile, knowledge: myKnowledge },
        { id: session.twin2Id, name: twin2Norm?.name || "Twin 2", desc: twin2?.description || "", personality: twin2?.personality || "", profile: friendProfile, knowledge: friendKnowledge },
      ];

      const dialogueHistory: { speaker: string; content: string }[] = [];

      // Generate dialogue turns
      for (let turn = 0; turn < turnsToRun; turn++) {
        const speakerIdx = turn % 2;
        const speaker = twins[speakerIdx];
        const other = twins[1 - speakerIdx];

        let profileContext = "";
        if (speaker.profile) {
          const p = speaker.profile;
          if (p.company) profileContext += `所属: ${p.company}。`;
          if (p.industry) profileContext += `業界: ${p.industry}。`;
          if (p.position) profileContext += `役職: ${p.position}。`;
          if (p.skills || p.expertise) profileContext += `得意分野: ${p.skills || p.expertise}。`;
        }

        let knowledgeContext = "";
        if (speaker.knowledge && speaker.knowledge.length > 0) {
          knowledgeContext = "\n知識ベース: " + speaker.knowledge.map((k: any) => {
            const label = k.title || "";
            const body = k.summary || (k.content ? k.content.slice(0, 300) : "");
            return label ? `${label}: ${body}` : body;
          }).filter(Boolean).join("; ");
        }

        const systemPrompt = `あなたは「${speaker.name}」というデジタル分身AIです。${speaker.desc ? `説明: ${speaker.desc}。` : ""}${speaker.personality ? `性格: ${speaker.personality}。` : ""}${profileContext}${knowledgeContext}
テーマ「${session.theme}」について「${other.name}」と建設的なビジネス対話をしています。
相手の意見を尊重しつつ、自分の専門性や経験・知識ベースに基づいた具体的な提案や考えを述べてください。
簡潔で具体的な発言（150〜300文字程度）をしてください。`;

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
        ];
        for (const d of dialogueHistory) {
          messages.push({ role: d.speaker === speaker.name ? "assistant" : "user", content: `${d.speaker}: ${d.content}` });
        }
        if (turn === 0) {
          messages.push({ role: "user", content: `テーマ「${session.theme}」について話し始めてください。` });
        }

        let content = "";
        let provider = "";
        let model = "";
        try {
          const result = await invokeLLM(llmConfig, messages, { maxTokens: 512, temperature: 0.8 });
          content = result.content.replace(new RegExp(`^${speaker.name}:\\s*`, "i"), "").trim();
          provider = result.provider;
          model = result.model;
        } catch { /* LLM failed */ }

        if (!content || content.length < 10) {
          content = turn === 0
            ? `「${session.theme}」について、ぜひお話しさせてください。この分野での協業には大きな可能性を感じています。`
            : `とても興味深い視点ですね。お互いの強みを活かした協業ができると思います。`;
          provider = "scripted-fallback";
          model = "matching-dialogue-v1";
        }

        dialogueHistory.push({ speaker: speaker.name, content });

        await db.prepare(
          `INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES (?,?,?,?,?,?)`
        ).bind(sessionId, speaker.id, content, turn, provider, model).run();

        this.broadcast({
          type: "turn",
          turnNumber: turn,
          speakerTwinId: speaker.id,
          speakerName: speaker.name,
          content,
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // Analysis phase
      this.broadcast({ type: "analysis_start" });

      const profileSummaries = twins.map(t => {
        const parts = [t.name];
        if (t.profile?.company) parts.push(`所属: ${t.profile.company}`);
        if (t.profile?.industry) parts.push(`業界: ${t.profile.industry}`);
        if (t.profile?.position) parts.push(`役職: ${t.profile.position}`);
        if (t.desc) parts.push(`説明: ${t.desc}`);
        return parts.join("、");
      });

      const analysisPrompt = `以下は「${twins[0].name}」と「${twins[1].name}」のビジネスマッチング対話です。テーマ: ${session.theme}

参加者情報:
- ${profileSummaries[0]}
- ${profileSummaries[1]}

${dialogueHistory.map(d => `${d.speaker}: ${d.content}`).join("\n\n")}

以下のJSON形式で分析結果を返してください（日本語で）:
{
  "compatibilityScore": (0-100の数値),
  "summary": "(総合評価の要約)",
  "collaborationPotential": "(協業可能性の詳細な説明)",
  "strengths": ["強み1", "強み2", "強み3"],
  "challenges": ["課題1", "課題2"],
  "recommendations": ["提案1", "提案2", "提案3"],
  "scoreBreakdown": {
    "skillMatch": {"score": (0-20), "reason": "理由"},
    "valueAlignment": {"score": (0-20), "reason": "理由"},
    "communicationStyle": {"score": (0-20), "reason": "理由"},
    "businessGoalFit": {"score": (0-20), "reason": "理由"},
    "complementaryStrengths": {"score": (0-20), "reason": "理由"}
  }
}

JSONのみ出力し、他の説明は不要です。`;

      let analysis: any = null;
      try {
        const analysisResult = await invokeLLM(llmConfig, [
          { role: "system", content: "あなたはビジネスマッチングの専門アナリストです。" },
          { role: "user", content: analysisPrompt },
        ], { maxTokens: 4096, temperature: 0.5 });

        const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
      } catch { /* analysis failed */ }

      const friendUser = friendId ? await db.prepare(`SELECT isNpc FROM users WHERE id=?`).bind(friendId).first<any>() : null;
      const isNpcMatch = friendUser?.isNpc === 1;

      if (analysis?.scoreBreakdown) {
        const dims = ["skillMatch", "valueAlignment", "communicationStyle", "businessGoalFit", "complementaryStrengths"];
        let computedTotal = 0;
        for (const dim of dims) {
          const sub = analysis.scoreBreakdown[dim];
          if (sub && typeof sub.score === "number") {
            sub.score = Math.max(0, Math.min(20, Math.round(sub.score)));
            computedTotal += sub.score;
          }
        }
        if (computedTotal > 0) analysis.compatibilityScore = computedTotal;
      }

      if (analysis) {
        await db.prepare(
          `INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary) VALUES (?,?,?,?,?,?,?,?)`
        ).bind(
          sessionId, analysis.compatibilityScore ?? 50,
          toJson(analysis.scoreBreakdown), analysis.collaborationPotential ?? "",
          toJson(analysis.strengths), toJson(analysis.challenges),
          toJson(analysis.recommendations), analysis.summary ?? "",
        ).run();
      } else {
        const defScore = isNpcMatch ? 75 : 65;
        analysis = {
          compatibilityScore: defScore,
          summary: "対話を通じて、双方に協業の可能性が見つかりました。",
          strengths: ["共通の関心テーマがある", "コミュニケーションスタイルが建設的"],
          challenges: ["具体的な協業プランの策定が必要"],
          recommendations: ["月次の定期ミーティングを設定する", "小規模なPoCプロジェクトから開始する"],
          scoreBreakdown: { skillMatch: { score: 13, reason: "関連するスキルセット" }, valueAlignment: { score: 13, reason: "価値観の一致" }, communicationStyle: { score: 13, reason: "建設的な対話" }, businessGoalFit: { score: 13, reason: "ビジネス目標の親和性" }, complementaryStrengths: { score: 13, reason: "相互補完的な強み" } },
        };
        await db.prepare(
          `INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary) VALUES (?,?,?,?,?,?,?,?)`
        ).bind(sessionId, defScore, toJson(analysis.scoreBreakdown), analysis.collaborationPotential || "", toJson(analysis.strengths), toJson(analysis.challenges), toJson(analysis.recommendations), analysis.summary).run();
      }

      this.broadcast({
        type: "analysis_complete",
        compatibilityScore: analysis.compatibilityScore,
        summary: analysis.summary,
        strengths: analysis.strengths,
        challenges: analysis.challenges,
        recommendations: analysis.recommendations,
        scoreBreakdown: analysis.scoreBreakdown,
        collaborationPotential: analysis.collaborationPotential,
      });

      await db.prepare(`UPDATE matching_sessions SET status='completed', completedAt=datetime('now') WHERE id=?`).bind(sessionId).run();
      await addTrustAction(db, initiatorUserId, "matching_complete", 5, `マッチング完了: ${session.theme}`);

      try {
        const score = analysis.compatibilityScore ?? 0;
        await notifyMatchingComplete(db, initiatorUserId, session.theme, score, env);
      } catch { /* non-critical */ }

      this.broadcast({ type: "complete", sessionId });
    } catch (err: any) {
      this.broadcast({ type: "error", message: err?.message || "内部エラー" });
    }
  }
}
