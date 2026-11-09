import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listOpenSessionsForStudent, pastSessionsForStudent, recentSessionsWithWork } from "@/lib/guided/queries";
import { formatGoalDate } from "@/lib/community/goal";
import { JoinCodeForm } from "./join-code-form";

export const metadata = { title: "Guided Session" };

/**
 * Where a student lands from the board's "Go to prephubtp.com/live". A
 * session in one of their classes is a button away; anyone else types the
 * code from the board.
 */
export default async function LivePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/live");
  if (session.user.role !== "STUDENT") redirect("/home");
  const [open, past, withWork] = await Promise.all([
    listOpenSessionsForStudent(session.user.id),
    pastSessionsForStudent(session.user.id),
    recentSessionsWithWork(session.user.id),
  ]);
  const workFor = new Map(withWork.map((w) => [w.id, w]));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <header className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <h1 className="text-page-title sm:text-page-title-lg">Guided Session</h1>
        <p className="mt-3 max-w-xl text-lg text-foreground/80">
          {open.length > 0
            ? "Your teacher has a session running. Join it below."
            : "Nothing is running in your classes right now. If your teacher has a code on the board, type it here."}
        </p>
      </header>

      {open.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {open.map((s) => (
            <li key={s.id}>
              <Link href={`/live/${s.id}`} className="flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:bg-muted/40">
                <span>
                  <span className="block text-lg font-medium">{s.className}</span>
                  <span className="text-base text-muted-foreground">{s.teacherName}</span>
                </span>
                <span className="inline-flex h-12 items-center rounded-full bg-primary px-6 text-base font-medium text-primary-foreground">
                  {s.joined ? "Go back in" : "Join"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <section aria-labelledby="past-heading" className="flex flex-col gap-3">
          <h2 id="past-heading" className="text-xl">
            Your recent sessions
          </h2>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {past.map((s) => {
              const work = workFor.get(s.id);
              const owed = work ? work.toCatchUp + work.toRetry : 0;
              return (
                <li key={s.id}>
                  <Link href={`/live/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40">
                    <span className="min-w-0">
                      <span className="block font-medium">{s.skill}</span>
                      <span className="text-sm text-muted-foreground">
                        {s.className} · {formatGoalDate(s.endedAt)}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-primary">
                      {owed > 0 ? `${owed} to try again →` : "Review →"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="code-heading" className="flex flex-col gap-3">
        <h2 id="code-heading" className="text-xl">
          Have a code?
        </h2>
        <JoinCodeForm />
      </section>
    </div>
  );
}
