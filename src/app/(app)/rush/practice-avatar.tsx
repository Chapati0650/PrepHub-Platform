import type { BotAvatar } from "@/lib/rush/bot";

// The practice opponent's picture: its first initial on one of a fixed set of
// colours. No image files, and the same look on the scoreboard and results.
export function PracticeAvatar({ avatar, size = 28 }: { avatar: BotAvatar; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: avatar.bg, color: avatar.fg, fontSize: Math.round(size * 0.45) }}
    >
      {avatar.initial}
    </span>
  );
}
