export type Currency = "eur" | "usd";

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  eur: "€",
  usd: "$",
};

export const CURRENCY_LABEL: Record<Currency, string> = {
  eur: "EUR",
  usd: "USD",
};
