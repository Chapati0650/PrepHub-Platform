import { prisma } from "@/lib/prisma";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getSchoolCommunityData } from "@/lib/community/school-community-data";
import { localDateInputValue } from "@/lib/community/goal";
import { GoalCard } from "@/components/community/goal-card";
import { GoalEditor } from "@/components/community/goal-editor";
import { StaffHeader, StaffNote, StaffPage, StaffUnavailable } from "@/components/staff/staff-ui";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { saveSchoolGoalAction } from "./actions";

// One goal the whole school works toward, with a prize if the school offers
// one (2026-10-24). The Administrator sets it here; students see it on School
// Community. Progress is a school total — nothing on either page can name a
// student, which is the same aggregate-only line as the rest of this area.
export default async function SchoolGoalPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) return <StaffUnavailable title="The community goal isn't available for this account." />;

  const [org, community] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: schoolId },
      select: { communityGoalMetric: true, communityGoalTarget: true, communityGoalPrize: true, communityGoalEndsAt: true },
    }),
    getSchoolCommunityData(schoolId),
  ]);

  return (
    <StaffPage>
      {viewingAsOwner && <OwnerSchoolSwitcher basePath="/admin/goal" schools={availableSchools} currentSchoolId={schoolId} />}

      <StaffHeader
        eyebrow="Your school"
        title="Community goal"
        description="One target your whole school works toward together, like 5,000 questions answered by winter break. Every student sees the progress on their School Community page. A prize, such as a pizza party or a spirit day, is what makes it worth chasing."
      />

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <section aria-labelledby="goal-form-heading" className="flex flex-col gap-4">
          <h2 id="goal-form-heading" className="text-xl">
            {community.goal ? "Change the goal" : "Set a goal"}
          </h2>
          {viewingAsOwner ? (
            <p className="text-base text-muted-foreground">
              This is a read-only preview. Edit the goal from this school&apos;s page under Schools.
            </p>
          ) : (
            <div className="rounded-2xl border border-border p-5 sm:p-6">
              <GoalEditor
                action={saveSchoolGoalAction}
                initial={{
                  metric: org.communityGoalMetric,
                  target: org.communityGoalTarget,
                  prize: org.communityGoalPrize,
                  endsOn: localDateInputValue(org.communityGoalEndsAt),
                }}
              />
            </div>
          )}
        </section>

        <section aria-labelledby="goal-preview-heading" className="flex flex-col gap-4 lg:sticky lg:top-8">
          <h2 id="goal-preview-heading" className="text-xl">
            What students see
          </h2>
          {community.goal ? (
            <GoalCard goal={community.goal} />
          ) : (
            <StaffNote>
              No goal is set, so students don&apos;t see one yet. Schools usually pick a number a few weeks of normal
              practice would reach, and a prize the whole school gets.
            </StaffNote>
          )}
          <p className="text-base text-muted-foreground">
            Progress counts every registered student&apos;s work as one school total. No student is ever named.
          </p>
        </section>
      </div>
    </StaffPage>
  );
}
