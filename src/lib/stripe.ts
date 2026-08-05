import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export const STRIPE_PRICE_IDS = {
  MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY ?? "",
  ANNUAL: process.env.STRIPE_PRICE_ID_ANNUAL ?? "",
} as const;
