import { DIAGNOSTIC_ABILITY_INITIALIZATION, diagnosticPatternKey } from "./config";

// PRD-014 §5 — the diagnostic's Easy/Medium/Hard result pattern in one
// category maps to that category's initial Ability Score. Distinct from the
// PRD-016 diagnostic *score* table — the same response pattern intentionally
// produces two different numbers for two different purposes.
export function initialAbilityFromDiagnostic(easyCorrect: boolean, mediumCorrect: boolean, hardCorrect: boolean): number {
  const key = diagnosticPatternKey(easyCorrect, mediumCorrect, hardCorrect);
  const value = DIAGNOSTIC_ABILITY_INITIALIZATION[key];
  if (value === undefined) throw new Error(`No diagnostic ability mapping for pattern ${key}`);
  return value;
}
