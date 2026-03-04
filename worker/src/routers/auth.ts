import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, hashPassword, verifyPassword, createSessionToken, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, normalizeTwin, ensureNpcFriends, addTrustAction, logAudit } from "../db-helpers";

export const authRouter = router({
    register: publicProcedure
      .input(z.object({ email: z.string().email().max(255), password: z.string().min(8).max(100), name: z.string().min(1).max(100), tosAccepted: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Check if email already exists
        const existing = await ctx.env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(input.email).first<any>();
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "このメールアドレスは既に登録されています" });
        const passwordHash = await hashPassword(input.password);
        const openId = `email_${input.email}`;
        await ctx.env.DB.prepare(
          `INSERT INTO users (openId, name, email, passwordHash, loginMethod, role, plan) VALUES (?,?,?,?,?,?,?)`
        ).bind(openId, input.name, input.email, passwordHash, "email", "user", "free").run();
        const user = await ctx.env.DB.prepare(`SELECT id, openId, name, email, loginMethod, role, plan, friendCode, createdAt, updatedAt, lastSignedIn, onboardingCompleted, isNpc, onboardingStep, tutorialCompleted, tosAcceptedAt, tosVersion, emailVerified FROM users WHERE email=?`).bind(input.email).first<any>();
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ユーザー作成に失敗しました" });

        // Auto-create default Twin
        const twinName = `${input.name}の分身AI`;
        const onboardingSystemPrompt = `あなたは「ガイド太郎」という分身AIサービスの案内キャラクターです。明るくフレンドリーな口調でユーザーの情報を会話で収集し、分身AIプロフィールを構築します。

ステップ: 1.名前・年齢 → 2.仕事・スキル → 3.趣味・興味 → 4.性格・価値観 → 5.まとめ確認

ルール:
- 各ステップ1-2問だけ聞いて次へ進む
- 応答は200文字以内で短くフレンドリーに
- ユーザーの回答が短くてもポジティブに受けて次へ
- 「ガイド太郎」として明るく丁寧に話す
- ユーザーの名前を聞いたら、以降はその名前で呼びかける

Step 5完了時に以下を出力:
---PROFILE_DATA---
{"description": "概要", "personality": "性格", "rawInput": "全情報まとめ"}
---END_PROFILE_DATA---`;

        // Insert welcome message
        const welcomeMessage = `はじめまして！ガイド太郎です！あなたの「デジタル分身AI」を一緒に作りましょう！

これから簡単な質問をしますので、気軽に答えてくださいね。案内花子さんも友達として追加されています。

プロフィールが完成したら、マッチング候補をご紹介しますよ！

まずはあなたのお名前と年齢を教えてください。
例えば「田中太郎、30歳です」のように教えてもらえると嬉しいです！`;

        // Pre-generate IDs for batch insert (D1 AUTOINCREMENT allows explicit IDs)
        const twinIdTs = Date.now();
        const sessionIdTs = twinIdTs + 1;

        // Batch core creation for atomicity
        await ctx.env.DB.batch([
          ctx.env.DB.prepare(
            `INSERT INTO digital_twins (id, userId, name, systemPrompt, status, updatedAt) VALUES (?, ?, ?, ?, 'active', datetime('now'))`
          ).bind(twinIdTs, user.id, twinName, onboardingSystemPrompt),
          ctx.env.DB.prepare(
            `INSERT INTO chat_sessions (id, userId, twinId, title, mode) VALUES (?, ?, ?, ?, ?)`
          ).bind(sessionIdTs, user.id, twinIdTs, "はじめてのチャット", "onboarding"),
          ctx.env.DB.prepare(
            `INSERT INTO chat_messages (sessionId, role, content) VALUES (?, ?, ?)`
          ).bind(sessionIdTs, "assistant", welcomeMessage),
        ]);
        const twinId = twinIdTs;

        // Auto-create NPC friends (ガイド太郎, 案内花子) with tutorial messages
        await ensureNpcFriends(ctx.env.DB, user.id);

        // Initialize trust score with registration bonus
        await addTrustAction(ctx.env.DB, user.id, "register", 50, "アカウント作成ボーナス");

        // Set TOS acceptance if agreed during registration
        if (input.tosAccepted) {
          await ctx.env.DB.prepare(`UPDATE users SET tosAcceptedAt=datetime('now'), tosVersion='1.0' WHERE email=?`).bind(input.email).run();
        }

        // Email verification flow
        if (ctx.env.RESEND_API_KEY) {
          // Email service configured: require verification
          await ctx.env.DB.prepare(`UPDATE users SET emailVerified=0 WHERE id=?`).bind(user.id).run();

          // Generate email verification token (24-hour expiry)
          const verifyTokenBytes = crypto.getRandomValues(new Uint8Array(32));
          const verifyToken = Array.from(verifyTokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
          await ctx.env.DB.prepare(
            `INSERT INTO email_verification_tokens (userId, token, expiresAt) VALUES (?, ?, datetime('now', '+24 hours'))`
          ).bind(user.id, verifyToken).run();

          // Send verification email via Resend API
          const frontendUrl = ctx.env.FRONTEND_URL || "https://bunshin-ai.pages.dev";
          const verifyUrl = `${frontendUrl}/verify-email?token=${verifyToken}`;
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.com",
                to: [input.email],
                subject: "メールアドレスの確認 — 分身AI",
                html: `<p>${input.name}様</p><p>分身AIへのご登録ありがとうございます。以下のボタンをクリックしてメールアドレスを確認してください。</p><p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;">メールアドレスを確認</a></p><p>このリンクは24時間有効です。</p><p>— 分身AI チーム</p>`,
              }),
            });
          } catch { /* email send failed, but token is still valid */ }

          await logAudit(ctx.env.DB, 'auth.register', user.id, 'user', user.id, { email: input.email });
          return { success: true, requiresVerification: true, email: input.email };
        } else {
          // No email service: auto-verify and allow immediate login
          await ctx.env.DB.prepare(`UPDATE users SET emailVerified=1 WHERE id=?`).bind(user.id).run();
          const { token, sessionId } = await createSessionToken(user.id, ctx.env);
          await ctx.env.DB.prepare(
            `INSERT INTO sessions (id, userId, expiresAt) VALUES (?, ?, datetime('now', '+30 days'))`
          ).bind(sessionId, user.id).run();
          await logAudit(ctx.env.DB, 'auth.register', user.id, 'user', user.id, { email: input.email });
          return {
            user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, onboardingCompleted: user.onboardingCompleted ?? 0 },
            token,
            success: true,
            requiresVerification: false,
          };
        }
      }),
    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1).max(100) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const user = await ctx.env.DB.prepare(`SELECT id, openId, name, email, passwordHash, loginMethod, role, plan, friendCode, createdAt, updatedAt, lastSignedIn, onboardingCompleted, isNpc, onboardingStep, tutorialCompleted, tosAcceptedAt, tosVersion, emailVerified FROM users WHERE email=?`).bind(input.email).first<any>();
        if (!user || !user.passwordHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "メールアドレスまたはパスワードが正しくありません" });
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          await logAudit(ctx.env.DB, 'auth.login.failed', user.id, 'user', user.id, { email: input.email, reason: 'wrong_password' });
          throw new TRPCError({ code: "UNAUTHORIZED", message: "メールアドレスまたはパスワードが正しくありません" });
        }
        // Block login for unverified emails (emailVerified=0). NULL = legacy user, treated as verified.
        if (user.emailVerified === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "メールアドレスが未認証です。受信トレイを確認してください。" });
        }
        await ctx.env.DB.prepare(`UPDATE users SET lastSignedIn=datetime('now') WHERE id=?`).bind(user.id).run();
        const { token, sessionId } = await createSessionToken(user.id, ctx.env);
        await ctx.env.DB.prepare(
          `INSERT INTO sessions (id, userId, expiresAt) VALUES (?, ?, datetime('now', '+30 days'))`
        ).bind(sessionId, user.id).run();
        await logAudit(ctx.env.DB, 'auth.login', user.id, 'user', user.id, { email: input.email });
        return { user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, onboardingCompleted: user.onboardingCompleted ?? 0 }, token };
      }),
    me: publicProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      if (ctx.user) {
        const row = await ctx.env.DB.prepare(`SELECT onboardingCompleted, tutorialCompleted, tosAcceptedAt FROM users WHERE id=?`).bind(ctx.user.id).first<any>();
        const profileRow = await ctx.env.DB.prepare(`SELECT avatarUrl FROM user_profiles WHERE userId=?`).bind(ctx.user.id).first<any>();
        // Get trust score
        const trustRow = await ctx.env.DB.prepare(`SELECT score, rank FROM trust_scores WHERE userId=?`).bind(ctx.user.id).first<any>();
        const trustScore = trustRow?.score ?? 0;
        const trustRank = trustRow?.rank ?? "beginner";

        // Award daily login trust bonus (once per day)
        const today = new Date().toISOString().slice(0, 10);
        const todayLogin = await ctx.env.DB.prepare(
          `SELECT id FROM trust_score_history WHERE userId=? AND action='daily_login' AND createdAt >= ?`
        ).bind(ctx.user.id, today).first<any>();
        if (!todayLogin) {
          await addTrustAction(ctx.env.DB, ctx.user.id, "daily_login", 2, "デイリーログインボーナス");

          // Check 7-day login streak bonus
          const past7Days = await ctx.env.DB.prepare(
            `SELECT DISTINCT date(createdAt) as d FROM trust_score_history WHERE userId=? AND action='daily_login' AND createdAt >= date('now', '-7 days') ORDER BY d`
          ).bind(ctx.user.id).all<any>();
          const streakDays = (past7Days.results?.length ?? 0);
          if (streakDays >= 7) {
            const alreadyStreaked = await ctx.env.DB.prepare(
              `SELECT id FROM trust_score_history WHERE userId=? AND action='login_streak_7' AND createdAt >= date('now', '-7 days')`
            ).bind(ctx.user.id).first<any>();
            if (!alreadyStreaked) {
              await addTrustAction(ctx.env.DB, ctx.user.id, "login_streak_7", 10, "7日連続ログインボーナス");
            }
          }
        }

        // Compute login streak
        const streakRows = await ctx.env.DB.prepare(
          `SELECT DISTINCT date(createdAt) as d FROM trust_score_history WHERE userId=? AND action='daily_login' ORDER BY d DESC LIMIT 30`
        ).bind(ctx.user.id).all<any>();
        let loginStreak = 0;
        const dates = (streakRows.results ?? []).map((r: any) => r.d);
        for (let i = 0; i < dates.length; i++) {
          const expected = new Date();
          expected.setDate(expected.getDate() - i);
          const expectedStr = expected.toISOString().slice(0, 10);
          if (dates[i] === expectedStr) {
            loginStreak++;
          } else {
            break;
          }
        }

        return { ...ctx.user, onboardingCompleted: row?.onboardingCompleted ?? 0, tutorialCompleted: row?.tutorialCompleted ?? 0, tosAcceptedAt: row?.tosAcceptedAt ?? null, trustScore, trustRank, loginStreak, avatarUrl: profileRow?.avatarUrl ?? null };
      }
      // Not logged in
      return null;
    }),
    logout: publicProcedure.mutation(() => ({ success: true })),

    // ---- Session Management ----
    revokeAllSessions: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `UPDATE sessions SET revokedAt=datetime('now') WHERE userId=? AND revokedAt IS NULL`
      ).bind(ctx.userId).run();
      await logAudit(ctx.env.DB, 'auth.revoke_all_sessions', ctx.userId, 'user', ctx.userId);
      return { success: true };
    }),

    listSessions: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT id, createdAt, expiresAt, revokedAt, ipAddress, userAgent FROM sessions WHERE userId=? ORDER BY createdAt DESC LIMIT 20`
      ).bind(ctx.userId).all();
      return rows.results || [];
    }),

    acceptTos: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE users SET tosAcceptedAt=datetime('now'), tosVersion='1.0' WHERE id=?`).bind(ctx.userId).run();
      return { success: true };
    }),

    // ---- GDPR: Data Export ----
    exportMyData: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const userId = ctx.userId;

      const user = await ctx.env.DB.prepare(
        `SELECT id, name, email, plan, role, createdAt, updatedAt, lastSignedIn, onboardingCompleted, tutorialCompleted, tosAcceptedAt, tosVersion FROM users WHERE id=?`
      ).bind(userId).first<any>();
      const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=?`).bind(userId).first<any>();
      const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=?`).bind(userId).first<any>();
      const friends = await ctx.env.DB.prepare(
        `SELECT f.*, u.name as friendName FROM friendships f JOIN users u ON u.id = CASE WHEN f.userId=? THEN f.friendId ELSE f.userId END WHERE (f.userId=? OR f.friendId=?) AND f.status='accepted'`
      ).bind(userId, userId, userId).all<any>();
      const chatSessions = await ctx.env.DB.prepare(`SELECT * FROM chat_sessions WHERE userId=?`).bind(userId).all<any>();
      const matchings = await ctx.env.DB.prepare(`SELECT * FROM matching_sessions WHERE initiatorUserId=?`).bind(userId).all<any>();
      const points = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(userId).first<any>();
      const trustScore = await ctx.env.DB.prepare(`SELECT * FROM trust_scores WHERE userId=?`).bind(userId).first<any>();
      const apiConfigs = await ctx.env.DB.prepare(`SELECT id, provider, isActive, lastValidated, createdAt FROM ai_api_configs WHERE userId=?`).bind(userId).all<any>();
      const cards = await ctx.env.DB.prepare(`SELECT * FROM cards WHERE userId=?`).bind(userId).all<any>();
      const usageTracking = await ctx.env.DB.prepare(`SELECT * FROM usage_tracking WHERE userId=?`).bind(userId).first<any>();

      // Strip sensitive fields from twin
      if (twin) {
        delete twin.systemPrompt;
      }

      await logAudit(ctx.env.DB, 'auth.export_data', ctx.userId, 'user', ctx.userId);

      return {
        exportedAt: new Date().toISOString(),
        user: user ? { ...user, passwordHash: undefined } : null,
        profile: profile ? { ...profile, skills: parseJson<string[]>(profile.skills) ?? [], expertise: parseJson<string[]>(profile.expertise) ?? [] } : null,
        twin: twin ? normalizeTwin(twin) : null,
        friends: friends.results ?? [],
        chatSessionCount: chatSessions.results?.length ?? 0,
        matchingSessionCount: matchings.results?.length ?? 0,
        points,
        trustScore,
        apiConfigs: apiConfigs.results ?? [],
        cards: cards.results ?? [],
        usageTracking,
      };
    }),

    // ---- GDPR: Account Deletion (comprehensive cascade delete — all tables) ----
    deleteAccount: protectedProcedure
      .input(z.object({ password: z.string().min(1).max(100), confirmation: z.literal("DELETE") }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const db = ctx.env.DB;

        // Verify password
        const user = await db.prepare(`SELECT passwordHash, email FROM users WHERE id=?`).bind(ctx.userId).first<any>();
        if (!user?.passwordHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが設定されていません" });
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが正しくありません" });

        const userId = ctx.userId;

        // Get user's twin ID for cascade deletes
        const twin = await db.prepare(`SELECT id FROM digital_twins WHERE userId=?`).bind(userId).first<any>();
        const twinId = twin?.id;

        // Cancel Stripe subscription if exists
        const stripeUser = await db.prepare(`SELECT stripeSubscriptionId FROM users WHERE id=?`).bind(userId).first<any>();
        if (stripeUser?.stripeSubscriptionId && ctx.env.STRIPE_SECRET_KEY) {
          try {
            await fetch(`https://api.stripe.com/v1/subscriptions/${stripeUser.stripeSubscriptionId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` },
            });
          } catch { /* ignore Stripe errors during deletion */ }
        }

        // Helper: run a batch of prepared statements, ignoring errors for missing tables
        const safeBatch = async (stmts: D1PreparedStatement[]) => {
          if (stmts.length === 0) return;
          try { await db.batch(stmts); } catch {
            // If batch fails (e.g. table doesn't exist), fall back to individual execution
            for (const stmt of stmts) {
              try { await stmt.run(); } catch { /* table may not exist */ }
            }
          }
        };

        // ===== PHASE 1: Child tables with indirect references (delete before parents) =====
        await safeBatch([
          db.prepare(`DELETE FROM negotiation_turns WHERE negotiationId IN (SELECT id FROM negotiation_sessions WHERE userId=?)`).bind(userId),
          db.prepare(`DELETE FROM twin_collaboration_turns WHERE collaborationId IN (SELECT id FROM twin_collaborations WHERE userId=?)`).bind(userId),
          db.prepare(`DELETE FROM twin_coaching_messages WHERE sessionId IN (SELECT id FROM twin_coaching_sessions WHERE userId=?)`).bind(userId),
          db.prepare(`DELETE FROM curriculum_progress WHERE curriculumId IN (SELECT id FROM learning_curricula WHERE userId=?)`).bind(userId),
          db.prepare(`DELETE FROM context_switch_logs WHERE ruleId IN (SELECT id FROM context_switch_rules WHERE userId=?)`).bind(userId),
          db.prepare(`DELETE FROM facilitator_interventions WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId),
          db.prepare(`DELETE FROM matching_emotion_analysis WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId),
          db.prepare(`DELETE FROM matching_highlights WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId),
          db.prepare(`DELETE FROM journal_comments WHERE journalId IN (SELECT id FROM learning_journal_entries WHERE userId=?)`).bind(userId),
        ]);

        // ===== PHASE 2: Twin-related tables (only if twin exists) =====
        if (twinId) {
          // Batch 2a: existing + new twin tables (first half)
          await safeBatch([
            db.prepare(`DELETE FROM knowledge_base WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_growth_status WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_skill_levels WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_milestones WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_visibility_rules WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM conversation_learning WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_personas WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM knowledge_graphs WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_knowledge_graphs WHERE userId=?`).bind(userId),
            db.prepare(`DELETE FROM sandbox_sessions WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_benchmarks WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM emotion_journal_entries WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_goals WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM knowledge_quizzes WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM persona_ab_tests WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM dialogue_style_profiles WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM personality_reports WHERE twinId=?`).bind(twinId),
          ]);

          // Batch 2b: remaining twin tables
          await safeBatch([
            db.prepare(`DELETE FROM context_switch_rules WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM learning_curricula WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM external_connectors WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM learning_journal_entries WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM roleplay_sessions WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM emotion_calibration WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM multimodal_inputs WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_faqs WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_templates WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_clones WHERE sourceUserId=?`).bind(userId),
            db.prepare(`DELETE FROM twin_evolution_events WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM conversation_style_analysis WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_memories WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_versions WHERE twinId=?`).bind(twinId),
            db.prepare(`DELETE FROM twin_coaching_sessions WHERE twinId=?`).bind(twinId),
          ]);
        }

        // ===== PHASE 3: All userId-referenced tables =====

        // Batch 3a: Chat data
        await safeBatch([
          db.prepare(`DELETE FROM chat_messages WHERE sessionId IN (SELECT id FROM chat_sessions WHERE userId=?)`).bind(userId),
          db.prepare(`DELETE FROM chat_sessions WHERE userId=?`).bind(userId),
        ]);

        // Batch 3b: Matching data (child tables first)
        await safeBatch([
          db.prepare(`DELETE FROM matching_dialogues WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId),
          db.prepare(`DELETE FROM matching_results WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId),
          db.prepare(`DELETE FROM matching_sessions WHERE initiatorUserId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_requests WHERE senderUserId=? OR receiverUserId=?`).bind(userId, userId),
          db.prepare(`DELETE FROM auto_matching_schedules WHERE userId=?`).bind(userId),
        ]);

        // Batch 3c: Social & waveforms
        await safeBatch([
          db.prepare(`DELETE FROM friendships WHERE userId=? OR friendId=?`).bind(userId, userId),
          db.prepare(`DELETE FROM intimacy_scores WHERE userId=? OR friendId=?`).bind(userId, userId),
          db.prepare(`DELETE FROM value_scenario_responses WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM cumulative_waveforms WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM other_perspective_waveforms WHERE userId=?`).bind(userId),
        ]);

        // Batch 3d: Points & marketplace
        await safeBatch([
          db.prepare(`DELETE FROM point_transactions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM user_points WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM persona_purchases WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM persona_reviews WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM point_redemptions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM scenario_purchases WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM scenario_reviews WHERE userId=?`).bind(userId),
        ]);
        // Anonymize persona templates & matching scenarios (preserve marketplace integrity)
        try { await db.prepare(`UPDATE persona_templates SET creatorUserId=0 WHERE creatorUserId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await db.prepare(`UPDATE matching_scenarios SET creatorUserId=0 WHERE creatorUserId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Batch 3e: Config, connections, files
        await safeBatch([
          db.prepare(`DELETE FROM ai_api_configs WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM orchestration_roles WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM ai_provider_settings WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM notification_settings WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM line_connections WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM clawdbot_connections WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM uploaded_files WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM cards WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM content_reports WHERE reporterUserId=?`).bind(userId),
        ]);

        // Batch 3f: Trust, usage, notifications, tokens, sessions
        await safeBatch([
          db.prepare(`DELETE FROM trust_score_history WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM trust_scores WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM usage_tracking WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM notifications WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM password_reset_tokens WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM email_verification_tokens WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM sessions WHERE userId=?`).bind(userId),
        ]);

        // Batch 3g: Notification preferences, blocks, matching extensions
        await safeBatch([
          db.prepare(`DELETE FROM notification_preferences WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM user_blocks WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_comments WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_reactions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM personality_profiles WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM dialogue_feedback WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_session_participants WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM push_subscriptions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_notes WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM api_keys WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM webhooks WHERE userId=?`).bind(userId),
        ]);

        // Batch 3h: Cross-culture, second opinions, scheduler, predictions
        await safeBatch([
          db.prepare(`DELETE FROM cross_culture_analyses WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM second_opinions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM scheduler_preferences WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_predictions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM feed_items WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM feed_likes WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM feed_comments WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_templates WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_template_uses WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_insights WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_coach_advice WHERE userId=?`).bind(userId),
        ]);

        // Batch 3i: Workspace, negotiation, smart matching
        await safeBatch([
          db.prepare(`DELETE FROM workspace_board_items WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM negotiation_sessions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM smart_matching_recommendations WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_challenges WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM challenge_participants WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_strategies WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM twin_collaborations WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_action_items WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_outcomes WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_quality_scores WHERE userId=?`).bind(userId),
        ]);

        // Batch 3j: Digests, playbooks, network graphs, scenarios
        await safeBatch([
          db.prepare(`DELETE FROM matching_digests WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_playbooks WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_network_graphs WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM scenario_comparisons WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM custom_widgets WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_minutes WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM roi_goals WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_calendar_events WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_reminders WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_peer_reviews WHERE userId=?`).bind(userId),
        ]);

        // Batch 3k: Debates, community, replays, heatmaps
        await safeBatch([
          db.prepare(`DELETE FROM debate_sessions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM debate_rankings WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM community_events WHERE organizerId=?`).bind(userId),
          db.prepare(`DELETE FROM community_event_participants WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM replay_commentaries WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_heatmap_analyses WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_storyboards WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM storyboard_collections WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM session_tags WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM weekly_reviews WHERE userId=?`).bind(userId),
        ]);

        // Batch 3l: Themes, success patterns, interactive scenarios, translations
        await safeBatch([
          db.prepare(`DELETE FROM theme_recommendations WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM theme_rankings WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM success_patterns WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM interactive_scenarios WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM translation_chat_messages WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM translation_chat_sessions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_summaries WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM comparison_timelines WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM emotion_flow_analyses WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM connector_sync_logs WHERE userId=?`).bind(userId),
        ]);

        // Batch 3m: Multi-perspective, team battles, risk, impact maps
        await safeBatch([
          db.prepare(`DELETE FROM multi_perspective_replays WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM team_battles WHERE creatorUserId=?`).bind(userId),
          db.prepare(`DELETE FROM team_battle_members WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM risk_assessments WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM impact_map_entries WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM impact_map_reports WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM strategy_annotations WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM dialogue_quality_scores WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM rehearsal_sessions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM consensus_tracking WHERE userId=?`).bind(userId),
        ]);

        // Batch 3n: Trust progress, brainstorm, voice notes, briefings, etc.
        await safeBatch([
          db.prepare(`DELETE FROM trust_progress WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM brainstorm_sessions WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_voice_notes WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM daily_briefings WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM session_bookmarks WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM action_plans WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_streaks WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM matching_achievements WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM friend_activities WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM error_logs WHERE userId=?`).bind(userId),
        ]);

        // Batch 3o: Workspaces (owner + member + items + goals)
        await safeBatch([
          db.prepare(`DELETE FROM workspace_items WHERE createdBy=?`).bind(userId),
          db.prepare(`DELETE FROM workspace_goals WHERE createdBy=?`).bind(userId),
          db.prepare(`DELETE FROM workspace_members WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM workspaces WHERE ownerId=?`).bind(userId),
        ]);

        // Batch 3p: Tournament matches (player on either side)
        try { await db.prepare(`DELETE FROM tournament_matches WHERE player1UserId=? OR player2UserId=?`).bind(userId, userId).run(); } catch { /* ignore */ }

        // ===== PHASE 4: R2 cleanup (best-effort) =====
        try {
          const assets = ctx.env.ASSETS;
          if (assets) {
            // Delete avatar
            await assets.delete(`avatars/${userId}`).catch(() => {});
            // List and delete user's uploaded files
            const fileList = await assets.list({ prefix: `users/${userId}/` });
            if (fileList.objects.length > 0) {
              await Promise.all(fileList.objects.map(obj => assets.delete(obj.key).catch(() => {})));
            }
          }
        } catch { /* R2 cleanup is best-effort */ }

        // ===== PHASE 5: Audit log entry (before user deletion) =====
        await logAudit(db, 'account.delete', userId, 'user', userId, { email: user.email });

        // ===== PHASE 6: Profile, twin, and user record (last) =====
        await safeBatch([
          db.prepare(`DELETE FROM user_profiles WHERE userId=?`).bind(userId),
          db.prepare(`DELETE FROM digital_twins WHERE userId=?`).bind(userId),
        ]);

        // User record (absolute last)
        try { await db.prepare(`DELETE FROM users WHERE id=?`).bind(userId).run(); } catch { /* ignore */ }

        return { success: true, message: "アカウントが完全に削除されました" };
      }),

    // ---- Password Reset: Request ----
    requestPasswordReset: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const user = await ctx.env.DB.prepare(`SELECT id, email, name FROM users WHERE email=?`).bind(input.email).first<any>();
        // Always return success to prevent email enumeration
        if (!user) return { success: true };

        // Generate secure random token
        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");

        // Expire any existing tokens for this user
        await ctx.env.DB.prepare(`UPDATE password_reset_tokens SET usedAt=datetime('now') WHERE userId=? AND usedAt IS NULL`).bind(user.id).run();

        // Store token with 1-hour expiry
        await ctx.env.DB.prepare(
          `INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, datetime('now', '+1 hour'))`
        ).bind(user.id, token).run();

        await logAudit(ctx.env.DB, 'auth.password_reset_request', user.id, 'user', user.id, { email: input.email });

        // Send reset email if RESEND_API_KEY is configured
        const frontendUrl = ctx.env.FRONTEND_URL || "https://bunshin-ai.pages.dev";
        const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

        if (ctx.env.RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.com",
                to: [user.email],
                subject: "パスワードリセット — 分身AI",
                html: `<p>${user.name || "ユーザー"}様</p><p>パスワードリセットのリクエストを受け付けました。</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;">パスワードをリセット</a></p><p>このリンクは1時間有効です。心当たりがない場合は無視してください。</p><p>— 分身AI チーム</p>`,
              }),
            });
          } catch { /* email send failed, but token is still valid */ }
        }

        return { success: true };
      }),

    // ---- Password Reset: Execute ----
    resetPassword: publicProcedure
      .input(z.object({ token: z.string().min(1), newPassword: z.string().min(8).max(100) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const tokenRow = await ctx.env.DB.prepare(
          `SELECT * FROM password_reset_tokens WHERE token=? AND usedAt IS NULL AND expiresAt > datetime('now')`
        ).bind(input.token).first<any>();
        if (!tokenRow) throw new TRPCError({ code: "BAD_REQUEST", message: "リセットリンクが無効または期限切れです。再度リクエストしてください。" });

        const passwordHash = await hashPassword(input.newPassword);
        await ctx.env.DB.prepare(`UPDATE users SET passwordHash=?, updatedAt=datetime('now') WHERE id=?`).bind(passwordHash, tokenRow.userId).run();

        // Mark token as used
        await ctx.env.DB.prepare(`UPDATE password_reset_tokens SET usedAt=datetime('now') WHERE id=?`).bind(tokenRow.id).run();

        // Revoke ALL existing sessions for this user (password changed)
        await ctx.env.DB.prepare(
          `UPDATE sessions SET revokedAt=datetime('now') WHERE userId=? AND revokedAt IS NULL`
        ).bind(tokenRow.userId).run();

        await logAudit(ctx.env.DB, 'auth.password_reset', tokenRow.userId, 'user', tokenRow.userId);

        return { success: true };
      }),

    // ---- Email Verification: Verify ----
    verifyEmail: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const tokenRow = await ctx.env.DB.prepare(
          `SELECT * FROM email_verification_tokens WHERE token=? AND usedAt IS NULL AND expiresAt > datetime('now')`
        ).bind(input.token).first<any>();
        if (!tokenRow) throw new TRPCError({ code: "BAD_REQUEST", message: "認証リンクが無効または期限切れです。再送信してください。" });

        // Mark email as verified
        await ctx.env.DB.prepare(`UPDATE users SET emailVerified=1 WHERE id=?`).bind(tokenRow.userId).run();
        // Mark token as used
        await ctx.env.DB.prepare(`UPDATE email_verification_tokens SET usedAt=datetime('now') WHERE id=?`).bind(tokenRow.id).run();

        // Auto-login: create session token
        const user = await ctx.env.DB.prepare(`SELECT id, openId, name, email, loginMethod, role, plan, friendCode, createdAt, updatedAt, lastSignedIn, onboardingCompleted, isNpc, onboardingStep, tutorialCompleted, tosAcceptedAt, tosVersion, emailVerified FROM users WHERE id=?`).bind(tokenRow.userId).first<any>();
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ユーザーが見つかりません" });
        await ctx.env.DB.prepare(`UPDATE users SET lastSignedIn=datetime('now') WHERE id=?`).bind(user.id).run();
        const { token, sessionId } = await createSessionToken(user.id, ctx.env);
        await ctx.env.DB.prepare(
          `INSERT INTO sessions (id, userId, expiresAt) VALUES (?, ?, datetime('now', '+30 days'))`
        ).bind(sessionId, user.id).run();
        return {
          user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, onboardingCompleted: user.onboardingCompleted ?? 0 },
          token,
        };
      }),

    // ---- Email Verification: Resend ----
    resendVerification: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const user = await ctx.env.DB.prepare(`SELECT id, email, name, emailVerified FROM users WHERE email=?`).bind(input.email).first<any>();
        // Always return success to prevent email enumeration
        if (!user || user.emailVerified !== 0) return { success: true };

        // Invalidate existing tokens
        await ctx.env.DB.prepare(`UPDATE email_verification_tokens SET usedAt=datetime('now') WHERE userId=? AND usedAt IS NULL`).bind(user.id).run();

        // Generate new token (24-hour expiry)
        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
        await ctx.env.DB.prepare(
          `INSERT INTO email_verification_tokens (userId, token, expiresAt) VALUES (?, ?, datetime('now', '+24 hours'))`
        ).bind(user.id, token).run();

        // Send email via Resend
        const frontendUrl = ctx.env.FRONTEND_URL || "https://bunshin-ai.pages.dev";
        const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;
        if (ctx.env.RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: ctx.env.RESEND_FROM_EMAIL || "noreply@bunshin-ai.com",
                to: [user.email],
                subject: "メールアドレスの確認 — 分身AI",
                html: `<p>${user.name || "ユーザー"}様</p><p>メールアドレスの確認リンクを再送します。以下のボタンをクリックしてください。</p><p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;">メールアドレスを確認</a></p><p>このリンクは24時間有効です。</p><p>— 分身AI チーム</p>`,
              }),
            });
          } catch { /* email send failed */ }
        }

        return { success: true };
      }),
});
