import Stripe from "stripe";

// Lazily constructed via a Proxy, not `new Stripe(...)` at module scope —
// importing this module must not require STRIPE_SECRET_KEY to be set.
// Next.js's build-time "collect page data" step imports every route module
// (including the webhook route) without ever handling a real request; an
// eager construction here threw "Neither apiKey nor config.authenticator
// provided" and failed the production build outright, even though the key
// is only actually needed once a real request comes in. The Proxy defers
// the real `new Stripe(...)` call to first property access (at request
// time), so every existing call site (`stripe.checkout.sessions.create`,
// `stripe.webhooks.constructEvent`, ...) keeps working unchanged — matching
// the lazy getClient() pattern already used for the DeepSeek/Anthropic
// clients elsewhere in this codebase.
let cachedClient: Stripe | null = null;
function getClient(): Stripe {
  if (!cachedClient) {
    cachedClient = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  }
  return cachedClient;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return Reflect.get(getClient(), prop);
  },
});

export const STRIPE_PRICE_IDS = {
  MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY ?? "",
  ANNUAL: process.env.STRIPE_PRICE_ID_ANNUAL ?? "",
} as const;
