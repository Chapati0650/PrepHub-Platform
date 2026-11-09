import { SCORE_RANGES } from "@/lib/score/config";

// Onboarding wizard's Target Score step deliberately only offers realistic
// goal ranges — PrepHub is positioned as a serious prep tool, so showing the
// full 400-1600 spread (including ranges no admitted student is targeting)
// just adds noise to the one question meant to set a meaningful goal.
// Since 2026-11-09 the lowest choice is 970-1040, which holds 1010: 480 + 530, the Texas college-ready
// (TSI) benchmark a district student's first goal often is (review: the lowest choice was 1050-1120,
// above the TSI line and above where many juniors start).
export const ONBOARDING_MIN_TARGET_SCORE = 970;

/** The total that meets both Texas college-ready (TSI) section benchmarks, 480 + 530. */
export const TSI_TOTAL = 1010;

export const ONBOARDING_SCORE_RANGES = SCORE_RANGES.filter((range) => range.scoreMin >= ONBOARDING_MIN_TARGET_SCORE);
