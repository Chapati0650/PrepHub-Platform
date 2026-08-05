import katex from "katex";

// PRD-013 §12: full LaTeX rendering in question text, answer choices, and
// written explanations, using $...$ (inline) and $$...$$ (block) delimiters —
// the conventional Markdown/LaTeX convention, since PRD-013 doesn't specify
// its own syntax. PRD-015 §14: must render safely against script injection —
// everything outside a math segment is HTML-escaped, and KaTeX's own output
// never interprets the source text as HTML.
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
  const segments = source.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
  return segments
    .map((segment) => {
      if (segment.startsWith("$$") && segment.endsWith("$$") && segment.length > 3) {
        return renderMath(segment.slice(2, -2), true);
      }
      if (segment.startsWith("$") && segment.endsWith("$") && segment.length > 1) {
        return renderMath(segment.slice(1, -1), false);
      }
      return escapeHtml(segment).replace(/\n/g, "<br />");
    })
    .join("");
}

export function LatexText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderLatexHtml(text) }} />;
}
