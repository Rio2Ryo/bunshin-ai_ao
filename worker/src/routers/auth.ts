import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, hashPassword, verifyPassword, createSessionToken, type Env, type Context } from "../trpc";
import { ensureSchema, parseJson, normalizeTwin, ensureNpcFriends, addTrustAction } from "../db-helpers";

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

          return { success: true, requiresVerification: true, email: input.email };
        } else {
          // No email service: auto-verify and allow immediate login
          await ctx.env.DB.prepare(`UPDATE users SET emailVerified=1 WHERE id=?`).bind(user.id).run();
          const token = await createSessionToken(user.id, ctx.env);
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
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "メールアドレスまたはパスワードが正しくありません" });
        // Block login for unverified emails (emailVerified=0). NULL = legacy user, treated as verified.
        if (user.emailVerified === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "メールアドレスが未認証です。受信トレイを確認してください。" });
        }
        await ctx.env.DB.prepare(`UPDATE users SET lastSignedIn=datetime('now') WHERE id=?`).bind(user.id).run();
        const token = await createSessionToken(user.id, ctx.env);
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

    // ---- GDPR: Account Deletion ----
    deleteAccount: protectedProcedure
      .input(z.object({ password: z.string().min(1).max(100), confirmation: z.literal("DELETE") }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);

        // Verify password
        const user = await ctx.env.DB.prepare(`SELECT passwordHash FROM users WHERE id=?`).bind(ctx.userId).first<any>();
        if (!user?.passwordHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが設定されていません" });
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが正しくありません" });

        const userId = ctx.userId;

        // Get user's twin ID for cascade deletes
        const twin = await ctx.env.DB.prepare(`SELECT id FROM digital_twins WHERE userId=?`).bind(userId).first<any>();
        const twinId = twin?.id;

        // Cancel Stripe subscription if exists
        const stripeUser = await ctx.env.DB.prepare(`SELECT stripeSubscriptionId FROM users WHERE id=?`).bind(userId).first<any>();
        if (stripeUser?.stripeSubscriptionId && ctx.env.STRIPE_SECRET_KEY) {
          try {
            await fetch(`https://api.stripe.com/v1/subscriptions/${stripeUser.stripeSubscriptionId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` },
            });
          } catch { /* ignore Stripe errors during deletion */ }
        }

        // Clean up R2 files (avatars, uploads, card images)
        const r2 = ctx.env.ASSETS;
        if (r2) {
          try {
            // Delete avatar
            const profile = await ctx.env.DB.prepare(`SELECT avatarUrl FROM user_profiles WHERE userId=?`).bind(userId).first<any>();
            if (profile?.avatarUrl?.startsWith("/assets/")) {
              const key = profile.avatarUrl.replace(/^\/assets\//, "");
              try { await r2.delete(key); } catch {}
            }
          } catch {}

          try {
            // Delete uploaded files
            const files = await ctx.env.DB.prepare(`SELECT r2Key FROM uploaded_files WHERE userId=?`).bind(userId).all<any>();
            for (const f of files.results ?? []) {
              if (f.r2Key) {
                try { await r2.delete(f.r2Key); } catch {}
              }
            }
          } catch {}

          try {
            // Delete card images
            const cards = await ctx.env.DB.prepare(`SELECT frontImageUrl, backImageUrl FROM cards WHERE userId=?`).bind(userId).all<any>();
            for (const card of cards.results ?? []) {
              for (const url of [card.frontImageUrl, card.backImageUrl]) {
                if (url?.startsWith("/assets/")) {
                  const key = url.replace(/^\/assets\//, "");
                  try { await r2.delete(key); } catch {}
                }
              }
            }
          } catch {}
        }

        // Delete all user data using parameterized queries
        // Twin-related tables (only if twin exists)
        if (twinId) {
          const twinDeletions = [
            ctx.env.DB.prepare(`DELETE FROM knowledge_base WHERE twinId=?`).bind(twinId),
            ctx.env.DB.prepare(`DELETE FROM twin_growth_status WHERE twinId=?`).bind(twinId),
            ctx.env.DB.prepare(`DELETE FROM twin_skill_levels WHERE twinId=?`).bind(twinId),
            ctx.env.DB.prepare(`DELETE FROM twin_milestones WHERE twinId=?`).bind(twinId),
            ctx.env.DB.prepare(`DELETE FROM twin_visibility_rules WHERE twinId=?`).bind(twinId),
            ctx.env.DB.prepare(`DELETE FROM conversation_learning WHERE twinId=?`).bind(twinId),
          ];
          for (const stmt of twinDeletions) {
            try { await stmt.run(); } catch { /* table may not exist */ }
          }
        }

        // Chat data
        try { await ctx.env.DB.prepare(`DELETE FROM chat_messages WHERE sessionId IN (SELECT id FROM chat_sessions WHERE userId=?)`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM chat_sessions WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Matching data
        try { await ctx.env.DB.prepare(`DELETE FROM matching_dialogues WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM matching_results WHERE sessionId IN (SELECT id FROM matching_sessions WHERE initiatorUserId=?)`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM matching_sessions WHERE initiatorUserId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM matching_requests WHERE senderUserId=? OR receiverUserId=?`).bind(userId, userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM auto_matching_schedules WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Social
        try { await ctx.env.DB.prepare(`DELETE FROM friendships WHERE userId=? OR friendId=?`).bind(userId, userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM intimacy_scores WHERE userId=? OR friendId=?`).bind(userId, userId).run(); } catch { /* ignore */ }

        // Waveforms & scenarios
        try { await ctx.env.DB.prepare(`DELETE FROM value_scenario_responses WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM cumulative_waveforms WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM other_perspective_waveforms WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Points & marketplace
        try { await ctx.env.DB.prepare(`DELETE FROM point_transactions WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM user_points WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM persona_purchases WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM persona_reviews WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        // Anonymize persona templates (preserve marketplace integrity)
        try { await ctx.env.DB.prepare(`UPDATE persona_templates SET creatorUserId=0 WHERE creatorUserId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Config & connections
        try { await ctx.env.DB.prepare(`DELETE FROM ai_api_configs WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM orchestration_roles WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM ai_provider_settings WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM notification_settings WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM line_connections WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM clawdbot_connections WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Files & cards
        try { await ctx.env.DB.prepare(`DELETE FROM uploaded_files WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM cards WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Reports & moderation
        try { await ctx.env.DB.prepare(`DELETE FROM content_reports WHERE reporterUserId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Trust
        try { await ctx.env.DB.prepare(`DELETE FROM trust_score_history WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM trust_scores WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Usage
        try { await ctx.env.DB.prepare(`DELETE FROM usage_tracking WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Notifications (table may not exist yet)
        try { await ctx.env.DB.prepare(`DELETE FROM notifications WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Point redemptions
        try { await ctx.env.DB.prepare(`DELETE FROM point_redemptions WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Password reset tokens
        try { await ctx.env.DB.prepare(`DELETE FROM password_reset_tokens WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        // Email verification tokens
        try { await ctx.env.DB.prepare(`DELETE FROM email_verification_tokens WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // Profile & twin (near-last)
        try { await ctx.env.DB.prepare(`DELETE FROM user_profiles WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }
        try { await ctx.env.DB.prepare(`DELETE FROM digital_twins WHERE userId=?`).bind(userId).run(); } catch { /* ignore */ }

        // User record (last)
        try { await ctx.env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(userId).run(); } catch { /* ignore */ }

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
        const token = await createSessionToken(user.id, ctx.env);
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
