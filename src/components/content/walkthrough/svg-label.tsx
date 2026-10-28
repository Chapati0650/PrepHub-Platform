import type { ReactNode } from "react";

// Labels inside the walkthrough's SVG figures. KaTeX can't draw into SVG
// text, and a foreignObject full of KaTeX HTML is positioned wrongly in
// scaled SVG on older Safari, so labels use a small math typesetter of their
// own: italic letters, superscripts and subscripts (by dy, which every
// browser honours, unlike baseline-shift), and the handful of symbols a
// figure label needs. Anything fancier belongs in the working panel.

const SYMBOLS: Record<string, string> = {
  "\\circ": "°",
  "\\pi": "π",
  "\\theta": "θ",
  "\\alpha": "α",
  "\\beta": "β",
  "\\cdot": "·",
  "\\times": "×",
  "\\le": "≤",
  "\\leq": "≤",
  "\\ge": "≥",
  "\\geq": "≥",
  "\\ne": "≠",
  "\\neq": "≠",
  "\\approx": "≈",
  "\\infty": "∞",
  "\\angle": "∠",
  "\\triangle": "△",
  "\\ell": "ℓ",
  "\\,": " ",
  "\\;": " ",
  "\\%": "%",
};

/** Reads one group: {…} or a single character/command. Returns [text, nextIndex]. */
function group(tex: string, i: number): [string, number] {
  if (tex[i] === "{") {
    let depth = 0;
    for (let j = i; j < tex.length; j++) {
      if (tex[j] === "{") depth++;
      if (tex[j] === "}" && --depth === 0) return [tex.slice(i + 1, j), j + 1];
    }
    return [tex.slice(i + 1), tex.length];
  }
  if (tex[i] === "\\") {
    const m = /^\\[a-zA-Z]+|^\\./.exec(tex.slice(i));
    if (m) return [m[0], i + m[0].length];
  }
  return [tex[i] ?? "", i + 1];
}

type Run = { text: string; italic?: boolean; shift?: "sup" | "sub" };

function mathRuns(tex: string, shift?: "sup" | "sub"): Run[] {
  const runs: Run[] = [];
  const push = (text: string, italic = false) => {
    const last = runs[runs.length - 1];
    if (last && !!last.italic === italic && last.shift === shift) last.text += text;
    else runs.push({ text, italic, shift });
  };
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === "^" || c === "_") {
      const [inner, next] = group(tex, i + 1);
      runs.push(...mathRuns(inner, c === "^" ? "sup" : "sub"));
      i = next;
      continue;
    }
    if (c === "\\") {
      const [cmd, next] = group(tex, i);
      if (cmd === "\\frac" || cmd === "\\dfrac" || cmd === "\\tfrac") {
        const [num, a] = group(tex, next);
        const [den, b] = group(tex, a);
        // A case fraction, ³⁄₄, the way a printed figure sets one inline: a
        // plain "3/4t" can be read as 3 over 4t. Inside a script there's no
        // room to shrink further, so it falls back to a slash.
        if (shift) runs.push(...mathRuns(num, shift), { text: "/", shift }, ...mathRuns(den, shift));
        else runs.push(...mathRuns(num, "sup"), { text: "⁄" }, ...mathRuns(den, "sub"));
        i = b;
        continue;
      }
      if (cmd === "\\sqrt") {
        const [inner, a] = group(tex, next);
        push("√(");
        runs.push(...mathRuns(inner, shift));
        push(")");
        i = a;
        continue;
      }
      if (cmd === "\\text" || cmd === "\\mathrm") {
        const [inner, a] = group(tex, next);
        push(inner);
        i = a;
        continue;
      }
      push(SYMBOLS[cmd] ?? cmd.slice(1));
      i = next;
      continue;
    }
    if (c === "{" || c === "}") {
      i++;
      continue;
    }
    if (c === "-") push("−");
    else if (/[a-zA-Z]/.test(c)) push(c, true);
    else push(c);
    i++;
  }
  return runs;
}

/** A label's runs: plain text outside $…$, typeset math inside it. */
export function labelRuns(label: string): Run[] {
  const runs: Run[] = [];
  label.split(/(\$[^$]+\$)/g).forEach((part) => {
    if (!part) return;
    if (part.startsWith("$") && part.endsWith("$") && part.length > 1) runs.push(...mathRuns(part.slice(1, -1)));
    else runs.push({ text: part });
  });
  return runs;
}

// Rough advance widths in em, for placing labels clear of each other. They
// only have to rank positions, not set type, so a handful of classes will do.
function charWidth(ch: string): number {
  if (/[ilj.,:;'|!()[\]⁄]/.test(ch) || ch === " ") return 0.3;
  if (/[mwMW]/.test(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[−+=<>≤≥≈×·]/.test(ch)) return 0.62;
  return 0.54;
}

/** About how wide a label is drawn at `fontSize`, in the same units. */
export function labelWidth(label: string, fontSize: number): number {
  return labelRuns(label).reduce((sum, run) => sum + [...run.text].reduce((w, ch) => w + charWidth(ch), 0) * (run.shift ? 0.72 : 1), 0) * fontSize;
}

/** <tspan>s for a label; place inside a <text>. */
export function SvgLabelText({ label }: { label: string }): ReactNode {
  const runs = labelRuns(label);
  let shift: Run["shift"] = undefined;
  return runs.map((run, i) => {
    // dy is relative to the previous glyph, so move into and back out of a
    // script. Offsets are in the label's own em; a script tspan's em is 0.72
    // of that, so its dy is scaled up to land in the same place.
    const offset = (s: Run["shift"]) => (s === "sup" ? -0.34 : s === "sub" ? 0.24 : 0);
    const delta = offset(run.shift) - offset(shift);
    shift = run.shift;
    const dy = Math.round((run.shift ? delta / 0.72 : delta) * 100) / 100;
    return (
      <tspan
        key={i}
        dy={dy ? `${dy}em` : undefined}
        fontStyle={run.italic ? "italic" : undefined}
        fontSize={run.shift ? "0.72em" : undefined}
      >
        {run.text}
      </tspan>
    );
  });
}
