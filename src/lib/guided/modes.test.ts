import { describe, it, expect } from "vitest";
import type { GuidedCommand } from "./control";
import { EACH_STUDENTS_WEAKEST, MODE_LABELS, commandAllowed, sessionSkillLabel } from "./modes";

const ALL_COMMANDS: GuidedCommand["type"][] = [
  "NEXT", "TALK", "REVOTE", "REVEAL", "EXPLAIN", "TWIN", "STEP", "ADD_TIME", "PAUSE", "SKIP", "OWN", "RECAP", "END", "ENTER_ANSWER",
];

describe("commandAllowed", () => {
  it("leaves teacher-led sessions exactly as they were: every command works", () => {
    for (const type of ALL_COMMANDS) expect(commandAllowed("TEACHER_LED", type), type).toBe(true);
  });

  it("allows only pausing the screens and ending in individual practice", () => {
    const allowed = ALL_COMMANDS.filter((type) => commandAllowed("INDIVIDUAL", type));
    expect(allowed).toEqual(["PAUSE", "END"]);
  });
});

describe("labels", () => {
  it("names the two modes", () => {
    expect(MODE_LABELS).toEqual({ TEACHER_LED: "Teacher-led", INDIVIDUAL: "Individual practice" });
  });
  it("shows a skill, or says each student has their own", () => {
    expect(sessionSkillLabel({ category: "ALGEBRA", perStudentSkills: false })).toBe("Algebra");
    expect(sessionSkillLabel({ category: "ALGEBRA", perStudentSkills: true })).toBe(EACH_STUDENTS_WEAKEST);
  });
});
