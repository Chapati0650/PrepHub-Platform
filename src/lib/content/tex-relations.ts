// Where the top-level relations (=, <, >, \le, \approx …) are in a piece of
// TeX: the places a line of maths may be broken the way it's written on paper.
// A relation inside braces or \left…\right doesn't count. Shared by the
// walkthrough's working panel (aligning and breaking lines) and LatexText
// (breaking a long inline expression only at its = signs).

const RELATIONS = new Set(["\\le", "\\leq", "\\ge", "\\geq", "\\ne", "\\neq", "\\approx", "\\lt", "\\gt", "\\equiv"]);

export type RelationCut = { at: number; length: number; relation: string };

export function relationCuts(tex: string): RelationCut[] {
  let depth = 0;
  const cuts: RelationCut[] = [];
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      const command = tex.slice(i).match(/^\\[a-zA-Z]+/)?.[0];
      if (!command) {
        i += 1; // an escaped character: \{, \$, \,
        continue;
      }
      if (command === "\\left") depth++;
      else if (command === "\\right") depth = Math.max(0, depth - 1);
      else if (depth === 0 && RELATIONS.has(command)) cuts.push({ at: i, length: command.length, relation: command });
      i += command.length - 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === "=" || ch === "<" || ch === ">")) cuts.push({ at: i, length: 1, relation: ch });
  }
  return cuts;
}

/**
 * An expression cut after each top-level relation: "a = b + c = d" becomes
 * ["a =", "b + c =", "d"]. Each piece is set whole, so a long equation wraps
 * between "=" and what follows it, never inside a bracket.
 */
export function breakAfterRelations(tex: string): string[] {
  const pieces: string[] = [];
  let from = 0;
  for (const cut of relationCuts(tex)) {
    pieces.push(tex.slice(from, cut.at + cut.length).trim());
    from = cut.at + cut.length;
  }
  pieces.push(tex.slice(from).trim());
  return pieces.filter(Boolean);
}
