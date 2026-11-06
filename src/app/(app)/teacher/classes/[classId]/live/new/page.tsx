import { notFound, redirect } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { TeacherError } from "@/lib/teacher/errors";
import { getSessionSetup } from "@/lib/guided/create";
import { GuidedError } from "@/lib/guided/errors";
import { MIN_STUDENTS_FOR_PICK } from "@/lib/guided/config";
import { StaffHeader, StaffPage } from "@/components/staff/staff-ui";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Start a Guided Session" };

export default async function NewGuidedSessionPage({ params }: { params: Promise<{ classId: string }> }) {
  const context = await requireTeacher();
  const { classId } = await params;
  let setup;
  try {
    setup = await getSessionSetup(context, classId);
  } catch (err) {
    if ((err instanceof TeacherError && err.code === "NOT_FOUND") || err instanceof GuidedError) notFound();
    throw err;
  }
  if (setup.openSessionId) redirect(`/teacher/live/${setup.openSessionId}`);

  return (
    <StaffPage>
      <StaffHeader
        back={{ href: `/teacher/classes/${classId}`, label: setup.classroom.name }}
        eyebrow="Guided Session"
        title="Start a Guided Session"
        description={
          <>
            You run it from the front: the questions go on the projector and onto every student&apos;s screen at once.
            Students answer alone, talk it over or watch you explain, and finish with questions picked for each of
            them. About 30 minutes.
          </>
        }
      />
      <SetupForm
        classroomId={classId}
        rosterSize={setup.rosterSize}
        picks={setup.picks}
        minStudents={MIN_STUDENTS_FOR_PICK}
      />
    </StaffPage>
  );
}
