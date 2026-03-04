import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson, getMyTwin } from "../db-helpers";
import { createNotification } from "../notifications";

export const adminRouter = router({
    // Dashboard overview
    overview: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    }).query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const userCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE isNpc=0`).first<any>();
      const twinCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM digital_twins`).first<any>();
      const matchingCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM matching_sessions`).first<any>();
      const reportCount = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM content_reports WHERE status='pending'`).first<any>();
      const recentUsers = await ctx.env.DB.prepare(`SELECT id, name, email, createdAt FROM users WHERE isNpc=0 ORDER BY createdAt DESC LIMIT 10`).all<any>();
      const recentMatchings = await ctx.env.DB.prepare(`SELECT ms.id, ms.theme, ms.status, ms.createdAt, u.name as initiatorName FROM matching_sessions ms JOIN users u ON u.id = ms.initiatorUserId ORDER BY ms.createdAt DESC LIMIT 10`).all<any>();
      return {
        stats: {
          users: userCount?.c ?? 0,
          twins: twinCount?.c ?? 0,
          matchings: matchingCount?.c ?? 0,
          pendingReports: reportCount?.c ?? 0,
        },
        recentUsers: recentUsers.results ?? [],
        recentMatchings: recentMatchings.results ?? [],
      };
    }),

    // List content reports
    reports: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    })
      .input(z.object({ status: z.enum(["pending", "reviewed", "dismissed"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const status = input?.status || "pending";
        const rows = await ctx.env.DB.prepare(
          `SELECT cr.*, u.name as reporterName FROM content_reports cr JOIN users u ON u.id = cr.reporterUserId WHERE cr.status=? ORDER BY cr.createdAt DESC LIMIT 50`
        ).bind(status).all<any>();
        return rows.results ?? [];
      }),

    // Review a report
    reviewReport: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    })
      .input(z.object({ reportId: z.number(), action: z.enum(["approve", "dismiss", "delete_content", "warn_user", "ban_user"]), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const report = await ctx.env.DB.prepare(`SELECT * FROM content_reports WHERE id=?`).bind(input.reportId).first<any>();
        if (!report) throw new TRPCError({ code: "NOT_FOUND" });

        // Update report status
        await ctx.env.DB.prepare(
          `UPDATE content_reports SET status='reviewed', reviewedBy=?, reviewedAt=datetime('now'), action=? WHERE id=?`
        ).bind(ctx.userId, input.action, input.reportId).run();

        // Log moderation action
        await ctx.env.DB.prepare(
          `INSERT INTO moderation_actions (adminUserId, targetType, targetId, action, reason) VALUES (?,?,?,?,?)`
        ).bind(ctx.userId, report.targetType, report.targetId, input.action, input.reason || "").run();

        // Execute action
        if (input.action === "delete_content") {
          if (report.targetType === "twin") {
            await ctx.env.DB.prepare(`UPDATE digital_twins SET isPublic=0 WHERE id=?`).bind(report.targetId).run();
          } else if (report.targetType === "persona_template") {
            await ctx.env.DB.prepare(`UPDATE persona_templates SET isPublished=0, isApproved=0 WHERE id=?`).bind(report.targetId).run();
          }
        }

        // Warn user: send in-app notification
        if (input.action === "warn_user") {
          let targetUserId: number | null = null;
          if (report.targetType === "user_profile") {
            targetUserId = report.targetId;
          } else if (report.targetType === "twin") {
            const twin = await ctx.env.DB.prepare(`SELECT userId FROM digital_twins WHERE id=?`).bind(report.targetId).first<any>();
            targetUserId = twin?.userId ?? null;
          } else if (report.targetType === "persona_template") {
            const tmpl = await ctx.env.DB.prepare(`SELECT creatorUserId FROM persona_templates WHERE id=?`).bind(report.targetId).first<any>();
            targetUserId = tmpl?.creatorUserId ?? null;
          } else if (report.targetType === "chat_message") {
            const msg = await ctx.env.DB.prepare(`SELECT cm.sessionId, cs.userId FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId WHERE cm.id=?`).bind(report.targetId).first<any>();
            targetUserId = msg?.userId ?? null;
          }
          if (targetUserId) {
            await createNotification(ctx.env.DB, targetUserId, "admin_warning", "管理者からの警告", input.reason || "コンテンツポリシーに違反する可能性があります。繰り返しの違反はアカウント停止につながります。", { reportId: input.reportId });
          }
        }

        // Ban user: set isBanned flag + revoke all sessions
        if (input.action === "ban_user") {
          let targetUserId: number | null = null;
          if (report.targetType === "user_profile") {
            targetUserId = report.targetId;
          } else if (report.targetType === "twin") {
            const twin = await ctx.env.DB.prepare(`SELECT userId FROM digital_twins WHERE id=?`).bind(report.targetId).first<any>();
            targetUserId = twin?.userId ?? null;
          } else if (report.targetType === "persona_template") {
            const tmpl = await ctx.env.DB.prepare(`SELECT creatorUserId FROM persona_templates WHERE id=?`).bind(report.targetId).first<any>();
            targetUserId = tmpl?.creatorUserId ?? null;
          } else if (report.targetType === "chat_message") {
            const msg = await ctx.env.DB.prepare(`SELECT cm.sessionId, cs.userId FROM chat_messages cm JOIN chat_sessions cs ON cs.id=cm.sessionId WHERE cm.id=?`).bind(report.targetId).first<any>();
            targetUserId = msg?.userId ?? null;
          }
          if (targetUserId) {
            await ctx.env.DB.prepare(`UPDATE users SET isBanned=1, bannedAt=datetime('now'), bannedReason=? WHERE id=?`).bind(input.reason || "コンテンツポリシー違反", targetUserId).run();
            // Revoke all sessions to force immediate logout
            try { await ctx.env.DB.prepare(`UPDATE sessions SET revokedAt=datetime('now') WHERE userId=? AND revokedAt IS NULL`).bind(targetUserId).run(); } catch {}
            // Send notification before ban takes effect
            await createNotification(ctx.env.DB, targetUserId, "account_banned", "アカウント停止", input.reason || "コンテンツポリシーに違反したため、アカウントが停止されました。", { reportId: input.reportId });
          }
        }

        return { success: true };
      }),

    // List all users (with pagination)
    users: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    })
      .input(z.object({ limit: z.number().default(50), offset: z.number().default(0), search: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        let sql = `SELECT u.id, u.name, u.email, u.role, u.plan, u.createdAt, u.isNpc,
          (SELECT COUNT(*) FROM matching_sessions WHERE initiatorUserId=u.id) as matchingCount,
          (SELECT score FROM trust_scores WHERE userId=u.id) as trustScore
          FROM users u WHERE u.isNpc=0`;
        const binds: any[] = [];
        if (input?.search) { sql += ` AND (u.name LIKE ? OR u.email LIKE ?)`; binds.push(`%${input.search}%`, `%${input.search}%`); }
        sql += ` ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`;
        binds.push(input?.limit ?? 50, input?.offset ?? 0);
        const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<any>();
        const total = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE isNpc=0`).first<any>();
        return { users: rows.results ?? [], total: total?.c ?? 0 };
      }),

    // Moderation history
    moderationHistory: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    }).query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT ma.*, u.name as adminName FROM moderation_actions ma JOIN users u ON u.id = ma.adminUserId ORDER BY ma.createdAt DESC LIMIT 50`
      ).all<any>();
      return rows.results ?? [];
    }),

    // Error statistics (last 24 hours)
    getErrorStats: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    }).query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      try {
        // Try to read from error_logs table if it exists
        const rows = await ctx.env.DB.prepare(
          `SELECT level, path, message, COUNT(*) as count
           FROM error_logs
           WHERE createdAt >= datetime('now', '-24 hours')
           GROUP BY level, path, message
           ORDER BY count DESC
           LIMIT 100`
        ).all<any>();
        return rows.results ?? [];
      } catch {
        // Table does not exist — return empty array
        return [];
      }
    }),

    // Revenue dashboard
    revenue: protectedProcedure.use(async ({ ctx, next }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      return next();
    }).query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);

      // Plan distribution
      const planDist = await ctx.env.DB.prepare(
        `SELECT plan, COUNT(*) as count FROM users WHERE isNpc=0 GROUP BY plan`
      ).all<any>();

      // Monthly signups (last 12 months)
      const monthlySignups = await ctx.env.DB.prepare(
        `SELECT strftime('%Y-%m', createdAt) as month, COUNT(*) as count, plan
         FROM users WHERE isNpc=0 AND createdAt >= date('now', '-12 months')
         GROUP BY month, plan ORDER BY month`
      ).all<any>();

      // Total users
      const totalUsers = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE isNpc=0`).first<any>())?.c ?? 0;

      // Active users (logged in within last 30 days)
      const activeUsers = (await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM users WHERE isNpc=0 AND lastSignedIn >= date('now', '-30 days')`
      ).first<any>())?.c ?? 0;

      // Churn: users who were active last period but haven't logged in for 30+ days
      const churned = (await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM users WHERE isNpc=0 AND lastSignedIn < date('now', '-30 days') AND lastSignedIn >= date('now', '-60 days')`
      ).first<any>())?.c ?? 0;
      const activeLastPeriod = (await ctx.env.DB.prepare(
        `SELECT COUNT(*) as c FROM users WHERE isNpc=0 AND lastSignedIn >= date('now', '-60 days') AND lastSignedIn < date('now', '-30 days')`
      ).first<any>())?.c ?? 0;
      const churnRate = activeLastPeriod > 0 ? Math.round((churned / activeLastPeriod) * 100) : 0;

      // Revenue estimate (from plan counts × price)
      const priceMap: Record<string, number> = { free: 0, premium: 1480, enterprise: 4980 };
      const planResults = planDist.results ?? [];
      const monthlyRevenue = planResults.reduce((sum: number, p: any) => sum + ((priceMap[p.plan] || 0) * p.count), 0);

      // Monthly revenue trend (from signups with paid plans)
      const monthlyTrend: Record<string, number> = {};
      for (const r of (monthlySignups.results ?? [])) {
        if (!monthlyTrend[r.month]) monthlyTrend[r.month] = 0;
        monthlyTrend[r.month] += (priceMap[r.plan] || 0);
      }

      // Point transactions summary
      const pointStats = await ctx.env.DB.prepare(
        `SELECT type, SUM(amount) as total, COUNT(*) as count FROM point_transactions GROUP BY type`
      ).all<any>();

      // Marketplace sales
      const marketplaceSales = (await ctx.env.DB.prepare(
        `SELECT COUNT(*) as count, SUM(pointsSpent) as total FROM persona_purchases`
      ).first<any>());

      // Daily active users for last 14 days
      const dailyActive = await ctx.env.DB.prepare(
        `SELECT date(lastSignedIn) as day, COUNT(*) as count FROM users
         WHERE isNpc=0 AND lastSignedIn >= date('now', '-14 days')
         GROUP BY day ORDER BY day`
      ).all<any>();

      return {
        planDistribution: planResults,
        totalUsers,
        activeUsers,
        churnRate,
        monthlyRevenue,
        monthlyTrend: Object.entries(monthlyTrend).map(([month, revenue]) => ({ month, revenue })),
        pointStats: pointStats.results ?? [],
        marketplaceSales: { count: marketplaceSales?.count ?? 0, totalPoints: marketplaceSales?.total ?? 0 },
        dailyActive: dailyActive.results ?? [],
      };
    }),
});

export const reportRouter = router({
    submit: protectedProcedure
      .input(z.object({
        targetType: z.enum(["twin", "chat_message", "persona_template", "user_profile"]),
        targetId: z.number(),
        reason: z.string().min(1),
        details: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(
          `INSERT INTO content_reports (reporterUserId, targetType, targetId, reason, details) VALUES (?,?,?,?,?)`
        ).bind(ctx.userId, input.targetType, input.targetId, input.reason, input.details || "").run();
        return { success: true };
      }),
});

export const marketplaceRouter = router({
    // List published & approved templates
    list: protectedProcedure
      .input(z.object({ category: z.string().optional(), search: z.string().optional(), sort: z.enum(["popular", "newest", "rating", "price"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        let sql = `SELECT pt.*, u.name as creatorName FROM persona_templates pt JOIN users u ON u.id = pt.creatorUserId WHERE pt.isPublished=1 AND pt.isApproved=1`;
        const binds: any[] = [];
        if (input?.category) { sql += ` AND pt.category=?`; binds.push(input.category); }
        if (input?.search) { sql += ` AND (pt.name LIKE ? OR pt.description LIKE ?)`; binds.push(`%${input.search}%`, `%${input.search}%`); }
        const sort = input?.sort || "popular";
        if (sort === "popular") sql += ` ORDER BY pt.purchaseCount DESC`;
        else if (sort === "newest") sql += ` ORDER BY pt.createdAt DESC`;
        else if (sort === "rating") sql += ` ORDER BY pt.rating DESC`;
        else if (sort === "price") sql += ` ORDER BY pt.price ASC`;
        sql += ` LIMIT 50`;
        const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<any>();
        return (rows.results ?? []).map((r: any) => ({
          id: r.id, name: r.name, description: r.description, category: r.category,
          price: r.price, currency: r.currency, previewBio: r.previewBio,
          rating: r.rating, ratingCount: r.ratingCount, purchaseCount: r.purchaseCount,
          creatorName: r.creatorName, creatorId: r.creatorUserId,
          tags: parseJson<string[]>(r.tags) ?? [],
          createdAt: r.createdAt,
        }));
      }),

    // Get template details
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const t = await ctx.env.DB.prepare(
          `SELECT pt.*, u.name as creatorName FROM persona_templates pt JOIN users u ON u.id = pt.creatorUserId WHERE pt.id=?`
        ).bind(input.id).first<any>();
        if (!t) throw new TRPCError({ code: "NOT_FOUND" });
        const purchased = await ctx.env.DB.prepare(`SELECT id FROM persona_purchases WHERE userId=? AND templateId=?`).bind(ctx.userId, input.id).first<any>();
        const reviews = await ctx.env.DB.prepare(`SELECT pr.*, u.name FROM persona_reviews pr JOIN users u ON u.id = pr.userId WHERE pr.templateId=? ORDER BY pr.createdAt DESC LIMIT 10`).bind(input.id).all<any>();
        return {
          ...t, tags: parseJson<string[]>(t.tags) ?? [], creatorName: t.creatorName,
          isPurchased: !!purchased,
          reviews: (reviews.results ?? []).map((r: any) => ({ id: r.id, rating: r.rating, comment: r.comment, userName: r.name, createdAt: r.createdAt })),
        };
      }),

    // Publish a template from your own twin
    publish: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().default("general"),
        price: z.number().min(0).default(0),
        previewBio: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND", message: "分身AIを作成してください" });
        const res = await ctx.env.DB.prepare(
          `INSERT INTO persona_templates (creatorUserId, name, description, personality, systemPrompt, tags, category, price, previewBio, isPublished, isApproved) VALUES (?,?,?,?,?,?,?,?,?,1,0)`
        ).bind(ctx.userId, input.name, input.description || twin.description || "", twin.personality || "", twin.systemPrompt || "", toJson(input.tags || []), input.category, input.price, input.previewBio || "").run();
        return { id: Number(res.meta.last_row_id), status: "pending_approval" };
      }),

    // Purchase a template
    purchase: protectedProcedure
      .input(z.object({ templateId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const template = await ctx.env.DB.prepare(`SELECT * FROM persona_templates WHERE id=? AND isPublished=1 AND isApproved=1`).bind(input.templateId).first<any>();
        if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "テンプレートが見つかりません" });
        const existing = await ctx.env.DB.prepare(`SELECT id FROM persona_purchases WHERE userId=? AND templateId=?`).bind(ctx.userId, input.templateId).first<any>();
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "既に購入済みです" });
        if (template.price > 0) {
          const points = await ctx.env.DB.prepare(`SELECT balance FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
          if (!points || points.balance < template.price) throw new TRPCError({ code: "FORBIDDEN", message: "ポイントが不足しています" });
          await ctx.env.DB.prepare(`UPDATE user_points SET balance=balance-?, totalSpent=totalSpent+?, updatedAt=datetime('now') WHERE userId=?`).bind(template.price, template.price, ctx.userId).run();
          await ctx.env.DB.prepare(`INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description) VALUES (?,?,?,?,?,?)`).bind(ctx.userId, "spend", -template.price, (points.balance - template.price), "marketplace_purchase", `テンプレート「${template.name}」を購入`).run();
        }
        await ctx.env.DB.prepare(`INSERT INTO persona_purchases (userId, templateId, pointsSpent) VALUES (?,?,?)`).bind(ctx.userId, input.templateId, template.price).run();
        await ctx.env.DB.prepare(`UPDATE persona_templates SET purchaseCount=purchaseCount+1 WHERE id=?`).bind(input.templateId).run();
        return { success: true };
      }),

    // Apply a purchased template to your twin
    applyTemplate: protectedProcedure
      .input(z.object({ templateId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const purchase = await ctx.env.DB.prepare(`SELECT id FROM persona_purchases WHERE userId=? AND templateId=?`).bind(ctx.userId, input.templateId).first<any>();
        if (!purchase) throw new TRPCError({ code: "FORBIDDEN", message: "テンプレートを購入してください" });
        const template = await ctx.env.DB.prepare(`SELECT * FROM persona_templates WHERE id=?`).bind(input.templateId).first<any>();
        if (!template) throw new TRPCError({ code: "NOT_FOUND" });
        const twin = await getMyTwin(ctx.env.DB, ctx.userId);
        if (!twin) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.env.DB.prepare(
          `UPDATE digital_twins SET personality=?, systemPrompt=?, description=?, tags=?, updatedAt=datetime('now') WHERE id=?`
        ).bind(template.personality, template.systemPrompt, template.description, template.tags, twin.id).run();
        await ctx.env.DB.prepare(`UPDATE persona_purchases SET appliedAt=datetime('now') WHERE userId=? AND templateId=?`).bind(ctx.userId, input.templateId).run();
        return { success: true };
      }),

    // Review a purchased template
    review: protectedProcedure
      .input(z.object({ templateId: z.number(), rating: z.number().min(1).max(5), comment: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const purchase = await ctx.env.DB.prepare(`SELECT id FROM persona_purchases WHERE userId=? AND templateId=?`).bind(ctx.userId, input.templateId).first<any>();
        if (!purchase) throw new TRPCError({ code: "FORBIDDEN", message: "購入済みテンプレートのみレビューできます" });
        await ctx.env.DB.prepare(
          `INSERT OR REPLACE INTO persona_reviews (templateId, userId, rating, comment) VALUES (?,?,?,?)`
        ).bind(input.templateId, ctx.userId, input.rating, input.comment || "").run();
        const avg = await ctx.env.DB.prepare(`SELECT AVG(rating) as a, COUNT(*) as c FROM persona_reviews WHERE templateId=?`).bind(input.templateId).first<any>();
        await ctx.env.DB.prepare(`UPDATE persona_templates SET rating=?, ratingCount=? WHERE id=?`).bind(Math.round((avg?.a ?? 0) * 10) / 10, avg?.c ?? 0, input.templateId).run();
        return { success: true };
      }),

    // My published templates
    myTemplates: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM persona_templates WHERE creatorUserId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
      return (rows.results ?? []).map((r: any) => ({ ...r, tags: parseJson<string[]>(r.tags) ?? [] }));
    }),

    // My purchases
    myPurchases: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(
        `SELECT pp.*, pt.name, pt.description, pt.category, pt.tags, pt.price FROM persona_purchases pp JOIN persona_templates pt ON pt.id = pp.templateId WHERE pp.userId=? ORDER BY pp.createdAt DESC`
      ).bind(ctx.userId).all<any>();
      return (rows.results ?? []).map((r: any) => ({ ...r, tags: parseJson<string[]>(r.tags) ?? [] }));
    }),

    // Admin: approve/reject template
    moderate: protectedProcedure
      .input(z.object({ templateId: z.number(), approved: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE persona_templates SET isApproved=? WHERE id=?`).bind(input.approved ? 1 : 0, input.templateId).run();
        return { success: true };
      }),

    // Admin: list pending templates
    pendingTemplates: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT pt.*, u.name as creatorName FROM persona_templates pt JOIN users u ON u.id = pt.creatorUserId WHERE pt.isApproved=0 AND pt.isPublished=1 ORDER BY pt.createdAt DESC`).all<any>();
      return (rows.results ?? []).map((r: any) => ({ ...r, tags: parseJson<string[]>(r.tags) ?? [] }));
    }),
});

