import { diagnosticPatternKey } from "@/lib/adaptive/config";
import { DIAGNOSTIC_PATTERN_VALUES } from "./config";

// PRD-016 §5.1 — deliberately separate from PRD-014's ability-initialization
// table; the same Easy/Medium/Hard pattern intentionally maps to a different
// number here. Reuses PRD-014's key format so both tables read one pattern.
export function diagnosticValueFor(easyCorrect: boolean, mediumCorrect: boolean, hardCorrect: boolean): number {
  const key = diagnosticPatternKey(easyCorrect, mediumCorrect, hardCorrect);
  const value = DIAGNOSTIC_PATTERN_VALUES[key];
  if (value === undefined) throw new Error(`No diagnostic score value configured for pattern ${key}`);
  return value;
}
