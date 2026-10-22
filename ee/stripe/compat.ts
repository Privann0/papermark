import Stripe from "stripe";

type LegacySubscription = Stripe.Subscription & {
  current_period_start?: number;
  current_period_end?: number;
  discount?: Stripe.Discount | null;
};

type CompatibleDiscount = Stripe.Discount & {
  coupon?: Stripe.Coupon | null;
  source?: {
    type?: string;
    coupon?: string | Stripe.Coupon | null;
  } | null;
};

type CompatibleInvoiceLine = Stripe.InvoiceLineItem & {
  price?: Stripe.Price | null;
  pricing?: {
    type?: string;
    price_details?: {
      price?: string | null;
    } | null;
  } | null;
};

export function getSubscriptionPeriod(subscription: Stripe.Subscription): {
  start: number;
  end: number;
} {
  const firstItem = subscription.items.data[0];
  const legacy = subscription as LegacySubscription;

  const start = firstItem?.current_period_start ?? legacy.current_period_start;

  const end = firstItem?.current_period_end ?? legacy.current_period_end;

  if (typeof start !== "number" || typeof end !== "number") {
    throw new Error(
      `Stripe subscription ${subscription.id} has no billing period`,
    );
  }

  return { start, end };
}

export function getExpandedSubscriptionDiscount(
  subscription: Stripe.Subscription,
): Stripe.Discount | null {
  const expanded = subscription.discounts?.find(
    (discount): discount is Stripe.Discount => typeof discount !== "string",
  );

  if (expanded) {
    return expanded;
  }

  const legacy = subscription as LegacySubscription;
  return legacy.discount ?? null;
}

export async function getDiscountCoupon(
  stripe: Stripe,
  discount: Stripe.Discount,
): Promise<Stripe.Coupon | null> {
  const compatible = discount as CompatibleDiscount;

  const couponRef =
    compatible.source?.type === "coupon"
      ? compatible.source.coupon
      : compatible.coupon;

  if (!couponRef) {
    return null;
  }

  if (typeof couponRef === "string") {
    return stripe.coupons.retrieve(couponRef);
  }

  return couponRef;
}

export function getLegacyInvoiceLinePrice(
  line: Stripe.InvoiceLineItem,
): Stripe.Price | null {
  return (line as CompatibleInvoiceLine).price ?? null;
}

export function getInvoiceLinePriceId(
  line: Stripe.InvoiceLineItem,
): string | null {
  const pricing = (line as CompatibleInvoiceLine).pricing;

  if (
    pricing?.type === "price_details" &&
    typeof pricing.price_details?.price === "string"
  ) {
    return pricing.price_details.price;
  }

  return null;
}

export function isYearlyRecurringPrice(price: Stripe.Price): boolean {
  const recurring = price.recurring;

  if (!recurring) {
    return false;
  }

  return (
    recurring.interval === "year" ||
    (recurring.interval === "month" && recurring.interval_count === 12)
  );
}
