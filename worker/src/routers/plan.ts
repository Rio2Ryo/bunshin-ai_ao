import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, generateCode } from "../trpc";
import { ensureSchema } from "../db-helpers";
import { cachedQuery, invalidateCache } from "../cache";

export const planRouter = router({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    return { plan: user?.plan ?? "free" };
  }),
  getRateLimits: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    const plan = user?.plan || "free";
    const limits: Record<string, { requestsPerMin: number; matchingsPerMonth: number; maxFriends: number; chatMessagesPerDay: number }> = {
      free: { requestsPerMin: 60, matchingsPerMonth: 3, maxFriends: 5, chatMessagesPerDay: 50 },
      premium: { requestsPerMin: 120, matchingsPerMonth: 30, maxFriends: 50, chatMessagesPerDay: 500 },
      enterprise: { requestsPerMin: 600, matchingsPerMonth: -1, maxFriends: -1, chatMessagesPerDay: -1 },
    };

    // Query current usage
    const friends = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`
    ).bind(ctx.userId, ctx.userId).first<any>();

    const chatToday = await ctx.env.DB.prepare(
      `SELECT COUNT(*) as c FROM chat_messages WHERE role='user' AND sessionId IN (SELECT id FROM chat_sessions WHERE userId=?) AND createdAt >= date('now')`
    ).bind(ctx.userId).first<any>();

    const usageRow = await ctx.env.DB.prepare(
      `SELECT matchingsThisMonth FROM usage_tracking WHERE userId=?`
    ).bind(ctx.userId).first<any>();

    const usage = {
      friends: friends?.c ?? 0,
      chatMessagesToday: chatToday?.c ?? 0,
      matchingsThisMonth: usageRow?.matchingsThisMonth ?? 0,
    };

    return { plan, limits: limits[plan] || limits.free, usage };
  }),
  getInfo: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    const plan = user?.plan || "free";
    const PLAN_LIMITS: Record<string, { maxFriends: number; maxMatchingsPerMonth: number }> = {
      free: { maxFriends: 5, maxMatchingsPerMonth: 3 },
      premium: { maxFriends: 50, maxMatchingsPerMonth: 30 },
      enterprise: { maxFriends: -1, maxMatchingsPerMonth: -1 },
    };
    return { plan, limits: PLAN_LIMITS[plan] || PLAN_LIMITS.free };
  }),
  getStats: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const user = await ctx.env.DB.prepare(`SELECT plan FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    const plan = user?.plan || "free";
    const friends = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM friendships WHERE (userId=? OR friendId=?) AND status='accepted'`).bind(ctx.userId, ctx.userId).first<any>();
    const usage = await ctx.env.DB.prepare(`SELECT matchingsThisMonth FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
    const knowledge = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM knowledge_base WHERE twinId IN (SELECT id FROM digital_twins WHERE userId=?)`).bind(ctx.userId).first<any>();
    const files = await ctx.env.DB.prepare(`SELECT COUNT(*) as c FROM uploaded_files WHERE userId=?`).bind(ctx.userId).first<any>();

    const PLAN_LIMITS: Record<string, { maxFriends: number; maxMatchingsPerMonth: number; maxKnowledgeEntries: number; maxFileUploads: number }> = {
      free: { maxFriends: 5, maxMatchingsPerMonth: 3, maxKnowledgeEntries: 50, maxFileUploads: 10 },
      premium: { maxFriends: 50, maxMatchingsPerMonth: 30, maxKnowledgeEntries: 500, maxFileUploads: 100 },
      enterprise: { maxFriends: -1, maxMatchingsPerMonth: -1, maxKnowledgeEntries: -1, maxFileUploads: -1 },
    };
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    return {
      plan,
      usage: {
        friends: friends?.c ?? 0,
        matchingsThisMonth: usage?.matchingsThisMonth ?? 0,
        knowledgeEntries: knowledge?.c ?? 0,
        fileUploads: files?.c ?? 0,
      },
      limits,
    };
  }),
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    if (!ctx.env.STRIPE_SECRET_KEY) return null;
    const user = await ctx.env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.stripeCustomerId) return null;

    return cachedQuery(`plan:subscription:${ctx.userId}`, 300, async () => {
      try {
        const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${user.stripeCustomerId}&status=active&limit=1`, {
          headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` },
        });
        const data = await res.json() as any;
        const sub = data.data?.[0];
        if (!sub) return null;
        return {
          cancelAtPeriodEnd: sub.cancel_at_period_end as boolean,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        };
      } catch {
        return null;
      }
    });
  }),
  createCheckoutSession: protectedProcedure
    .input(z.object({ planId: z.string().optional(), plan: z.string().optional(), billingCycle: z.string().optional(), interval: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureSchema(ctx.env.DB);
      if (!ctx.env.STRIPE_SECRET_KEY) {
        return { url: undefined as string | undefined, message: "Stripe APIキーが設定されていません。管理者にお問い合わせください。" };
      }

      const user = await ctx.env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();

      // Create or reuse Stripe customer
      let customerId = user?.stripeCustomerId;
      if (!customerId) {
        const custRes = await fetch("https://api.stripe.com/v1/customers", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `email=${encodeURIComponent(user?.email || "")}&metadata[userId]=${ctx.userId}`,
        });
        const custData = await custRes.json() as any;
        if (!custData.id) return { url: undefined, message: "Stripe顧客作成に失敗しました" };
        customerId = custData.id;
        await ctx.env.DB.prepare(`UPDATE users SET stripeCustomerId=? WHERE id=?`).bind(customerId, ctx.userId).run();
      }

      // Determine price lookup
      const planName = input.plan || input.planId || "premium";
      const interval = input.billingCycle || input.interval || "monthly";
      const priceMap: Record<string, Record<string, number>> = {
        premium: { monthly: 1480, yearly: 14800 },
        enterprise: { monthly: 4980, yearly: 49800 },
      };
      const amount = priceMap[planName]?.[interval === "yearly" ? "yearly" : "monthly"] || 1480;
      const recurring = interval === "yearly" ? "year" : "month";

      // Create Checkout Session with inline price
      const body = new URLSearchParams({
        "mode": "subscription",
        "customer": customerId,
        "success_url": "https://bunshin-ai.pages.dev/plan?session_id={CHECKOUT_SESSION_ID}&status=success",
        "cancel_url": "https://bunshin-ai.pages.dev/plan?status=cancelled",
        "line_items[0][price_data][currency]": "jpy",
        "line_items[0][price_data][product_data][name]": `分身AI ${planName === "enterprise" ? "エンタープライズ" : "プロ"}プラン`,
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][price_data][recurring][interval]": recurring,
        "line_items[0][quantity]": "1",
        "metadata[userId]": String(ctx.userId),
        "metadata[plan]": planName,
      });

      const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      const sessionData = await sessionRes.json() as any;

      if (sessionData.url) {
        return { url: sessionData.url as string, message: undefined };
      }
      return { url: undefined, message: sessionData.error?.message || "Checkoutセッション作成に失敗しました" };
    }),
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    if (!ctx.env.STRIPE_SECRET_KEY) return { url: undefined as string | undefined };

    const user = await ctx.env.DB.prepare(`SELECT stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.stripeCustomerId) return { url: undefined };

    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${user.stripeCustomerId}&return_url=https://bunshin-ai.pages.dev/plan`,
    });
    const data = await res.json() as any;
    return { url: data.url as string | undefined };
  }),
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    if (!ctx.env.STRIPE_SECRET_KEY) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Stripe未設定" });
    const user = await ctx.env.DB.prepare(`SELECT stripeSubscriptionId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.stripeSubscriptionId) throw new TRPCError({ code: "NOT_FOUND", message: "アクティブなサブスクリプションがありません" });

    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${user.stripeSubscriptionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "cancel_at_period_end=true",
    });
    const data = await res.json() as any;
    if (data.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: data.error.message });
    await invalidateCache(`plan:subscription:${ctx.userId}`);
    return { success: true, cancelAt: new Date(data.current_period_end * 1000).toISOString() };
  }),
  getFriendCode: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    let user = await ctx.env.DB.prepare(`SELECT friendCode FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.friendCode) {
      const code = generateCode(8);
      await ctx.env.DB.prepare(`UPDATE users SET friendCode=? WHERE id=?`).bind(code, ctx.userId).run();
      user = { friendCode: code };
    }
    return { friendCode: user.friendCode };
  }),
  getUsage: protectedProcedure.query(async ({ ctx }) => {
    await ensureSchema(ctx.env.DB);
    const usage = await ctx.env.DB.prepare(`SELECT * FROM usage_tracking WHERE userId=?`).bind(ctx.userId).first<any>();
    return usage ?? { matchingsThisMonth: 0 };
  }),
});

