"use client";

import { useState } from "react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Confetti } from "@/components/confetti";
import { Button } from "@/components/ui/button";
import { ANNUAL_PERIOD, ANNUAL_PRICE } from "@/lib/billing/display";

/**
 * The moment a school's Premium switches on (Owner, 2026-10-24): the annual
 * price is struck through by hand, FREE stamps down beside it, and confetti
 * goes up. Shown once per student — the app layout passes it only while
 * `StudentMembership.celebratedAt` is null, and closing it records the date.
 *
 * Deliberately the one dialog in the product that interrupts: it appears on
 * the first ordinary page after the membership exists (never over a question
 * — AppShell holds it back on focus-mode routes), and it is the reason a
 * district student understands, before they've seen a paywall anywhere, that
 * nothing is going to ask them to pay.
 *
 * Under reduced motion the stroke is simply drawn, FREE simply sits there,
 * and there is no confetti: the same facts, nothing moving.
 */
export function PremiumUnlocked({
  organizationName,
  logoMediaId,
  firstName,
  onSeen,
}: {
  organizationName: string;
  logoMediaId: string | null;
  firstName: string | null;
  onSeen: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    // Fire-and-forget: the dialog is gone the instant it's dismissed, and a
    // failed write only means it shows once more on some later page.
    void onSeen().catch(() => {});
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-surface-deep/70 duration-200 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl bg-card text-card-foreground shadow-2xl outline-none duration-300 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-6 data-closed:animate-out data-closed:fade-out-0">
          <div className="bg-surface-deep px-6 pt-6 pb-6 text-surface-deep-foreground sm:px-8">
            <div className="flex items-center gap-3">
              {logoMediaId && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white p-1">
                  <Image
                    src={`/api/media/${logoMediaId}`}
                    alt=""
                    width={28}
                    height={28}
                    unoptimized
                    className="max-h-full w-auto object-contain"
                  />
                </span>
              )}
              <p className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/70 uppercase">
                {organizationName}
              </p>
            </div>
            <DialogPrimitive.Title className="mt-4 font-heading text-display-sm font-semibold tracking-tight text-balance">
              {firstName ? `${firstName}, your school` : "Your school"} covers PrepHub Premium.
            </DialogPrimitive.Title>
          </div>

          <div className="px-6 pt-7 pb-6 sm:px-8">
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              PrepHub Premium
            </p>
            <p className="sr-only">
              Normally {ANNUAL_PRICE} a year. Free for you.
            </p>
            <div aria-hidden className="mt-3 flex items-center gap-6">
              <span className="relative inline-block font-heading text-4xl font-semibold tracking-tight text-muted-foreground tabular-nums">
                {ANNUAL_PRICE}
                <span className="text-xl">{ANNUAL_PERIOD}</span>
                {/* A hand-drawn stroke, not `line-through`: the uniform rule
                    is a browser default, and this is the one moment in the
                    product where the gesture is the point. pathLength={1}
                    lets the draw be animated without measuring the path. */}
                <svg
                  viewBox="0 0 100 24"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute top-1/2 -left-[6%] h-5 w-[112%] -translate-y-1/2 overflow-visible"
                >
                  <path
                    d="M2 17 C 28 9, 62 15, 98 5"
                    pathLength={1}
                    strokeDasharray="1"
                    className="fill-none stroke-destructive [stroke-linecap:round] [stroke-width:3.5] motion-safe:animate-premium-strike"
                  />
                </svg>
              </span>
              <span className="inline-block -rotate-6 font-heading text-6xl font-bold tracking-tight text-primary motion-safe:animate-premium-stamp">
                FREE
              </span>
            </div>

            <DialogPrimitive.Description className="mt-6 text-muted-foreground">
              Every Practice Set, the 800 Club, 1v1 Rush and The Curriculum — paid for by {organizationName},
              for as long as you&apos;re a student there. No card, no code.
            </DialogPrimitive.Description>

            <DialogPrimitive.Close render={<Button size="cta" className="mt-7 w-full" />}>
              Start practicing
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
      {open && <Confetti originY={0.42} delayMs={1200} />}
    </DialogPrimitive.Root>
  );
}
