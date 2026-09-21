import { hasPaidAccess } from "@/lib/entitlements";

// The free tier is the Diagnostic plus the first Practice Set (Owner
// decision, 2026-09-21). Production numbers behind it: of 41 students who
// finished the Diagnostic, 38 had a generated Set 1 sitting locked and
// never answered a single practice question; 3 paid. The set is the
// product — a student who has felt their prediction move is the one who
// subscribes, so the paywall now sits at Set 2, after that moment.
//
// This composes the one entitlement service rather than replacing it:
// hasPaidAccess still decides "paid"; this only says which sets are free.
export const FREE_PRACTICE_SETS = 1;

export function isFreePracticeSet(setNumber: number): boolean {
  return setNumber <= FREE_PRACTICE_SETS;
}

export async function canOpenPracticeSet(studentId: string, setNumber: number): Promise<boolean> {
  if (isFreePracticeSet(setNumber)) return true;
  return hasPaidAccess(studentId);
}
