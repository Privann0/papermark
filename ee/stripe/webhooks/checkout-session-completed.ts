import {
  BUSINESS_PLAN_LIMITS,
  DATAROOMS_PLAN_LIMITS,
  DATAROOMS_PLUS_PLAN_LIMITS,
  DATAROOMS_PREMIUM_PLAN_LIMITS,
  DATAROOMS_UNLIMITED_PLAN_LIMITS,
  PRO_PLAN_LIMITS,
} from "@/ee/limits/constants";
import { stripeInstance } from "@/ee/stripe";
import { getSubscriptionPeriod } from "@/ee/stripe/compat";
import { waitUntil } from "@vercel/functions";
import Stripe from "stripe";

import { sendUpgradePersonalEmail } from "@/lib/emails/send-upgrade-personal-welcome";
import { sendUpgradePlanEmail } from "@/lib/emails/send-upgrade-plan";
import prisma from "@/lib/prisma";
import { sendUpgradeOneMonthCheckinEmailTask } from "@/lib/trigger/send-upgrade-checkin-email";
import { log } from "@/lib/utils";

import { getPlanFromPriceId } from "../utils";

export async function checkoutSessionCompleted(
  event: Stripe.Event,
  isOldAccount: boolean = false,
) {
  const checkoutSession = event.data.object as Stripe.Checkout.Session;

  if (
    checkoutSession.client_reference_id === null ||
    checkoutSession.customer === null
  ) {
    await log({
      message: "Missing items in Stripe webhook callback",
      type: "error",
    });
    return;
  }

  const stripe = stripeInstance(isOldAccount);
  const subscription = await stripe.subscriptions.retrieve(
    checkoutSession.subscription as string,
  );
  const subscriptionItem = subscription.items.data[0];

  if (!subscriptionItem) {
    await log({
      message: `Stripe subscription ${subscription.id} has no subscription item`,
      type: "error",
    });
    return;
  }

  const period = getSubscriptionPeriod(subscription);
  const priceId = subscriptionItem.price.id;
  const subscriptionId = subscription.id;
  const subscriptionStart = new Date(period.start * 1000);
  const subscriptionEnd = new Date(period.end * 1000);
  const quantity = subscriptionItem.quantity;

  console.log("subscription", subscription);
  console.log("subscription items", subscription.items.data);

  const plan = getPlanFromPriceId(priceId, isOldAccount);

  if (!plan) {
    await log({
      message: `Invalid price ID in checkout.session.completed event: ${priceId}, isOldAccount: ${isOldAccount}. Skipping webhook processing to prevent unintended plan changes.`,
      type: "error",
    });
    return;
  }

  const stripeId = checkoutSession.customer.toString();
  const teamId = checkoutSession.client_reference_id;

  let planLimits:
    | typeof PRO_PLAN_LIMITS
    | typeof BUSINESS_PLAN_LIMITS
    | typeof DATAROOMS_PLAN_LIMITS
    | typeof DATAROOMS_PLUS_PLAN_LIMITS
    | typeof DATAROOMS_PREMIUM_PLAN_LIMITS
    | typeof DATAROOMS_UNLIMITED_PLAN_LIMITS = structuredClone(PRO_PLAN_LIMITS);
  if (plan.slug === "pro") {
    planLimits = structuredClone(PRO_PLAN_LIMITS);
  } else if (plan.slug === "business") {
    planLimits = structuredClone(BUSINESS_PLAN_LIMITS);
  } else if (plan.slug === "datarooms") {
    planLimits = structuredClone(DATAROOMS_PLAN_LIMITS);
  } else if (plan.slug === "datarooms-plus") {
    planLimits = structuredClone(DATAROOMS_PLUS_PLAN_LIMITS);
  } else if (plan.slug === "datarooms-premium") {
    planLimits = structuredClone(DATAROOMS_PREMIUM_PLAN_LIMITS);
  } else if (plan.slug === "datarooms-unlimited") {
    planLimits = structuredClone(DATAROOMS_UNLIMITED_PLAN_LIMITS);
  }

  // Update the user limit in planLimits based on the subscription quantity
  planLimits.users =
    typeof quantity === "number" && quantity > 1 ? quantity : planLimits.users;

  // Update the user with the subscription information and stripeId
  const team = await prisma.team.update({
    where: {
      id: teamId,
    },
    data: {
      stripeId,
      plan: `${plan.slug}${isOldAccount ? "+old" : ""}`,
      subscriptionId,
      startsAt: subscriptionStart,
      endsAt: subscriptionEnd,
      limits: planLimits,
      // Clear cancellation and pause state when purchasing a new plan
      cancelledAt: null,
      pausedAt: null,
      pauseStartsAt: null,
      pauseEndsAt: null,
    },
    select: {
      id: true,
      users: {
        where: { role: "ADMIN" },
        select: {
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
  });

  // if event creation time more than 1 hour ago, return
  if (event.created < Date.now() / 1000 - 1 * 60 * 60) {
    await log({
      message: `Checkout session completed event created more than 1 hour ago: ${event.id}`,
      type: "error",
    });
    return;
  }

  // Send thank you email to project owner if they are a new customer
  waitUntil(
    sendUpgradePlanEmail({
      user: {
        email: team.users[0].user.email as string,
        name: team.users[0].user.name as string,
      },
      planType: plan.slug,
    }),
  );

  // send personal welcome email
  waitUntil(
    sendUpgradePersonalEmail({
      user: {
        email: team.users[0].user.email as string,
        name: team.users[0].user.name as string,
      },
      planSlug: plan.slug,
    }),
  );

  waitUntil(
    sendUpgradeOneMonthCheckinEmailTask.trigger(
      {
        to: team.users[0].user.email as string,
        name: team.users[0].user.name as string,
        teamId,
      },
      {
        delay: "40d",
      },
    ),
  );
}
