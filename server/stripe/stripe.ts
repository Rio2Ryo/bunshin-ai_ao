import Stripe from "stripe";
import { ENV } from "../_core/env";

// Initialize Stripe with secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn("[Stripe] STRIPE_SECRET_KEY not configured");
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2026-01-28.clover" as any,
    })
  : null;

/**
 * Create a Stripe Checkout Session for subscription
 */
export async function createCheckoutSession(params: {
  userId: number;
  userEmail: string;
  userName: string;
  plan: "premium" | "enterprise";
  interval: "monthly" | "yearly";
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
}): Promise<{ url: string; sessionId: string } | null> {
  if (!stripe) {
    console.error("[Stripe] Stripe not initialized");
    return null;
  }

  const { userId, userEmail, userName, plan, interval, successUrl, cancelUrl, customerId } = params;

  // Price amounts in JPY
  const prices = {
    premium: { monthly: 980, yearly: 9800 },
    enterprise: { monthly: 4980, yearly: 49800 },
  };

  const priceAmount = prices[plan][interval];

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId || undefined,
      customer_email: customerId ? undefined : userEmail,
      client_reference_id: userId.toString(),
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: {
              name: `分身AI ${plan === "premium" ? "プレミアム" : "エンタープライズ"}プラン`,
              description: `${interval === "monthly" ? "月額" : "年額"}サブスクリプション`,
            },
            unit_amount: priceAmount,
            recurring: {
              interval: interval === "monthly" ? "month" : "year",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: userId.toString(),
        customer_email: userEmail,
        customer_name: userName,
        plan: plan,
        interval: interval,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return {
      url: session.url!,
      sessionId: session.id,
    };
  } catch (error) {
    console.error("[Stripe] Failed to create checkout session:", error);
    return null;
  }
}

/**
 * Create a Stripe Customer Portal session for managing subscription
 */
export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string } | null> {
  if (!stripe) {
    console.error("[Stripe] Stripe not initialized");
    return null;
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  } catch (error) {
    console.error("[Stripe] Failed to create portal session:", error);
    return null;
  }
}

/**
 * Get subscription details
 */
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  if (!stripe) return null;

  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error("[Stripe] Failed to get subscription:", error);
    return null;
  }
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(subscriptionId: string): Promise<boolean> {
  if (!stripe) return false;

  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return true;
  } catch (error) {
    console.error("[Stripe] Failed to cancel subscription:", error);
    return false;
  }
}
