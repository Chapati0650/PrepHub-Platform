import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSharedState } from "@/lib/guided/state";
import { getPersonalState, getStudentRecap, getStudentSession } from "@/lib/guided/student";
import { StudentSession } from "./student-session";
import { RecapView } from "./recap-view";

export const metadata = { title: "Guided Session" };

export default async function GuidedSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  const { sessionId } = await params;
  if (!session?.user?.id) redirect(`/login?next=/live/${sessionId}`);
  if (session.user.role !== "STUDENT") redirect("/home");
  const studentId = session.user.id;

  const found = await getStudentSession(studentId, sessionId);
  if (!found) notFound();
  if (!found.enrolled) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-8">
        <div className="rounded-3xl bg-surface-tint p-6 sm:p-10">
          <h1 className="text-page-title">This session is for another class</h1>
          <p className="mt-3 text-lg text-foreground/80">
            It&apos;s running for {found.classroom.name}. If that&apos;s your class, join it first, then come back.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {!found.classroom.archivedAt && (
              <Link
                href={`/join/${found.classroom.joinCode}`}
                className="inline-flex h-12 items-center rounded-full bg-primary px-6 text-base font-medium text-primary-foreground"
              >
                Join the class
              </Link>
            )}
            <Link href="/home" className="inline-flex h-12 items-center rounded-full border border-border px-6 text-base font-medium">
              Back to your dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (found.status === "ENDED") {
    const recap = await getStudentRecap(studentId, sessionId);
    return <RecapView recap={recap} />;
  }

  const [shared, mine] = await Promise.all([getSharedState(found.stateKey), getPersonalState(studentId, sessionId)]);
  return <StudentSession sessionId={sessionId} stateKey={found.stateKey} initialShared={shared} initialMine={mine} />;
}