export const stripeRouter = router({
  createCheckoutSession: protectedProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Delegates to the plan.createCheckoutSession logic
      if (!ctx.env.STRIPE_SECRET_KEY) {
        return { url: undefined as string | undefined, message: "Stripe APIキーが設定されていません" };
      }
      await ensureSchema(ctx.env.DB);
      const user = await ctx.env.DB.prepare(`SELECT email, stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
      let customerId = user?.stripeCustomerId;
      if (!customerId) {
        const custRes = await fetch("https://api.stripe.com/v1/customers", {
          method: "POST",
          headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: `email=${encodeURIComponent(user?.email || "")}&metadata[userId]=${ctx.userId}`,
        });
        const custData = await custRes.json() as any;
        if (!custData.id) return { url: undefined, message: "Stripe顧客作成に失敗しました" };
        customerId = custData.id;
        await ctx.env.DB.prepare(`UPDATE users SET stripeCustomerId=? WHERE id=?`).bind(customerId, ctx.userId).run();
      }

      const stripePriceMap: Record<string, { name: string; amount: number }> = {
        premium: { name: "分身AI プロプラン", amount: 1480 },
        enterprise: { name: "分身AI エンタープライズプラン", amount: 4980 },
      };
      const planInfo = stripePriceMap[input.planId] || stripePriceMap.premium;

      const body = new URLSearchParams({
        mode: "subscription",
        customer: customerId,
        "success_url": "https://bunshin-ai.pages.dev/plan?status=success",
        "cancel_url": "https://bunshin-ai.pages.dev/plan?status=cancelled",
        "line_items[0][price_data][currency]": "jpy",
        "line_items[0][price_data][product_data][name]": planInfo.name,
        "line_items[0][price_data][unit_amount]": String(planInfo.amount),
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][quantity]": "1",
        "metadata[userId]": String(ctx.userId),
        "metadata[plan]": input.planId,
      });
      const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const sessionData = await sessionRes.json() as any;
      return { url: sessionData.url as string | undefined, message: sessionData.error?.message };
    }),
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.env.STRIPE_SECRET_KEY) return null;
    await ensureSchema(ctx.env.DB);
    const user = await ctx.env.DB.prepare(`SELECT stripeCustomerId FROM users WHERE id=?`).bind(ctx.userId).first<any>();
    if (!user?.stripeCustomerId) return null;
    try {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${user.stripeCustomerId}&status=active&limit=1`, {
        headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` },
      });
      const data = await res.json() as any;
      const sub = data.data?.[0];
      if (!sub) return null;
      return { cancelAtPeriodEnd: sub.cancel_at_period_end, currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString() };
    } catch { return null; }
  }),
});
