import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { listTeachers } from "@/lib/teacher/accounts";
import { PageHeader } from "@/components/page-header";
import { TeachersPanel } from "@/components/teacher/teachers-panel";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { inviteTeacherAction, removeTeacherAction, resendTeacherInviteAction } from "./actions";

// The school's teachers (2026-10-24). An Administrator adds them by email;
// each teacher runs their own classes and homework. What this page shows is
// counts — classes and students per teacher — never a student's results,
// which stay between the student and the teacher who assigned the work.
export default async function AdminTeachersPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
        <h1 className="text-xl sm:text-2xl">Teachers aren&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const teachers = await listTeachers(schoolId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/teachers" schools={availableSchools} currentSchoolId={schoolId} />
      )}
      <PageHeader
        eyebrow="Administrator"
        title="Teachers"
        description="Teachers make classes, give students a code to join, and assign PrepHub questions as homework with a due date. They see results on the homework they assign; this page shows you how many classes and students each has."
      />
      <TeachersPanel
        teachers={teachers}
        invite={inviteTeacherAction}
        resend={resendTeacherInviteAction}
        remove={removeTeacherAction}
        readOnly={viewingAsOwner}
      />
    </div>
  );
}
