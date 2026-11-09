import { CATEGORY_LABELS } from "@/lib/content/labels";
import { sectionOf } from "@/lib/guided/config";
import { MIN_GROUP_SIZE, MIN_STUDENTS_FOR_SCORE_FIGURES } from "@/lib/admin/impact";
import type { SkillGaps } from "@/lib/admin/skill-gaps";
import { StaffNote, StaffSection } from "@/components/staff/staff-ui";

/**
 * Where students fall short, by skill (2026-11-09): one row per tested skill, students below the
 * college-ready level in it as a count and a bar, biggest gap first. Counts only.
 */
export function SkillGapsSection({ gaps, note }: { gaps: SkillGaps; note?: string }) {
  if (!gaps) {
    return (
      <StaffSection title="Where students fall short, by skill">
        <StaffNote>
          Appears once {MIN_STUDENTS_FOR_SCORE_FIGURES} students have finished the Diagnostic, which places each of them in
          all seven tested skills.
        </StaffNote>
      </StaffSection>
    );
  }
  return (
    <StaffSection
      title="Where students fall short, by skill"
      description={
        <>
          Of the {gaps.measured.toLocaleString()} students who have taken the Diagnostic, how many are below the
          college-ready level in each tested skill: the level that, across its section, predicts 480 in Reading &amp;
          Writing or 530 in Math. Most students below first.{note ? ` ${note}` : ""}
        </>
      }
    >
      <div className="break-inside-avoid rounded-2xl border border-border p-5">
        <ul className="flex flex-col gap-3">
          {gaps.skills.map((s) => (
            <li key={s.category} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[14rem_1fr_9rem] sm:gap-4">
              <p className="text-base font-medium">
                {CATEGORY_LABELS[s.category]}
                <span className="block text-sm font-normal text-muted-foreground">
                  {sectionOf(s.category) === "MATH" ? "Math" : "Reading & Writing"}
                </span>
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-surface-tint" aria-hidden>
                {s.share !== null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(s.share * 100)}%` }} />}
              </div>
              <p className="text-base tabular-nums sm:text-right">
                {s.below === null ? `Fewer than ${MIN_GROUP_SIZE}` : `${s.below.toLocaleString()} below`}
                {s.share !== null && <span className="ml-1 text-sm text-muted-foreground">({Math.round(s.share * 100)}%)</span>}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-muted-foreground">
        Teachers can run a Guided Session on any of these skills; PrepHub suggests the one where the most of a class has
        points to gain. Skill levels are PrepHub estimates from the Diagnostic and practice since.
      </p>
    </StaffSection>
  );
}
