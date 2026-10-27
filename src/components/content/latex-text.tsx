import "katex/dist/katex.min.css";
import katex from "katex";
import { renderMarks } from "@/lib/content/passage-marks";

// PRD-013 §12: full LaTeX rendering in question text, answer choices, and
// written explanations, using $...$ (inline) and $$...$$ (block) delimiters —
// the conventional Markdown/LaTeX convention, since PRD-013 doesn't specify
// its own syntax. PRD-015 §14: must render safely against script injection —
// everything outside a math segment is HTML-escaped, and KaTeX's own output
// never interprets the source text as HTML.
//
// [[...]] marks a span of text as underlined — needed for SAT Reading &
// Writing "function of the underlined portion" / "which choice best revises
// the underlined portion" question types, which are meaningless without a
// visible underline somewhere in the stem. Added after a real question (a
// passage with an underlined sentence, asking about its rhetorical function)
// turned out to be unanswerable in Student Preview: there was no way to mark
// any text as underlined at all. Content inside [[...]] can still contain
// $...$ math, so it's rendered through the same math-aware pass rather than
// escaped as plain text.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: "htmlAndMathml" });
  } catch {
    return escapeHtml(tex);
  }
}

// A dollar sign that means money is written `\$`: "$\$49$" in math, or
// "costs \$4" in text. `$` is also the math delimiter, and the split below
// used to treat the escaped one as a delimiter too, so "$\$49$" rendered as a
// KaTeX error (the question bank's two priced word problems were rewritten to
// avoid it). It is swapped for a character that can't occur in content before
// splitting, then put back: as `\$` inside math, which KaTeX draws as a dollar
// sign, and as a plain "$" in text.
const MONEY = "\u0000";

export function renderLatexHtml(source: string): string {
  return renderSegments(source.replace(/\\\$/g, MONEY));
}

function renderSegments(source: string): string {
  const segments = source.split(/(\$\$[^$]+\$\$|\$[^$]+\$|\[\[[^\]]+\]\])/g);
  return segments
    .map((segment) => {
      if (segment.startsWith("$$") && segment.endsWith("$$") && segment.length > 3) {
        return renderMath(segment.slice(2, -2).replaceAll(MONEY, "\\$"), true);
      }
      if (segment.startsWith("$") && segment.endsWith("$") && segment.length > 1) {
        return renderMath(segment.slice(1, -1).replaceAll(MONEY, "\\$"), false);
      }
      if (segment.startsWith("[[") && segment.endsWith("]]") && segment.length > 3) {
        // Recurse so math delimiters still work inside an underlined span.
        return `<u>${renderSegments(segment.slice(2, -2))}</u>`;
      }
      // A walkthrough's highlights arrive as private-use markers (passage-marks.ts).
      // A blank (three or more underscores) gets its own element, so a
      // walkthrough can show a choice filled into it with an attribute and CSS
      // alone. The underscores stay in the text, so a student's saved
      // highlights, stored as character offsets, never shift.
      return renderMarks(
        escapeHtml(segment)
          .replaceAll(MONEY, "$")
          .replace(/\n/g, "<br />")
          .replace(/_{3,}/g, '<span class="latex-blank"><span class="latex-blank-line">$&</span></span>'),
      );
    })
    .join("");
}

export function LatexText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderLatexHtml(text) }} />;
}
