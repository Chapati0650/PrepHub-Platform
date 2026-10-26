import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { listTeachers } from "@/lib/teacher/accounts";
import { TeachersPanel } from "@/components/teacher/teachers-panel";
import { StaffHeader, StaffPage, StaffSection, StaffSteps, StaffUnavailable } from "@/components/staff/staff-ui";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { inviteTeacherAction, removeTeacherAction, resendTeacherInviteAction } from "./actions";

// The school's teachers (2026-10-24). An Administrator adds them by email;
// each teacher runs their own classes and homework. What this page shows is
// counts — classes and students per teacher — never a student's results,
// which stay between the student and the teacher who assigned the work.
export default async function AdminTeachersPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) return <StaffUnavailable title="Teachers aren't available for this account." />;

  const teachers = await listTeachers(schoolId);

  return (
    <StaffPage>
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/teachers" schools={availableSchools} currentSchoolId={schoolId} />
      )}
      <StaffHeader
        eyebrow="Your school"
        title="Teachers"
        description="Teachers make classes, give students a code to join, and assign PrepHub questions as homework. They see results on the homework they assign. You see how many classes and students each one has, never anyone's results."
      />

      {teachers.length === 0 && (
        <StaffSection title="How it works">
          <StaffSteps
            steps={[
              {
                title: "Add a teacher with their school email",
                body: "Use the form below. It takes a few seconds per teacher.",
              },
              {
                title: "They set their password from an email",
                body: "PrepHub sends them a link right away. If your school uses Google, they can sign in with Google instead.",
              },
              {
                title: "They make a class and share its code",
                body: "Students type the six-character code into PrepHub to join, then see their teacher's homework.",
              },
            ]}
          />
        </StaffSection>
      )}

      <TeachersPanel
        teachers={teachers}
        invite={inviteTeacherAction}
        resend={resendTeacherInviteAction}
        remove={removeTeacherAction}
        readOnly={viewingAsOwner}
      />
    </StaffPage>
  );
}
