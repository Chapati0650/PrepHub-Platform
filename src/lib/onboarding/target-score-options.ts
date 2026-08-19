import { SCORE_RANGES } from "@/lib/score/config";

// Onboarding wizard's Target Score step deliberately only offers realistic
// goal ranges — PrepHub is positioned as a serious prep tool, so showing the
// full 400-1600 spread (including ranges no admitted student is targeting)
// just adds noise to the one question meant to set a meaningful goal.
export const ONBOARDING_MIN_TARGET_SCORE = 1020;

export const ONBOARDING_SCORE_RANGES = SCORE_RANGES.filter((range) => range.scoreMin >= ONBOARDING_MIN_TARGET_SCORE);
