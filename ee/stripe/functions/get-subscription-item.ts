import {
  getDiscountCoupon,
  getExpandedSubscriptionDiscount,
  getSubscriptionPeriod,
} from "@/ee/stripe/compat";

import { stripeInstance } from "..";

export interface SubscriptionDiscount {
  couponId: string;
  percentOff?: number;
  amountOff?: number;
  duration: string;
  durationInMonths?: number;
  valid: boolean;
  end?: number;
}

export default async function getSubscriptionItem(
  subscriptionId: string,
  isOldAccount: boolean,
) {
  const stripe = stripeInstance(isOldAccount);

  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["discounts"],
  });

  const subscriptionItem = subscription.items.data[0];

  if (!subscriptionItem) {
    throw new Error(
      `Stripe subscription ${subscription.id} has no subscription item`,
    );
  }

  const period = getSubscriptionPeriod(subscription);

  let discount: SubscriptionDiscount | null = null;

  const expandedDiscount = getExpandedSubscriptionDiscount(subscription);

  if (expandedDiscount) {
    const coupon = await getDiscountCoupon(stripe, expandedDiscount);

    if (coupon) {
      discount = {
        couponId: coupon.id,
        percentOff: coupon.percent_off ?? undefined,
        amountOff: coupon.amount_off ?? undefined,
        duration: coupon.duration,
        durationInMonths: coupon.duration_in_months ?? undefined,
        valid: coupon.valid,
        end: expandedDiscount.end ?? undefined,
      };
    }
  }

  return {
    id: subscriptionItem.id,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    discount,
  };
}
