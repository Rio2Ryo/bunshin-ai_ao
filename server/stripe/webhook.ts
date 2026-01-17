import { Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "./stripe";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  if (!stripe || !webhookSecret) {
    console.error("[Webhook] Stripe not configured");
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    console.error("[Webhook] Missing stripe-signature header");
    return res.status(400).json({ error: "Missing signature" });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("[Webhook] Signature verification failed:", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    console.log("[Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  console.log(`[Webhook] Received event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.paid":
        console.log("[Webhook] Invoice paid:", event.data.object.id);
        break;

      case "invoice.payment_failed":
        console.log("[Webhook] Invoice payment failed:", event.data.object.id);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error processing event:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log("[Webhook] Checkout completed:", session.id);

  const userId = session.client_reference_id;
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const plan = session.metadata?.plan as "premium" | "enterprise" | undefined;

  if (!userId || !customerId || !subscriptionId || !plan) {
    console.error("[Webhook] Missing required data in checkout session");
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error("[Webhook] Database not available");
    return;
  }

  try {
    await db
      .update(users)
      .set({
        plan: plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      })
      .where(eq(users.id, parseInt(userId)));

    console.log(`[Webhook] User ${userId} upgraded to ${plan} plan`);
  } catch (error) {
    console.error("[Webhook] Failed to update user:", error);
  }
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log("[Webhook] Subscription updated:", subscription.id);

  const customerId = subscription.customer as string;
  const status = subscription.status;

  const db = await getDb();
  if (!db) return;

  // Find user by Stripe customer ID
  const result = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (result.length === 0) {
    console.error("[Webhook] User not found for customer:", customerId);
    return;
  }

  const user = result[0];

  // Update subscription status
  if (status === "active") {
    // Subscription is active, keep current plan
    console.log(`[Webhook] Subscription active for user ${user.id}`);
  } else if (status === "canceled" || status === "unpaid" || status === "past_due") {
    // Downgrade to free plan
    await db
      .update(users)
      .set({
        plan: "free",
        stripeSubscriptionId: null,
      })
      .where(eq(users.id, user.id));

    console.log(`[Webhook] User ${user.id} downgraded to free plan`);
  }
}

/**
 * Handle subscription deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log("[Webhook] Subscription deleted:", subscription.id);

  const customerId = subscription.customer as string;

  const db = await getDb();
  if (!db) return;

  // Find user by Stripe customer ID
  const result = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (result.length === 0) {
    console.error("[Webhook] User not found for customer:", customerId);
    return;
  }

  const user = result[0];

  // Downgrade to free plan
  await db
    .update(users)
    .set({
      plan: "free",
      stripeSubscriptionId: null,
    })
    .where(eq(users.id, user.id));

  console.log(`[Webhook] User ${user.id} subscription cancelled, downgraded to free`);
}
