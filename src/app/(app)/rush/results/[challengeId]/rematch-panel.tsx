"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Swords } from "lucide-react";
import type { RematchState } from "@/lib/rush/rematch";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { acceptRematchAction, rematchStateAction, requestRematchAction } from "../../actions";
import { useRushSound } from "../../game-fx";

/** How often the results page checks whether the other player asked. */
const POLL_MS = 3_000;
/** The same, while the tab is in the background: an invitation still arrives, just later. */
const HIDDEN_POLL_MS = 15_000;
/**
 * A rematch is a "right now" thing. A results tab left open all day used to
 * ask every three seconds until it was closed — some thirty thousand requests
 * for nothing — so checking stops once the moment has clearly passed. The hub
 * still shows any invitation that arrives later.
 */
const POLL_FOR_MS = 15 * 60 * 1000;

/**
 * Rematch, on the results page of a finished head-to-head.
 *
 * It polls, because the moment that matters is both players still looking
 * at the result: one presses Rematch, and the other should see "Ada wants a
 * rematch" within a few seconds rather than only if they happen to go back to
 * the hub. Polling stops once there's nothing left to change on this page.
 *
 * Asking is Premium; accepting is free (see requestRematchAction). A student
 * without Premium still sees the offer — pointed at pricing — because a
 * rematch they can't start is still a reason to want it.
 */
export function RematchPanel({ challengeId, initial, paid }: { challengeId: string; initial: RematchState; paid: boolean }) {
  const [state, setState] = useState<RematchState>(initial);
  const sound = useRushSound();
  const playRef = useRef(sound.play);
  const lastKind = useRef(initial.kind);
  useEffect(() => {
    playRef.current = sound.play;
  });

  const settled = state.kind === "UNAVAILABLE" || state.kind === "PLAYED" || state.kind === "IN_PROGRESS";
  useEffect(() => {
    if (settled) return;
    const stopAt = Date.now() + POLL_FOR_MS;
    let timer = 0;
    let cancelled = false;
    async function check() {
      try {
        const next = await rematchStateAction(challengeId);
        if (cancelled) return;
        // A ping when an invitation arrives, so a student who has looked away
        // from the screen hears it.
        if (next.kind === "RECEIVED" && lastKind.current !== "RECEIVED") playRef.current("go");
        lastKind.current = next.kind;
        setState(next);
      } catch {
        // A blip; try again on the next tick.
      }
      schedule();
    }
    function schedule() {
      if (cancelled || Date.now() >= stopAt) return;
      timer = window.setTimeout(check, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    }
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [challengeId, settled]);

  if (state.kind === "UNAVAILABLE") return null;

  if (state.kind === "RECEIVED") {
    return (
      // A gentle entrance, not the score "bump": scaling a panel this size by
      // 1.3 pushed it past the edges of the card it sits in.
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-marker bg-background p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
        <p className="flex items-center gap-2 font-medium">
          <Swords className="size-5 shrink-0 text-primary" aria-hidden />
          {state.opponentName} wants a rematch{state.live ? " — they're in the room now." : "."}
        </p>
        <form action={acceptRematchAction}>
          <input type="hidden" name="rematchId" value={state.challengeId} />
          <Button type="submit" size="cta">
            Accept rematch
          </Button>
        </form>
      </div>
    );
  }

  if (state.kind === "NONE") {
    return (
      <div className="mt-6">
        {paid ? (
          <form action={requestRematchAction}>
            <input type="hidden" name="challengeId" value={challengeId} />
            <Button type="submit" size="cta">
              <Swords className="size-4" aria-hidden />
              Rematch {state.opponentName}
            </Button>
          </form>
        ) : (
          <LinkButton href="/pricing" size="cta">
            <Lock className="size-4" aria-hidden />
            Rematch {state.opponentName} with Premium
          </LinkButton>
        )}
      </div>
    );
  }

  if (state.kind === "SENT") {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {state.live
            ? `Your rematch room is open — waiting for ${state.opponentName}.`
            : `Rematch sent. ${state.opponentName} will see it on their 1v1 Rush page.`}
        </p>
        {state.live ? (
          <LinkButton href={`/rush/live/${state.challengeId}`} variant="outline" className="rounded-full">
            Back to the room
          </LinkButton>
        ) : (
          state.runId && (
            <LinkButton href={`/rush/play/${state.runId}`} variant="outline" className="rounded-full">
              Play your side
            </LinkButton>
          )
        )}
      </div>
    );
  }

  if (state.kind === "IN_PROGRESS") {
    return (
      <div className="mt-6">
        <LinkButton
          href={state.live ? `/rush/live/${state.challengeId}` : `/rush/play/${state.runId}`}
          variant="outline"
          className="rounded-full"
        >
          Back to your rematch
        </LinkButton>
      </div>
    );
  }

  // PLAYED
  return (
    <div className="mt-6">
      <LinkButton href={`/rush/results/${state.challengeId}`} variant="outline" className="rounded-full">
        See the rematch result
      </LinkButton>
    </div>
  );
}
