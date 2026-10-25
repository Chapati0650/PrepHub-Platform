import { prisma } from "@/lib/prisma";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getSchoolCommunityData } from "@/lib/community/school-community-data";
import { localDateInputValue } from "@/lib/community/goal";
import { PageHeader } from "@/components/page-header";
import { GoalCard } from "@/components/community/goal-card";
import { GoalEditor } from "@/components/community/goal-editor";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { saveSchoolGoalAction } from "./actions";

// One goal the whole school works toward, with a prize if the school offers
// one (2026-10-24). The Administrator sets it here; students see it on School
// Community. Progress is a school total — nothing on either page can name a
// student, which is the same aggregate-only line as the rest of this area.
export default async function SchoolGoalPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
        <h1 className="text-xl sm:text-2xl">Community Goal isn&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const [org, community] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: schoolId },
      select: { communityGoalMetric: true, communityGoalTarget: true, communityGoalPrize: true, communityGoalEndsAt: true },
    }),
    getSchoolCommunityData(schoolId),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/goal" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      <PageHeader
        eyebrow="Administrator"
        title="Community Goal"
        description="One target your whole school works toward together, shown to every student on School Community. A prize — a pizza party, a spirit day — is what makes it worth chasing."
      />

      {community.goal ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">What students see</p>
          <GoalCard goal={community.goal} />
        </div>
      ) : (
        <p className="border-l-2 border-marker pl-3 text-sm text-muted-foreground">
          No goal is set. Schools that set one usually pick a number a few weeks of normal studying would reach,
          and a prize the whole school gets.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{community.goal ? "Change the goal" : "Set a goal"}</h2>
        {viewingAsOwner ? (
          <p className="text-sm text-muted-foreground">
            This is a read-only preview. Edit the goal from this school&apos;s page under Schools.
          </p>
        ) : (
          <div className="rounded-2xl border border-border p-5">
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
      </div>

      <p className="text-xs text-muted-foreground">
        Progress counts every registered student&apos;s work across PrepHub — practice, homework, the Daily Challenge
        and the rest — as one school total. No student is ever named.
      </p>
    </div>
  );
}
