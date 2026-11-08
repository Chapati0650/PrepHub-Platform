import type { GuidedSessionMode, QuestionCategory } from "@/generated/prisma/client";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { GuidedCommand } from "./control";

/**
 * The two ways to run a Guided Session. Pure, so the rules are tested.
 *
 * - TEACHER_LED: one adult paces the room (the original session).
 * - INDIVIDUAL: every student works through their own questions at their own
 *   speed; the teacher monitors. There is no room to pace, so the only
 *   commands that make sense are pausing the screens and ending.
 */
export const MODE_LABELS: Record<GuidedSessionMode, string> = {
  TEACHER_LED: "Teacher-led",
  INDIVIDUAL: "Individual practice",
};

const INDIVIDUAL_COMMANDS: ReadonlySet<GuidedCommand["type"]> = new Set(["PAUSE", "END"]);

export function commandAllowed(mode: GuidedSessionMode, type: GuidedCommand["type"]): boolean {
  return mode === "TEACHER_LED" || INDIVIDUAL_COMMANDS.has(type);
}

export const EACH_STUDENTS_WEAKEST = "Each student's weakest skills";

/** The skill line shown for a session: one skill, or "each student's weakest skills". */
export function sessionSkillLabel(session: { category: QuestionCategory; perStudentSkills: boolean }): string {
  return session.perStudentSkills ? EACH_STUDENTS_WEAKEST : CATEGORY_LABELS[session.category];
}
