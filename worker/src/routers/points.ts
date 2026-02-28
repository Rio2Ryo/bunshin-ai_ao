import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { ensureSchema, toJson, now } from "../db-helpers";

export const pointsRouter = router({
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const row = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
    return row ?? { balance: 0, totalEarned: 0, totalSpent: 0, totalExpired: 0 };
  }),
  getTransactions: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const rows = await ctx.env.DB.prepare(`SELECT * FROM point_transactions WHERE userId=? ORDER BY createdAt DESC LIMIT ?`).bind(ctx.userId, input?.limit ?? 50).all<any>();
      return rows.results ?? [];
    }),
  getProducts: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`SELECT * FROM redeemable_products WHERE isActive=1 ORDER BY sortOrder`).all<any>();
    return rows.results ?? [];
  }),
  redeem: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const product = await ctx.env.DB.prepare(
        `SELECT * FROM redeemable_products WHERE id=? AND isActive=1`
      ).bind(input.productId).first<any>();
      if (!product) return { success: false, message: "商品が見つかりません" };

      const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!pts || pts.balance < product.pointsCost) {
        return { success: false, message: "ポイントが不足しています" };
      }

      const newBalance = pts.balance - product.pointsCost;
      const newTotalSpent = (pts.totalSpent || 0) + product.pointsCost;
      await ctx.env.DB.prepare(
        `UPDATE user_points SET balance=?, totalSpent=?, lastActivityAt=?, updatedAt=? WHERE userId=?`
      ).bind(newBalance, newTotalSpent, now(), now(), ctx.userId).run();

      await ctx.env.DB.prepare(
        `INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`
      ).bind(ctx.userId, "spend", -product.pointsCost, newBalance, "redeem", product.name, now()).run();

      await ctx.env.DB.prepare(
        `INSERT INTO point_redemptions (userId, productId, pointsUsed, status, createdAt) VALUES (?,?,?,?,?)`
      ).bind(ctx.userId, product.id, product.pointsCost, "pending", now()).run();

      return { success: true, message: `${product.name} を交換しました` };
    }),
  getRedemptions: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`SELECT * FROM point_redemptions WHERE userId=? ORDER BY createdAt DESC`).bind(ctx.userId).all<any>();
    return rows.results ?? [];
  }),
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const rows = await ctx.env.DB.prepare(`SELECT * FROM point_settings ORDER BY category, actionType`).all<any>();
    return rows.results ?? [];
  }),
  updateSetting: protectedProcedure
    .input(z.object({ actionType: z.string(), points: z.number().optional(), isActive: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      // Admin-only: update point settings
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者権限が必要です" });
      const existing = await ctx.env.DB.prepare(`SELECT id FROM point_settings WHERE actionType=?`).bind(input.actionType).first<any>();
      if (existing) {
        const sets: string[] = ["updatedAt=datetime('now')"];
        const vals: any[] = [];
        if (input.points !== undefined) { sets.push("points=?"); vals.push(input.points); }
        if (input.isActive !== undefined) { sets.push("isActive=?"); vals.push(input.isActive); }
        vals.push(existing.id);
        await ctx.env.DB.prepare(`UPDATE point_settings SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
      }
      return { success: true };
    }),
  redeemProduct: protectedProcedure
    .input(z.object({ productId: z.number(), shippingInfo: z.record(z.string(), z.unknown()).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      const product = await ctx.env.DB.prepare(
        `SELECT * FROM redeemable_products WHERE id=? AND isActive=1`
      ).bind(input.productId).first<any>();
      if (!product) return { success: false, message: "商品が見つかりません" };

      if (product.stock !== null && product.stock <= 0) {
        return { success: false, message: "在庫切れです" };
      }

      const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      if (!pts || pts.balance < product.pointsCost) {
        return { success: false, message: "ポイントが不足しています" };
      }

      const newBalance = pts.balance - product.pointsCost;
      const newTotalSpent = (pts.totalSpent || 0) + product.pointsCost;
      await ctx.env.DB.prepare(
        `UPDATE user_points SET balance=?, totalSpent=?, lastActivityAt=?, updatedAt=? WHERE userId=?`
      ).bind(newBalance, newTotalSpent, now(), now(), ctx.userId).run();

      await ctx.env.DB.prepare(
        `INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`
      ).bind(ctx.userId, "spend", -product.pointsCost, newBalance, "redeem", product.name, now()).run();

      await ctx.env.DB.prepare(
        `INSERT INTO point_redemptions (userId, productId, pointsUsed, status, shippingInfo, createdAt) VALUES (?,?,?,?,?,?)`
      ).bind(ctx.userId, product.id, product.pointsCost, "pending", input.shippingInfo ? toJson(input.shippingInfo) : null, now()).run();

      // Decrement stock if tracked
      if (product.stock !== null) {
        await ctx.env.DB.prepare(
          `UPDATE redeemable_products SET stock = stock - 1, updatedAt=? WHERE id=?`
        ).bind(now(), product.id).run();
      }

      return { success: true, message: `${product.name} を交換しました` };
    }),
  getQuests: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
    const growth = await ctx.env.DB.prepare(`SELECT * FROM twin_growth_status WHERE userId=?`).bind(ctx.userId).first<any>();
    const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    const profile = await ctx.env.DB.prepare(`SELECT * FROM user_profiles WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    const todayTx = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM point_transactions WHERE userId=? AND createdAt LIKE ?`).bind(ctx.userId, `${now().slice(0, 10)}%`).first<any>();
    const totalTx = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM point_transactions WHERE userId=? AND type='earn'`).bind(ctx.userId).first<any>();

    const hasTwin = !!twin;
    const hasProfile = !!(profile?.bigFiveScores);
    const hasMbti = !!(profile?.mbtiType);
    const hasFriends = !!(await ctx.env.DB.prepare(`SELECT id FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted' LIMIT 1`).bind(ctx.userId, ctx.userId).first<any>());
    const hasMatching = !!(await ctx.env.DB.prepare(`SELECT id FROM matching_sessions WHERE (twin1Id IN (SELECT id FROM digital_twins WHERE userId=?)) LIMIT 1`).bind(ctx.userId).first<any>());
    const dailyLogin = !!(await ctx.env.DB.prepare(`SELECT id FROM point_transactions WHERE userId=? AND actionType='daily_login' AND createdAt LIKE ?`).bind(ctx.userId, `${now().slice(0, 10)}%`).first<any>());

    const quests = [
      { id: "create_twin", name: "分身AI作成", description: "分身AIを作成する", points: 50, category: "基本", completed: hasTwin },
      { id: "big_five", name: "ビッグファイブ診断", description: "性格診断を完了する", points: 100, category: "基本", completed: hasProfile },
      { id: "mbti", name: "MBTI診断", description: "MBTI診断を完了する", points: 100, category: "基本", completed: hasMbti },
      { id: "add_friend", name: "友達を追加", description: "最初の友達を追加する", points: 50, category: "つながる", completed: hasFriends },
      { id: "first_matching", name: "初マッチング", description: "マッチングを1回実行する", points: 100, category: "つながる", completed: hasMatching },
      { id: "daily_login", name: "デイリーログイン", description: "今日ログインする", points: 10, category: "デイリー", completed: dailyLogin },
    ];

    const categories = ["基本", "つながる", "デイリー"].map(cat => ({
      name: cat,
      quests: quests.filter(q => q.category === cat),
    }));

    return {
      stats: {
        completedToday: todayTx?.c || 0,
        totalCompleted: quests.filter(q => q.completed).length,
        currentStreak: growth?.consecutiveLoginDays || 0,
        totalPoints: pts?.totalEarned || 0,
      },
      categories,
    };
  }),
  checkDailyLogin: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const today = now().slice(0, 10); // YYYY-MM-DD

    // Check if already awarded today
    const existing = await ctx.env.DB.prepare(
      `SELECT id FROM point_transactions WHERE userId=? AND actionType='daily_login' AND createdAt LIKE ?`
    ).bind(ctx.userId, `${today}%`).first<any>();

    if (existing) {
      const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
      return { points: 0, isFirstLogin: false, awarded: false, streak: 0, streakBonus: null as { name: string; points: number } | null };
    }

    // Calculate streak from twin_growth_status
    let streak = 1;
    const growth = await ctx.env.DB.prepare(
      `SELECT consecutiveLoginDays, lastLoginDate FROM twin_growth_status WHERE userId=?`
    ).bind(ctx.userId).first<any>();
    if (growth) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (growth.lastLoginDate && growth.lastLoginDate.slice(0, 10) === yesterday) {
        streak = (growth.consecutiveLoginDays || 0) + 1;
      }
      await ctx.env.DB.prepare(
        `UPDATE twin_growth_status SET consecutiveLoginDays=?, lastLoginDate=?, updatedAt=? WHERE userId=?`
      ).bind(streak, today, now(), ctx.userId).run();
    }

    // Bonus points for streaks
    const basePoints = 10;
    let streakBonus: { name: string; points: number } | null = null;
    let totalPoints = basePoints;
    if (streak >= 30) {
      streakBonus = { name: "30日連続ログイン", points: 50 };
      totalPoints += 50;
    } else if (streak >= 7) {
      streakBonus = { name: "7日連続ログイン", points: 20 };
      totalPoints += 20;
    }

    // Upsert user_points
    const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
    const newBalance = (pts?.balance || 0) + totalPoints;
    const newTotalEarned = (pts?.totalEarned || 0) + totalPoints;
    if (pts) {
      await ctx.env.DB.prepare(
        `UPDATE user_points SET balance=?, totalEarned=?, lastActivityAt=?, updatedAt=? WHERE userId=?`
      ).bind(newBalance, newTotalEarned, now(), now(), ctx.userId).run();
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired, lastActivityAt) VALUES (?,?,?,0,0,?)`
      ).bind(ctx.userId, newBalance, newTotalEarned, now()).run();
    }

    // Record transaction
    await ctx.env.DB.prepare(
      `INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`
    ).bind(ctx.userId, "earn", totalPoints, newBalance, "daily_login", "デイリーログインボーナス", now()).run();

    return { points: totalPoints, isFirstLogin: true, awarded: true, streak, streakBonus };
  }),
  checkMilestones: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const existingMilestones = await ctx.env.DB.prepare(`SELECT * FROM twin_milestones WHERE userId=?`).bind(ctx.userId).all<any>();
    const existingIds = new Set((existingMilestones.results ?? []).map((m: any) => m.milestoneId));

    const twin = await ctx.env.DB.prepare(`SELECT * FROM digital_twins WHERE userId=? LIMIT 1`).bind(ctx.userId).first<any>();
    const growth = await ctx.env.DB.prepare(`SELECT * FROM twin_growth_status WHERE userId=?`).bind(ctx.userId).first<any>();
    const friendCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`).bind(ctx.userId, ctx.userId).first<any>())?.c || 0;
    const matchCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM matching_sessions WHERE twin1Id IN (SELECT id FROM digital_twins WHERE userId=?)`).bind(ctx.userId).first<any>())?.c || 0;
    const chatCount = (await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM chat_messages WHERE sessionId IN (SELECT id FROM chat_sessions WHERE userId=?)`).bind(ctx.userId).first<any>())?.c || 0;
    const level = growth?.level || 1;
    const loginDays = growth?.consecutiveLoginDays || 0;

    const milestoneDefinitions = [
      { id: "first_twin", name: "分身AI誕生", description: "初めての分身AIを作成", points: 50, condition: !!twin },
      { id: "first_friend", name: "最初の友達", description: "友達を1人追加", points: 30, condition: friendCount >= 1 },
      { id: "first_matching", name: "初マッチング", description: "マッチングを1回実行", points: 50, condition: matchCount >= 1 },
      { id: "chat_10", name: "会話の達人", description: "10回以上チャット", points: 30, condition: chatCount >= 10 },
      { id: "chat_100", name: "おしゃべり王", description: "100回以上チャット", points: 100, condition: chatCount >= 100 },
      { id: "level_5", name: "成長中", description: "レベル5に到達", points: 50, condition: level >= 5 },
      { id: "level_10", name: "ベテラン", description: "レベル10に到達", points: 100, condition: level >= 10 },
      { id: "login_7", name: "7日連続ログイン", description: "7日連続でログイン", points: 50, condition: loginDays >= 7 },
      { id: "login_30", name: "30日連続ログイン", description: "30日連続でログイン", points: 200, condition: loginDays >= 30 },
      { id: "friends_5", name: "社交的", description: "友達を5人追加", points: 50, condition: friendCount >= 5 },
      { id: "matching_5", name: "マッチング上手", description: "マッチングを5回実行", points: 100, condition: matchCount >= 5 },
    ];

    const newMilestones: any[] = [];
    const awarded: { name: string; points: number }[] = [];
    for (const def of milestoneDefinitions) {
      if (def.condition && !existingIds.has(def.id)) {
        await ctx.env.DB.prepare(
          `INSERT INTO twin_milestones (twinId, userId, milestoneId, name, description, achievedAt) VALUES (?,?,?,?,?,datetime('now'))`
        ).bind(twin?.id ?? 0, ctx.userId, def.id, def.name, def.description).run();
        newMilestones.push({ milestoneId: def.id, name: def.name, description: def.description, points: def.points });
        awarded.push({ name: def.name, points: def.points });

        // Award points
        const pts = await ctx.env.DB.prepare(`SELECT * FROM user_points WHERE userId=?`).bind(ctx.userId).first<any>();
        const newBalance = (pts?.balance || 0) + def.points;
        if (pts) {
          await ctx.env.DB.prepare(`UPDATE user_points SET balance=?, totalEarned=totalEarned+?, updatedAt=? WHERE userId=?`).bind(newBalance, def.points, now(), ctx.userId).run();
        } else {
          await ctx.env.DB.prepare(`INSERT INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired) VALUES (?,?,?,0,0)`).bind(ctx.userId, def.points, def.points).run();
        }
        await ctx.env.DB.prepare(`INSERT INTO point_transactions (userId, type, amount, balanceAfter, actionType, description, createdAt) VALUES (?,?,?,?,?,?,?)`).bind(ctx.userId, "earn", def.points, newBalance, "milestone", def.name, now()).run();
      }
    }

    const allMilestones = milestoneDefinitions.map(def => ({
      ...def,
      achieved: def.condition || existingIds.has(def.id),
    }));

    return { milestones: allMilestones, newMilestones, awarded };
  }),
});
