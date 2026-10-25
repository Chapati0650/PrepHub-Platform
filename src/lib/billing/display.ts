/**
 * Prices as they are *shown*. What Stripe charges lives on the Price IDs in
 * STRIPE_PRICE_IDS, and nothing here is ever sent to checkout.
 *
 * In one place because two surfaces state the annual price — /pricing, and
 * the moment a school's Premium switches on, which strikes it through (the
 * Owner's request, 2026-10-24) — and the two must never disagree. Never on
 * the landing page: that one carries no price at all (Owner, 2026-09-21).
 */
export const ANNUAL_PRICE = "$99";
export const ANNUAL_PERIOD = "/year";
