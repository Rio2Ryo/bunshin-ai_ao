import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, parseJson, toJson, getMyTwin } from "../db-helpers";

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
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional(), unreadOnly: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await ensureSchema(ctx.env.DB);
        const limit = input?.limit ?? 50;
        const where = input?.unreadOnly ? `AND isRead=0` : '';
        const rows = await ctx.env.DB.prepare(
          `SELECT * FROM notifications WHERE userId=? ${where} ORDER BY createdAt DESC LIMIT ?`
        ).bind(ctx.userId, limit).all<any>();
        const unreadCount = (await ctx.env.DB.prepare(
          `SELECT COUNT(*) as c FROM notifications WHERE userId=? AND isRead=0`
        ).bind(ctx.userId).first<any>())?.c ?? 0;
        return { notifications: rows.results ?? [], unreadCount };
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
});
