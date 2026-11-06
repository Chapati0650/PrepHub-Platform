import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listOpenSessionsForStudent } from "@/lib/guided/queries";
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
  const open = await listOpenSessionsForStudent(session.user.id);

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

      <section aria-labelledby="code-heading" className="flex flex-col gap-3">
        <h2 id="code-heading" className="text-xl">
          Have a code?
        </h2>
        <JoinCodeForm />
      </section>
    </div>
  );
}
