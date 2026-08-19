import katex from "katex";

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

export function renderLatexHtml(source: string): string {
  const segments = source.split(/(\$\$[^$]+\$\$|\$[^$]+\$|\[\[[^\]]+\]\])/g);
  return segments
    .map((segment) => {
      if (segment.startsWith("$$") && segment.endsWith("$$") && segment.length > 3) {
        return renderMath(segment.slice(2, -2), true);
      }
      if (segment.startsWith("$") && segment.endsWith("$") && segment.length > 1) {
        return renderMath(segment.slice(1, -1), false);
      }
      if (segment.startsWith("[[") && segment.endsWith("]]") && segment.length > 3) {
        // Recurse so math delimiters still work inside an underlined span.
        return `<u>${renderLatexHtml(segment.slice(2, -2))}</u>`;
      }
      return escapeHtml(segment).replace(/\n/g, "<br />");
    })
    .join("");
}

export function LatexText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderLatexHtml(text) }} />;
}
