import { describe, it, expect } from "vitest";
import type { QuestionCategory } from "@/generated/prisma/client";
import { CATEGORY_ORDER } from "@/lib/content/constants";
import { median, pickSkill, SKILL_LINES, tsiAbilityLine, type StudentSkillLevels } from "./pick-skill";

/** A student at `base` in every skill, with some skills overridden. */
function student(overrides: Partial<Record<QuestionCategory, number>> = {}, base = 70): StudentSkillLevels {
  const levels: StudentSkillLevels = {};
  for (const c of CATEGORY_ORDER) levels[c] = base;
  return { ...levels, ...overrides };
}

/**
 * Twelve students. Geometry has the lowest average (four far behind) but only
 * four below the line; Advanced Math has ten just under it.
 */
function splitClass(): StudentSkillLevels[] {
  return [
    ...Array.from({ length: 4 }, () => student({ GEOMETRY_TRIGONOMETRY: 2, ADVANCED_MATH: 40 })),
    ...Array.from({ length: 6 }, () => student({ GEOMETRY_TRIGONOMETRY: 50, ADVANCED_MATH: 40 })),
    ...Array.from({ length: 2 }, () => student({ GEOMETRY_TRIGONOMETRY: 50, ADVANCED_MATH: 80 })),
  ];
}

describe("tsiAbilityLine", () => {
  it("finds the skill level that predicts 480 in Reading & Writing and 530 in Math", () => {
    expect(tsiAbilityLine(480)).toBe(39);
    expect(tsiAbilityLine(530)).toBe(43);
    expect(SKILL_LINES).toEqual({ READING_WRITING: 39, MATH: 43 });
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("pickSkill", () => {
  it("counts students below the line instead of averaging", () => {
    const result = pickSkill({ students: splitClass() });
    const geometry = result.ranked.find((r) => r.category === "GEOMETRY_TRIGONOMETRY")!;
    const advanced = result.ranked.find((r) => r.category === "ADVANCED_MATH")!;
    // Geometry has the lower average...
    expect(geometry.average!).toBeLessThan(advanced.average!);
    // ...but Advanced Math is the one most of the room needs.
    expect(advanced.below).toBe(10);
    expect(geometry.below).toBe(4);
    expect(result.pick).toBe("ADVANCED_MATH");
    expect(advanced.priority).toBeCloseTo(10 * 0.35);
  });

  it("refuses to suggest a skill for fewer than ten measured students", () => {
    const result = pickSkill({ students: splitClass().slice(0, 9) });
    expect(result.ready).toBe(false);
    expect(result.pick).toBeNull();
    expect(result.alternatives).toEqual([]);
    expect(result.measured).toBe(9);
    // The ranking is still there for the teacher to choose from.
    expect(result.ranked).toHaveLength(7);
  });

  it("doesn't count students without a Diagnostic", () => {
    const result = pickSkill({ students: [...splitClass().slice(0, 9), {}, {}] });
    expect(result.measured).toBe(9);
    expect(result.ready).toBe(false);
  });

  it("counts a skill from the last session at half, so sessions vary", () => {
    const students = splitClass().map((s, i) => (i < 7 ? { ...s, ALGEBRA: 30 } : s));
    // Advanced Math 10 × 0.35 = 3.5 → 1.75 when recent; Algebra 7 × 0.35 = 2.45.
    const result = pickSkill({ students, recentCategories: ["ADVANCED_MATH"] });
    expect(result.pick).toBe("ALGEBRA");
    expect(result.ranked.find((r) => r.category === "ADVANCED_MATH")!.recent).toBe(true);
    expect(result.alternatives[0]).toBe("ADVANCED_MATH");
  });

  it("limits the pick to one section when asked", () => {
    const students = splitClass().map((s, i) => (i < 5 ? { ...s, GRAMMAR: 20 } : s));
    const result = pickSkill({ students, section: "READING_WRITING" });
    expect(result.pick).toBe("GRAMMAR");
    expect(result.ranked.map((r) => r.section)).toEqual(["READING_WRITING", "READING_WRITING", "READING_WRITING"]);
  });

  it("leads with the lowest skill when nobody is below the line anywhere", () => {
    const students = Array.from({ length: 10 }, () => student({ VOCABULARY: 55 }, 80));
    const result = pickSkill({ students });
    expect(result.ranked.every((r) => r.below === 0)).toBe(true);
    expect(result.pick).toBe("VOCABULARY");
  });

  it("offers the next two skills as alternatives", () => {
    const result = pickSkill({ students: splitClass() });
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives).not.toContain(result.pick);
    expect(result.alternatives[0]).toBe("GEOMETRY_TRIGONOMETRY");
  });

  it("reports the middle student's level for pitching the questions", () => {
    const result = pickSkill({ students: splitClass() });
    expect(result.ranked.find((r) => r.category === "ADVANCED_MATH")!.median).toBe(40);
  });
});
