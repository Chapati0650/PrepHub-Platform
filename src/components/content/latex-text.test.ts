import { describe, expect, it } from "vitest";
import { renderLatexHtml } from "@/components/content/latex-text";

describe("renderLatexHtml", () => {
  it("escapes plain text with no LaTeX", () => {
    expect(renderLatexHtml("plain text")).toBe("plain text");
  });

  it("escapes HTML-significant characters in plain text", () => {
    expect(renderLatexHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("renders inline math delimited by single dollar signs", () => {
    const html = renderLatexHtml("The answer is $x^2$.");
    expect(html).toContain("katex");
    expect(html).not.toContain("$x^2$");
  });

  it("renders block math delimited by double dollar signs", () => {
    const html = renderLatexHtml("$$\\frac{1}{2}$$");
    expect(html).toContain("katex-display");
  });

  it("does not let LaTeX source smuggle raw HTML into the output", () => {
    const html = renderLatexHtml("$<img src=x onerror=alert(1)>$");
    expect(html).not.toContain("<img");
  });

  it("preserves surrounding plain text around a math segment", () => {
    const html = renderLatexHtml("Solve: $x+1=2$ for x.");
    expect(html.startsWith("Solve: ")).toBe(true);
    expect(html.endsWith(" for x.")).toBe(true);
  });
});
