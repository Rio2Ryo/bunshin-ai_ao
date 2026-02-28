import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, getMyTwin, addTrustAction } from "../db-helpers";
import { invokeLLM, getUserLLMConfig } from "../llm";

export const chatRouter = router({
  sessions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT cs.*, (SELECT COUNT(*) FROM chat_messages cm WHERE cm.sessionId = cs.id) as messageCount
       FROM chat_sessions cs WHERE cs.userId=? ORDER BY cs.updatedAt DESC LIMIT 50`
    ).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  getSession: protectedProcedure
    .input(z.object({ id: z.number(), limit: z.number().optional(), offset: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const msgLimit = input.limit ?? 100;
      const msgOffset = input.offset ?? 0;
      const msgs = await ctx.env.DB.prepare(`SELECT * FROM chat_messages WHERE sessionId=? ORDER BY createdAt ASC LIMIT ? OFFSET ?`).bind(input.id, msgLimit, msgOffset).all<any>();
      const totalCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=?`).bind(input.id).first<any>())?.c ?? 0;
      return { session, messages: (msgs.results ?? []).map(m => ({ ...m, metadata: parseJson<any>(m.metadata) })), totalMessages: totalCount };
    }),
  createSession: protectedProcedure
    .input(z.object({ title: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
      const res = await ctx.env.DB.prepare(`INSERT INTO chat_sessions (userId, twinId, title) VALUES (?,?,?)`).bind(ctx.userId, twin.id, input.title || "New Chat").run();
      return { id: Number(res.meta.last_row_id) };
    }),
  sendMessage: protectedProcedure
    .input(z.object({ sessionId: z.number(), content: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);

      // Enforce chatMessagesPerDay plan limit
      const userRow = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      const userPlan = userRow?.plan || "free";
      const chatLimitMap: Record<string, number> = { free: 50, premium: 500, enterprise: -1 };
      const maxMessages = chatLimitMap[userPlan] ?? 50;
      if (maxMessages !== -1) {
        const todayCount = (await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId WHERE cs.userId=? AND cm.role='user' AND cm.createdAt >= date('now')`
        ).bind(ctx.userId).first<any>())?.c ?? 0;
        if (todayCount >= maxMessages) {
          throw new TRPCError({ code: "FORBIDDEN", message: `本日のチャット上限（${maxMessages}回）に達しました。プランをアップグレードしてください。` });
        }
      }

      // Save user message
      await ctx.env.DB.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(input.sessionId, "user", input.content).run();

      // Build context: get twin info, conversation history, and LLM config
      const session = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE id=? AND userId=?`).bind(input.sessionId, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "チャットセッションが見つかりません" });

      const twin = await getMyTwin(ctx.env.DB, ctx.userId);
      const llmConfig = await getUserLLMConfig(ctx.env.DB, ctx.userId, "chat", ctx.env);

      let response: string;

      if (!llmConfig && session.mode === "onboarding") {
        // Onboarding without LLM: provide scripted fallback responses
        const userMsgCount = (await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=? AND role='user'`
        ).bind(input.sessionId).first<any>())?.c ?? 0;
        const fallbackResponses = [
          `ありがとうございます！いい感じですね。\n\n次に、これまでの経験や実績について教えてください。\n例えば「3年間チームリーダーをしていました」「売上を2倍に伸ばしました」など。`,
          `素晴らしいですね！\n\nでは、趣味や興味のあることを教えてください。\n仕事以外でも構いません！`,
          `なるほど！とても多彩ですね。\n\nでは最後に、あなたの性格や大切にしている価値観を教えてください。\n例えば「チームワークを大切にしている」「新しいことに挑戦するのが好き」など。`,
          `ありがとうございます！あなたのことがよく分かりました。\n\n以下の内容であなたの分身AIプロフィールを作成しますね。\n\n---PROFILE_DATA---\n{"description": "多才なプロフェッショナル", "personality": "前向きで協調性がある", "rawInput": "${input.content}"}\n---END_PROFILE_DATA---`,
        ];
        response = fallbackResponses[Math.min(userMsgCount - 1, fallbackResponses.length - 1)] || fallbackResponses[fallbackResponses.length - 1];
      } else if (!llmConfig) {
        response = `AI APIキーが設定されていません。「AI API設定」ページでAPIキー（OpenAI、Gemini、Anthropic等）を登録してください。\n\nあなたのメッセージ: ${input.content}`;
      } else {
        // Check if session is onboarding mode - use twin's systemPrompt directly
        const isOnboarding = session.mode === "onboarding";

        // Build system prompt from twin data
        const twinName = twin?.name || "分身AI";
        let systemPrompt: string;

        if (isOnboarding && twin?.systemPrompt) {
          systemPrompt = twin.systemPrompt;
        } else {
          const twinDesc = twin?.description || "";
          const twinPersonality = twin?.personality || "";
          const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(ctx.userId).first<any>();

          systemPrompt = `あなたは「${twinName}」というデジタル分身AIです。ユーザーの代わりに会話します。`;
          if (twinDesc) systemPrompt += `\n\n分身AIの説明: ${twinDesc}`;
          if (twinPersonality) systemPrompt += `\n\n性格特性: ${twinPersonality}`;
          if (profile?.bio) systemPrompt += `\n\nユーザーの自己紹介: ${profile.bio}`;
          if (profile?.skills) {
            const skills = parseJson<string[]>(profile.skills);
            if (skills?.length) systemPrompt += `\n\nスキル: ${skills.join(", ")}`;
          }
          if (profile?.industry) systemPrompt += `\n\n業界: ${profile.industry}`;

          // Include knowledge base entries for richer context
          if (twin) {
            const knowledgeRows = await ctx.env.DB.prepare(
              `SELECT title, content, summary FROM knowledge_base WHERE twinId=? ORDER BY createdAt DESC LIMIT 8`
            ).bind(twin.id).all<any>();
            const kEntries = knowledgeRows.results ?? [];
            if (kEntries.length > 0) {
              systemPrompt += `\n\n## ユーザーの知識ベース（参考情報）:`;
              for (const k of kEntries) {
                const label = k.title || "エントリ";
                const body = k.summary || (k.content ? k.content.slice(0, 500) : "");
                if (body) systemPrompt += `\n- ${label}: ${body}`;
              }
            }
          }

          systemPrompt += `\n\n丁寧かつ親しみやすい日本語で回答してください。ユーザーの専門知識と知識ベースの情報を反映した回答を心がけてください。`;
        }

        // Get conversation history (last 20 messages)
        const history = await ctx.env.DB.prepare(
          `SELECT role, content FROM chat_messages WHERE sessionId=? ORDER BY createdAt DESC LIMIT 20`
        ).bind(input.sessionId).all<any>();

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...(history.results ?? []).reverse().map((m: any) => ({
            role: m.role as "user" | "assistant",
            content: m.content as string,
          })),
        ];

        try {
          const llmMaxTokens = isOnboarding ? 512 : 2048;
          const result = await invokeLLM(llmConfig, messages, { maxTokens: llmMaxTokens });
          response = result.content;
        } catch (error: any) {
          response = "";
        }

        // Onboarding fallback: if LLM returned empty/very short response, use scripted responses
        if (isOnboarding && (!response || response.trim().length < 10)) {
          const userMsgCount = (await ctx.env.DB.prepare(
            `SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=? AND role='user'`
          ).bind(input.sessionId).first<any>())?.c ?? 0;
          const onboardingFallback = [
            `ありがとうございます！いい感じですね。\n\n次に、これまでの経験や実績について教えてください。\n例えば「3年間チームリーダーをしていました」「売上を2倍に伸ばしました」など。`,
            `素晴らしいですね！\n\nでは、趣味や興味のあることを教えてください。\n仕事以外でも構いません！`,
            `なるほど！とても多彩ですね。\n\nでは最後に、あなたの性格や大切にしている価値観を教えてください。\n例えば「チームワークを大切にしている」「新しいことに挑戦するのが好き」など。`,
            `ありがとうございます！あなたのことがよく分かりました。\n\n以下の内容であなたの分身AIプロフィールを作成しますね。\n\n---PROFILE_DATA---\n{"description": "多才なプロフェッショナル", "personality": "前向きで協調性がある", "rawInput": "${input.content}"}\n---END_PROFILE_DATA---`,
          ];
          response = onboardingFallback[Math.min(userMsgCount - 1, onboardingFallback.length - 1)] || onboardingFallback[onboardingFallback.length - 1];
        } else if (!isOnboarding && (!response || response.trim().length === 0)) {
          response = `AIの応答生成中にエラーが発生しました。APIキーが正しいか、利用制限に達していないか確認してください。`;
        }
      }

      const res = await ctx.env.DB.prepare(`INSERT INTO chat_messages (sessionId, role, content) VALUES (?,?,?)`).bind(input.sessionId, "assistant", response).run();
      await ctx.env.DB.prepare(`UPDATE chat_sessions SET updatedAt=datetime('now') WHERE id=?`).bind(input.sessionId).run();

      // Auto-title: if session still has default title, set it from first user message
      if (session.title === "New Chat" || session.title?.endsWith("とのチャット")) {
        const autoTitle = input.content.slice(0, 30) + (input.content.length > 30 ? "..." : "");
        await ctx.env.DB.prepare(`UPDATE chat_sessions SET title=? WHERE id=?`).bind(autoTitle, input.sessionId).run();
      }

      // Award trust score for conversation (max 1 per 5 messages to avoid spam)
      const totalUserMsgs = (await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE sessionId=? AND role='user'`
      ).bind(input.sessionId).first<any>())?.c ?? 0;
      if (totalUserMsgs % 5 === 0) {
        await addTrustAction(ctx.env.DB, ctx.userId, "chat_conversation", 2, "会話を継続しました");
      }

      return { messageId: Number(res.meta.last_row_id), response };
    }),
  deleteSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id FROM chat_sessions WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      await ctx.env.DB.prepare(`DELETE FROM chat_messages WHERE sessionId=?`).bind(input.id).run();
      await ctx.env.DB.prepare(`DELETE FROM chat_sessions WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
      return { success: true };
    }),
  renameSession: protectedProcedure
    .input(z.object({ id: z.number(), title: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const session = await ctx.env.DB.prepare(`SELECT id FROM chat_sessions WHERE id=? AND userId=?`).bind(input.id, ctx.userId).first<any>();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      await ctx.env.DB.prepare(`UPDATE chat_sessions SET title=?, updatedAt=datetime('now') WHERE id=? AND userId=?`).bind(input.title, input.id, ctx.userId).run();
      return { success: true };
    }),
});
