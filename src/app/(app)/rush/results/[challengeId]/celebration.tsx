"use client";

import { useEffect, useRef } from "react";
import type { RushOutcome } from "@/lib/rush/scoring";
import { Confetti, SoundToggle, useRushSound } from "../../game-fx";

/**
 * The moment the result lands: a fanfare and confetti for a win, a short
 * descending phrase for a loss, nothing for a tie or a solo run (there is
 * nobody to have beaten). The results page itself is server-rendered; this is
 * the one part of it that needs the browser.
 *
 * Sound plays once per visit. The runner navigates here client-side, so the
 * page still carries the gesture that started the run, which is what lets
 * audio play without a fresh click.
 */
export function ResultsCelebration({ outcome }: { outcome: RushOutcome | null }) {
  const sound = useRushSound();
  const played = useRef(false);
  const playRef = useRef(sound.play);
  useEffect(() => {
    playRef.current = sound.play;
  });

  useEffect(() => {
    if (played.current) return;
    played.current = true;
    if (outcome === "WON") playRef.current("win");
    else if (outcome === "LOST") playRef.current("lose");
  }, [outcome]);

  return (
    <>
      {outcome === "WON" && <Confetti />}
      <SoundToggle muted={sound.muted} onToggle={sound.toggle} />
    </>
  );
}