export const notificationRouter = router({
    // --- Notification settings (merged from notificationsRouter) ---
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const row = await ctx.env.DB.prepare(`SELECT * FROM notification_settings WHERE userId=?`).bind(ctx.userId).first<any>();
      return row || { slackWebhookUrl: null, lineNotify: 1, emailNotify: 0, matchingComplete: 1, scheduledMatching: 1 };
    }),
    updateSettings: protectedProcedure
      .input(z.object({
        slackWebhookUrl: z.string().nullable().optional(),
        lineNotify: z.number().min(0).max(1).optional(),
        emailNotify: z.number().min(0).max(1).optional(),
        matchingComplete: z.number().min(0).max(1).optional(),
        scheduledMatching: z.number().min(0).max(1).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const existing = await ctx.env.DB.prepare(`SELECT id FROM notification_settings WHERE userId=?`).bind(ctx.userId).first<any>();
        if (existing) {
          const sets: string[] = ["updatedAt=datetime('now')"];
          const vals: any[] = [];
          if (input.slackWebhookUrl !== undefined) { sets.push("slackWebhookUrl=?"); vals.push(input.slackWebhookUrl); }
          if (input.lineNotify !== undefined) { sets.push("lineNotify=?"); vals.push(input.lineNotify); }
          if (input.emailNotify !== undefined) { sets.push("emailNotify=?"); vals.push(input.emailNotify); }
          if (input.matchingComplete !== undefined) { sets.push("matchingComplete=?"); vals.push(input.matchingComplete); }
          if (input.scheduledMatching !== undefined) { sets.push("scheduledMatching=?"); vals.push(input.scheduledMatching); }
          vals.push(existing.id);
          await ctx.env.DB.prepare(`UPDATE notification_settings SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO notification_settings (userId, slackWebhookUrl, lineNotify, emailNotify, matchingComplete, scheduledMatching) VALUES (?,?,?,?,?,?)`
          ).bind(ctx.userId, input.slackWebhookUrl ?? null, input.lineNotify ?? 1, input.emailNotify ?? 0, input.matchingComplete ?? 1, input.scheduledMatching ?? 1).run();
        }
        return { success: true };
      }),
    // --- Notification inbox ---
    list: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).optional(),
        cursor: z.number().optional(),
        unreadOnly: z.boolean().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const limit = input?.limit ?? 20;
        const cursor = input?.cursor;
        const unreadFilter = input?.unreadOnly ? `AND isRead=0` : '';
        const cursorFilter = cursor ? `AND id < ?` : '';

        const sql = `SELECT * FROM notifications WHERE userId=? ${unreadFilter} ${cursorFilter} ORDER BY id DESC LIMIT ?`;
        const binds: any[] = [ctx.userId];
        if (cursor) binds.push(cursor);
        binds.push(limit + 1);

        const rows = await ctx.env.DB.prepare(sql).bind(...binds).all<any>();
        const results = rows.results ?? [];
        const hasMore = results.length > limit;
        const items = hasMore ? results.slice(0, limit) : results;
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : undefined;

        const unreadCount = (await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM notifications WHERE userId=? AND isRead=0`
        ).bind(ctx.userId).first<any>())?.c ?? 0;

        return { notifications: items, unreadCount, nextCursor, hasMore };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(
          `DELETE FROM notifications WHERE id=? AND userId=?`
        ).bind(input.id, ctx.userId).run();
        return { success: true };
      }),
    deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(
        `DELETE FROM notifications WHERE userId=? AND isRead=1`
      ).bind(ctx.userId).run();
      return { success: true };
    }),
    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(`UPDATE notifications SET isRead=1 WHERE id=? AND userId=?`).bind(input.id, ctx.userId).run();
        return { success: true };
      }),
    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      await ctx.env.DB.prepare(`UPDATE notifications SET isRead=1 WHERE userId=? AND isRead=0`).bind(ctx.userId).run();
      return { success: true };
    }),
    // --- WebPush subscriptions ---
    getVapidPublicKey: protectedProcedure.query(async ({ ctx }) => {
      const key = ctx.env.VAPID_PUBLIC_KEY || "";
      return { vapidPublicKey: key };
    }),
    subscribePush: protectedProcedure
      .input(z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        // Upsert — unique on endpoint
        await ctx.env.DB.prepare(
          `INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth) VALUES (?,?,?,?)
           ON CONFLICT(endpoint) DO UPDATE SET userId=?, p256dh=?, auth=?, createdAt=datetime('now')`
        ).bind(ctx.userId, input.endpoint, input.p256dh, input.auth, ctx.userId, input.p256dh, input.auth).run();
        return { success: true };
      }),
    unsubscribePush: protectedProcedure
      .input(z.object({ endpoint: z.string().url() }))
      .mutation(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        await ctx.env.DB.prepare(
          `DELETE FROM push_subscriptions WHERE userId=? AND endpoint=?`
        ).bind(ctx.userId, input.endpoint).run();
        return { success: true };
      }),

    // Notification history with type filter
    history: protectedProcedure
      .input(z.object({
        type: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        let sql = `SELECT * FROM notifications WHERE userId=?`;
        const params: any[] = [ctx.userId];
        if (input.type) { sql += ` AND type=?`; params.push(input.type); }
        sql += ` ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
        params.push(input.limit, input.offset);
        const rows = await ctx.env.DB.prepare(sql).bind(...params).all<any>();
        // Count by type
        const typeCounts = await ctx.env.DB.prepare(
          `SELECT type, COUNT(*) as count FROM notifications WHERE userId=? GROUP BY type`
        ).bind(ctx.userId).all<any>();
        const unreadCount = await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM notifications WHERE userId=? AND isRead=0`
        ).bind(ctx.userId).first<any>();
        return {
          items: (rows.results ?? []).map((r: any) => ({ ...r, data: parseJson<any>(r.data) })),
          typeCounts: typeCounts.results ?? [],
          unreadCount: unreadCount?.c ?? 0,
        };
      }),

    // Get notification channel status summary
    channelStatus: protectedProcedure.query(async ({ ctx }) => {
      await ensureSchema(ctx.env.DB);
      const db = ctx.env.DB;
      const settings = await db.prepare(`SELECT * FROM notification_settings WHERE userId=?`).bind(ctx.userId).first<any>();
      const pushSub = await db.prepare(`SELECT COUNT(*) as c FROM push_subscriptions WHERE userId=?`).bind(ctx.userId).first<any>();
      const lineConn = await db.prepare(`SELECT status FROM line_connections WHERE userId=? AND status='active'`).bind(ctx.userId).first<any>();
      return {
        inApp: true,
        slack: !!settings?.slackWebhookUrl,
        line: !!lineConn,
        webPush: (pushSub?.c ?? 0) > 0,
        email: !!(settings?.emailNotify),
        settings: settings || { slackWebhookUrl: null, lineNotify: 1, emailNotify: 0, matchingComplete: 1, scheduledMatching: 1 },
      };
    }),

  // --- Per-type notification preferences ---
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(
      `SELECT notificationType, enabled, frequency FROM notification_preferences WHERE userId=?`
    ).bind(ctx.userId).all<any>();
    const prefs: Record<string, { enabled: boolean; frequency: string }> = {};
    for (const r of rows.results ?? []) {
      prefs[r.notificationType] = { enabled: !!r.enabled, frequency: r.frequency };
    }
    // Return all known types with defaults for missing ones
    const ALL_TYPES = [
      { key: "matching_complete", label: "マッチング完了", description: "マッチング対話完了時の通知" },
      { key: "matching_invite", label: "マッチング招待", description: "マッチング対話への招待通知" },
      { key: "matching_request", label: "マッチングリクエスト", description: "マッチングリクエスト受信通知" },
      { key: "matching_accepted", label: "マッチング承認", description: "マッチングリクエスト承認通知" },
      { key: "matching_summary", label: "マッチングサマリー", description: "マッチング分析サマリー通知" },
      { key: "friend_request", label: "友達リクエスト", description: "友達リクエスト受信通知" },
      { key: "friend_accepted", label: "友達承認", description: "友達リクエスト承認通知" },
      { key: "quality_alert", label: "品質アラート", description: "対話品質に関するアラート" },
      { key: "weekly_review", label: "ウィークリーレビュー", description: "週次レビュー・振り返り通知" },
      { key: "twin_forked", label: "ツインフォーク", description: "ツインがフォークされた通知" },
      { key: "fork_feedback", label: "フォークフィードバック", description: "フォークへのフィードバック通知" },
    ];
    return ALL_TYPES.map(t => ({
      ...t,
      enabled: prefs[t.key]?.enabled ?? true,
      frequency: prefs[t.key]?.frequency ?? "immediate",
    }));
  }),

  updatePreference: protectedProcedure
    .input(z.object({
      notificationType: z.string().min(1),
      enabled: z.boolean().optional(),
      frequency: z.enum(["immediate", "daily", "weekly"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const existing = await ctx.env.DB.prepare(
        `SELECT id, enabled, frequency FROM notification_preferences WHERE userId=? AND notificationType=?`
      ).bind(ctx.userId, input.notificationType).first<any>();
      if (existing) {
        const sets: string[] = ["updatedAt=datetime('now')"];
        const vals: any[] = [];
        if (input.enabled !== undefined) { sets.push("enabled=?"); vals.push(input.enabled ? 1 : 0); }
        if (input.frequency !== undefined) { sets.push("frequency=?"); vals.push(input.frequency); }
        vals.push(existing.id);
        await ctx.env.DB.prepare(`UPDATE notification_preferences SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
      } else {
        await ctx.env.DB.prepare(
          `INSERT INTO notification_preferences (userId, notificationType, enabled, frequency) VALUES (?,?,?,?)`
        ).bind(ctx.userId, input.notificationType, input.enabled !== undefined ? (input.enabled ? 1 : 0) : 1, input.frequency ?? "immediate").run();
      }
      return { success: true };
    }),
});
