"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DistrictPrompt } from "@/lib/district/enrollment";

export type ResendState = { message?: string; error?: string };

/**
 * The one step left between a student and the Premium their school pays for,
 * in the bar above every page — where the launch-pricing strip sits for
 * everyone else. A student who is a click from free access is never shown a
 * price instead (the layout hides the Upgrade row for the two actionable
 * kinds), because selling them what their school already covers is the one
 * thing this bar exists to prevent.
 *
 * Deep teal rather than the pricing strip's cyan: this is the school
 * speaking, not a sale.
 */
export function DistrictBar({
  prompt,
  resend,
}: {
  prompt: DistrictPrompt;
  resend: (prev: ResendState) => Promise<ResendState>;
}) {
  const [state, resendAction, pending] = useActionState(resend, {});

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-surface-deep px-4 py-2.5 text-sm text-surface-deep-foreground">
      {prompt.kind === "CONFIRM_EMAIL" && (
        <>
          <p className="text-center">
            <span className="font-semibold">{prompt.organizationName} covers your PrepHub Premium.</span>{" "}
            <span className="text-surface-deep-foreground/80">
              Confirm {prompt.email} to switch it on — the link is in that inbox.
            </span>
          </p>
          <form action={resendAction}>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex shrink-0 items-center rounded-full bg-marker px-3 py-1 text-xs font-semibold text-surface-deep transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Sending…" : "Resend the link"}
            </button>
          </form>
          {(state.message || state.error) && (
            <p role="status" className="w-full text-center text-xs text-surface-deep-foreground/80">
              {state.message ?? state.error}
            </p>
          )}
        </>
      )}

      {prompt.kind === "PICK_CAMPUS" && (
        <>
          <p className="text-center">
            <span className="font-semibold">{prompt.organizationName} covers your PrepHub Premium.</span>{" "}
            <span className="text-surface-deep-foreground/80">Tell us which school you go to and it switches on.</span>
          </p>
          <Link
            href="/access/campus"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-marker px-3 py-1 text-xs font-semibold text-surface-deep transition-opacity hover:opacity-90"
          >
            Choose your school
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </>
      )}

      {prompt.kind === "NOT_ON_ROSTER" && (
        <p className="text-center">
          <span className="font-semibold">{prompt.organizationName} uses PrepHub</span>
          <span className="text-surface-deep-foreground/80">
            , but {prompt.email} isn&apos;t on its student list yet. Ask your school counselor to add you —
            Premium switches on by itself once you&apos;re on it.
          </span>
        </p>
      )}
    </div>
  );
}
