import { appendFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { logEmailDeliveryFailure } from "@/lib/logger";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Why this returns a result instead of just logging: with no log aggregator
 * (GER §16 says backend logs are sufficient for V1), a swallowed Resend
 * rejection is invisible — which is exactly how every transactional email
 * silently went nowhere between launch and 2026-10-17. Callers on a critical
 * path still ignore it, so a failed send never breaks the operation it is
 * attached to; the Owner status page is the one caller that reads it.
 */
export type SendEmailResult = { ok: true } | { ok: false; reason: string };

/** True when a Resend client could be constructed, i.e. the key is present. */
export function isEmailConfigured(): boolean {
  return resendClient !== null;
}

/**
 * The address sends are attempted from.
 *
 * The local part is arbitrary on a verified domain, and the display name is
 * what a student actually reads in their inbox list. `no-reply@` is the most
 * impersonal signal there is — it announces that nobody is listening — and
 * four of these emails are signed by a named person, so the envelope should
 * agree with the signature.
 */
export function emailFromAddress(): string {
  return process.env.EMAIL_FROM ?? "Prithvi at PrepHub <prithvi@mail.prephubtp.com>";
}

/**
 * Where a student's reply goes.
 *
 * Unset means replies bounce, which is the default behaviour of the address
 * above and undoes the point of it. This is deliberately allowed to be an
 * ordinary personal inbox: a Reply-To is only ever seen by someone who
 * already received an email, so unlike an address printed on a public page
 * it is not exposed to scrapers.
 */
export function emailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO || undefined;
}

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Domains reserved so that no mail can ever be delivered to them (RFC 2606,
 * RFC 6761): `example.com/.net/.org` and anything under `.test`, `.example`,
 * `.invalid` or `.localhost`.
 *
 * Test accounts and the demo district's students (scripts/demo-district.ts)
 * live on these on purpose, and production can hold both. A real send to one
 * bounces, and bounces cost the sending domain the reputation every
 * student's password reset depends on — so these are dropped before Resend
 * is called, and reported as handled rather than failed, so the email queue
 * doesn't retry them five times. The dev outbox still records them: e2e
 * reads what *would* have been sent to its example.com accounts.
 */
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];

export function isUndeliverableAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split("@").pop() ?? "";
  if (RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  const tld = domain.split(".").pop() ?? "";
  return RESERVED_TLDS.includes(tld);
}

// Dev-only "outbox" file so E2E tests (which can't receive real email) can read
// what would have been sent — e.g. to pull a password reset link out of it.
// Never written in production (gated on resendClient being unconfigured).
const DEV_OUTBOX_PATH = path.join(process.cwd(), ".dev-emails.jsonl");

// PRD-001/017 require several transactional emails (password reset, verification,
// access-expiring warnings, ...). Centralized here so every call site behaves the
// same way in dev (no API key configured yet) vs. production.
//
// Side effects like this must never block or fail the core operation they're
// attached to (see CLAUDE.md) — callers should fire-and-log, not await-and-throw
// on the caller's critical path.
export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<SendEmailResult> {
  if (!resendClient) {
    // In production this branch means RESEND_API_KEY is missing, so every
    // password reset and lifecycle email is silently going nowhere. Log it as
    // a delivery failure so it surfaces in the function logs instead of a
    // console.info nobody reads, and skip the dev outbox below: a serverless
    // filesystem discards that file anyway.
    if (process.env.NODE_ENV === "production") {
      logEmailDeliveryFailure("RESEND_API_KEY is not configured - email was not sent", {
        email: to,
        subject,
        errorType: "MissingApiKey",
      });
      return { ok: false, reason: "RESEND_API_KEY is not set in this environment." };
    }

    console.info(`[dev email] to=${to} subject="${subject}"\n${text}`);
    await appendFile(
      DEV_OUTBOX_PATH,
      JSON.stringify({ to, subject, text, sentAt: new Date().toISOString() }) + "\n",
    ).catch(() => {
      // Best-effort only — never fail the caller's operation over a dev convenience file.
    });
    return { ok: true };
  }

  if (isUndeliverableAddress(to)) return { ok: true };

  // Resend only sends from a domain verified in its dashboard. The site's
  // domain is prephubtp.com; the old hard-coded prephub.app address would
  // have been rejected the moment a key was added.
  const replyTo = emailReplyTo();
  const { error } = await resendClient.emails.send({
    from: emailFromAddress(),
    ...(replyTo ? { replyTo } : {}),
    to,
    subject,
    text,
  });

  if (error) {
    logEmailDeliveryFailure("Failed to send email via Resend", {
      email: to,
      subject,
      errorType: error.name,
    });
    return { ok: false, reason: `${error.name}: ${error.message}` };
  }

  return { ok: true };
}

/**
 * Resend's own batch endpoint takes 100 messages per call, and its rate limit
 * is per-request rather than per-recipient, so batching is both the supported
 * way to do this and the only way that finishes inside a serverless function's
 * execution budget.
 */
const BATCH_SIZE = 100;

/** Pause between batches, to stay under the provider's request rate limit. */
const BATCH_PAUSE_MS = 600;

export type BulkEmailResult = { sent: number; failed: number };

/**
 * Sends the same message to many recipients.
 *
 * Replaces `Promise.all(recipients.map(sendEmail))`, which opened one HTTP
 * request per recipient simultaneously. At a pilot campus that is fifty
 * requests and it works; at two thousand students it exhausts the rate limit,
 * and the function times out somewhere in the middle having sent an unknowable
 * subset. Batched and paced, two thousand recipients is twenty requests.
 *
 * Never throws. A failed batch is logged and counted, because the caller is
 * always something like "publish this announcement" that must not be undone by
 * a mail provider having a bad minute.
 */
export async function sendBulkEmail(
  recipients: string[],
  { subject, text }: { subject: string; text: string },
): Promise<BulkEmailResult> {
  const unique = [...new Set(recipients.filter((r) => r && r.includes("@")))];
  if (unique.length === 0) return { sent: 0, failed: 0 };

  if (!resendClient) {
    if (process.env.NODE_ENV === "production") {
      logEmailDeliveryFailure("RESEND_API_KEY is not configured - bulk email was not sent", {
        subject,
        recipients: unique.length,
        errorType: "MissingApiKey",
      });
      return { sent: 0, failed: unique.length };
    }
    for (const to of unique) await sendEmail({ to, subject, text });
    return { sent: unique.length, failed: 0 };
  }

  const from = emailFromAddress();
  const replyTo = emailReplyTo();
  // Reserved test addresses are handled by not sending (see
  // isUndeliverableAddress), which counts as done, not as a failure.
  const deliverable = unique.filter((r) => !isUndeliverableAddress(r));
  let sent = unique.length - deliverable.length;
  let failed = 0;

  for (let i = 0; i < deliverable.length; i += BATCH_SIZE) {
    const batch = deliverable.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await resendClient.batch.send(
        batch.map((to) => ({
          from,
          ...(replyTo ? { replyTo } : {}),
          to,
          subject,
          text,
        })),
      );
      if (error) {
        failed += batch.length;
        logEmailDeliveryFailure("Bulk email batch rejected by Resend", {
          subject,
          recipients: batch.length,
          errorType: error.name,
        });
      } else {
        sent += batch.length;
      }
    } catch (err) {
      failed += batch.length;
      logEmailDeliveryFailure("Bulk email batch threw", {
        subject,
        recipients: batch.length,
        errorType: err instanceof Error ? err.name : "Unknown",
      });
    }

    if (i + BATCH_SIZE < deliverable.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  return { sent, failed };
}
