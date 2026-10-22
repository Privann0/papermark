import { NextApiResponse } from "next";

import { sendSubscriptionRenewalReminderEmail } from "@/ee/features/billing/renewal-reminder/lib/send-subscription-renewal-reminder";
import { stripeInstance } from "@/ee/stripe";
import {
  getInvoiceLinePriceId,
  getLegacyInvoiceLinePrice,
  isYearlyRecurringPrice,
} from "@/ee/stripe/compat";
import Stripe from "stripe";

import { log } from "@/lib/utils";

export async function invoiceUpcoming(
  event: Stripe.Event,
  res: NextApiResponse,
  isOldAccount: boolean = false,
) {
  const invoice = event.data.object as Stripe.Invoice;

  // Only process invoices for yearly renewals
  const lineItems = invoice.lines.data;
  if (!lineItems || lineItems.length === 0) {
    await log({
      message: "No line items found in invoice.upcoming event",
      type: "info",
    });
    return res.status(200).json({ received: true });
  }

  // Check if this is a yearly subscription. Legacy webhook payloads expose
  // line.price directly; modern Stripe API versions expose only the price ID
  // under line.pricing.price_details, so retrieve those prices when needed.
  let hasYearlyPlan = lineItems.some((item) => {
    const legacyPrice = getLegacyInvoiceLinePrice(item);
    return legacyPrice ? isYearlyRecurringPrice(legacyPrice) : false;
  });

  if (!hasYearlyPlan) {
    const priceIds = Array.from(
      new Set(
        lineItems
          .map(getInvoiceLinePriceId)
          .filter((priceId): priceId is string => Boolean(priceId)),
      ),
    );

    if (priceIds.length > 0) {
      const stripe = stripeInstance(isOldAccount);
      const prices = await Promise.all(
        priceIds.map((priceId) => stripe.prices.retrieve(priceId)),
      );

      hasYearlyPlan = prices.some(isYearlyRecurringPrice);
    }
  }

  if (!hasYearlyPlan) {
    await log({
      message: "Invoice is not for yearly renewal, skipping reminder email",
      type: "info",
    });
    return res.status(200).json({ received: true });
  }

  const customerEmail = invoice.customer_email;

  if (!customerEmail) {
    await log({
      message: "No customer email found in invoice.upcoming event",
      type: "error",
    });
    return res.status(200).json({ received: true });
  }

  // Calculate renewal date (period_end is when the invoice will be charged)
  const renewalTimestamp = invoice.period_end;
  const renewalDate = new Date(renewalTimestamp * 1000);
  const formattedRenewalDate = renewalDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  try {
    // send email immediately
    await sendSubscriptionRenewalReminderEmail({
      customerEmail,
      renewalDate: formattedRenewalDate,
      isOldAccount,
    });

    await log({
      message: `Renewal reminder email sent for ${customerEmail}. Renewal date: ${formattedRenewalDate}`,
      type: "info",
    });
  } catch (error) {
    await log({
      message: `Failed to send renewal reminder email for ${customerEmail}: ${error}`,
      type: "error",
    });
    return res.status(200).json({ received: true });
  }
}
