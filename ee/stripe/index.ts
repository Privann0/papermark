import Stripe from "stripe";

const createStripe = (apiKey: string) =>
  new Stripe(apiKey, {
    apiVersion: "2026-06-24.dahlia",
    appInfo: {
      name: "Papermark.io",
      version: "0.1.0",
    },
    typescript: true,
  });

let stripeOld: Stripe | null = null;
let stripeNew: Stripe | null = null;

const getStripeKey = (account: boolean): string => {
  const apiKey = account
    ? process.env.STRIPE_SECRET_KEY_LIVE_OLD ||
      process.env.STRIPE_SECRET_KEY_OLD
    : process.env.STRIPE_SECRET_KEY_LIVE ||
      process.env.STRIPE_SECRET_KEY;

  if (!apiKey) {
    throw new Error(
      account
        ? "Legacy Stripe secret key is not configured"
        : "Stripe secret key is not configured",
    );
  }

  return apiKey;
};

export const stripeInstance = (account: boolean = false) => {
  if (account) {
    stripeOld ??= createStripe(getStripeKey(true));
    return stripeOld;
  }

  stripeNew ??= createStripe(getStripeKey(false));
  return stripeNew;
};

export async function cancelSubscription(
  customer?: string,
  isOldAccount: boolean = false,
) {
  if (!customer) return;

  try {
    const stripe = stripeInstance(isOldAccount);
    const subscriptionId = await stripe.subscriptions
      .list({
        customer,
      })
      .then((res) => res.data[0].id);

    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
      cancellation_details: {
        comment: "Customer deleted their Papermark instance.",
      },
    });
  } catch (error) {
    return;
  }
}
