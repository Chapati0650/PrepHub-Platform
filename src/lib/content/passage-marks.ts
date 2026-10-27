// Private-use characters a walkthrough wraps around a span of passage text
// (walkthrough.ts's markPassage) and LatexText turns into a styled span. They
// can't occur in real content, so they change nothing else about rendering.
// Kept dependency-free: LatexText renders on every question surface.
export const MARK = {
  hl: ["", ""],
  alt: ["", ""],
  fill: ["", ""],
  fillRight: ["", ""],
  fillWrong: ["", ""],
} as const;

const CLASS: Record<keyof typeof MARK, string> = {
  hl: "wt-hl",
  alt: "wt-alt",
  fill: "wt-fill",
  fillRight: "wt-fill wt-fill-right",
  fillWrong: "wt-fill wt-fill-wrong",
};

/** Turns markers in already-escaped HTML into spans. */
export function renderMarks(html: string): string {
  if (!/[-]/.test(html)) return html;
  let out = html;
  for (const [key, [open, close]] of Object.entries(MARK) as [keyof typeof MARK, readonly [string, string]][]) {
    out = out.replaceAll(open, `<span class="${CLASS[key]}">`).replaceAll(close, "</span>");
  }
  return out;
}
