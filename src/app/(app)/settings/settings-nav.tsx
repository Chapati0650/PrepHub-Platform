"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SettingsSectionLink = { id: string; label: string };

// The reference's left-hand settings index. Ours is one scrolling page, so
// these are anchor links, and the highlighted item follows the section
// currently on screen. Plain anchors mean the page works identically with
// JavaScript off — the scroll listener only adds the highlight.
//
// Position-based rather than IntersectionObserver. The active section is the
// last one whose top has crossed a "reading line" just below the viewport's
// top edge — shallow on purpose: at 30% down, a short section (Appearance is
// ~180px) was out-scored by the section beneath it the moment you clicked
// its link. The line sits at the anchor scroll offset plus a little slack.
//
// The bottom of the page needs its own rule, and it is the subtle part. Once
// the page can't scroll further, the last section's heading may never reach
// the line, so it would never highlight — but a wheel-scroll to the bottom
// and a click on the second-to-last link land on the *same* scroll position
// and mean different things. Only the URL hash can tell them apart: a fresh
// anchor click "arms" its hash, and while the page sits at the bottom an
// armed hash wins; scrolling away from the bottom disarms it, so a hash left
// over from an earlier click can't mislabel a later wheel-scroll. Anchor
// jumps here are instant (no scroll-behavior: smooth), so no intermediate
// scroll events fire between the click and the bottom to disarm it early.
// (An IntersectionObserver can't express any of this; it was tried first
// and failed exactly this way.)
//
// The first measurement is scheduled with requestAnimationFrame, not called
// synchronously in the effect body, which is what the repo's
// react-hooks/set-state-in-effect rule is there to catch.
export function SettingsNav({ sections }: { sections: SettingsSectionLink[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    let frame = 0;
    let armedHash = "";
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      // scroll-mt-8 on the sections is 2rem; 6rem leaves slack for the
      // browser landing an anchor a few pixels off.
      const line = Math.min(96, window.innerHeight * 0.2);
      let underLine = sections[0]?.id ?? "";
      for (const { id } of sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) underLine = id;
      }
      let current = underLine;
      if (atBottom && sections.length > 0) {
        const known = armedHash && sections.some((s) => s.id === armedHash);
        current = known ? armedHash : sections[sections.length - 1].id;
      } else {
        armedHash = "";
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onHash = () => {
      armedHash = window.location.hash.slice(1);
      schedule();
    };
    // A hash present on first load (a shared #subscription link, say) counts
    // as an arrived-by-click too.
    armedHash = window.location.hash.slice(1);
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", onHash);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", onHash);
    };
  }, [sections]);

  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
      {sections.map(({ id, label }) => {
        const isActive = id === active;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={isActive ? "location" : undefined}
            className={cn(
              "rounded-full px-3 py-2 text-sm transition-colors",
              isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
