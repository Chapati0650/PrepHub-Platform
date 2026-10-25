import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwnedClassroom, requireTeacher } from "@/lib/teacher/access";
import { TeacherError } from "@/lib/teacher/errors";
import { searchQuestionBank } from "@/lib/teacher/question-bank";
import { ASSIGNMENT_MAX_QUESTIONS } from "@/lib/teacher/config";
import { AssignmentBuilder } from "./assignment-builder";

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
  // opens on an empty list waiting for a request.
  const initialResults = await searchQuestionBank({}, 1);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 pb-16 sm:p-8">
      <div className="flex flex-col gap-2">
        <Link href={`/teacher/classes/${classId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {classroom.name}
        </Link>
        <h1 className="text-page-title sm:text-page-title-lg">Assign homework</h1>
        <p className="max-w-2xl text-muted-foreground">
          Pick up to {ASSIGNMENT_MAX_QUESTIONS} questions from PrepHub&apos;s published bank. Students see them in
          the order you set, with an explanation after each answer, and you see how each student did.
        </p>
      </div>
      <AssignmentBuilder classroomId={classId} initialResults={initialResults} maxQuestions={ASSIGNMENT_MAX_QUESTIONS} />
    </div>
  );
}
