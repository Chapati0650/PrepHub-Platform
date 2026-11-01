import { notFound, redirect } from "next/navigation";
import { requireOwnedClassroom, requireTeacher } from "@/lib/teacher/access";
import { listOtherOpenClasses } from "@/lib/teacher/classrooms";
import { TeacherError } from "@/lib/teacher/errors";
import { searchQuestionBank } from "@/lib/teacher/question-bank";
import { ASSIGNMENT_MAX_QUESTIONS } from "@/lib/teacher/config";
import { StaffHeader, StaffPage } from "@/components/staff/staff-ui";
import { AssignmentBuilder } from "./assignment-builder";

export const metadata = { title: "New homework" };

export default async function NewAssignmentPage({ params }: { params: Promise<{ classId: string }> }) {
  const context = await requireTeacher();
  const { classId } = await params;

  let classroom;
  try {
    classroom = await requireOwnedClassroom(context, classId);
  } catch (err) {
    if (err instanceof TeacherError) notFound();
    throw err;
  }
  if (classroom.archivedAt) redirect(`/teacher/classes/${classId}`);

  // The first page of the bank comes with the page, so the builder never
  // opens on an empty list waiting for a request. The teacher's other open
  // classes are offered as "also assign to": one homework for five periods.
  const [initialResults, otherClasses] = await Promise.all([
    searchQuestionBank({}, 1, classId),
    listOtherOpenClasses(context, classId),
  ]);

  return (
    <StaffPage className="max-w-6xl">
      <StaffHeader
        back={{ href: `/teacher/classes/${classId}`, label: classroom.name }}
        eyebrow="New homework"
        title="Assign homework"
        description={`Pick up to ${ASSIGNMENT_MAX_QUESTIONS} questions from PrepHub's question bank, give it a title and a due date, and assign it. Give it as practice (an explanation after each answer) or as a quiz (answers shown once it's turned in), and see how each student did.`}
      />
      <AssignmentBuilder
        classroomId={classId}
        className={classroom.name}
        otherClasses={otherClasses}
        initialResults={initialResults}
        maxQuestions={ASSIGNMENT_MAX_QUESTIONS}
      />
    </StaffPage>
  );
}
