import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { previewJoin } from "@/lib/teacher/homework";
import { JoinClassForm } from "@/app/(app)/homework/join-class-form";

// A teacher's join link. Signed out, middleware sends the visitor to sign up
// with the code parked in a cookie, and /home brings them back here once
// they're in. Joining is a button press, not a page view: a link previewed in
// an email or chat app must never put someone on a roster.
export default async function JoinClassPage({ params }: { params: Promise<{ code: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { code } = await params;

  if (session.user.role !== "STUDENT") {
    return (
      <Shell>
        <h1 className="text-page-title">Classes are for student accounts.</h1>
        <p className="mt-3 text-muted-foreground">
          This link adds a student to a class. You&apos;re signed in with a {session.user.role === "TEACHER" ? "teacher" : "staff"} account —
          sign in with a student account to join.
        </p>
      </Shell>
    );
  }

  const preview = await previewJoin(session.user.id, code);
  if (preview?.alreadyIn) redirect("/homework");

  if (!preview) {
    return (
      <Shell>
        <h1 className="text-page-title">That class code doesn&apos;t work.</h1>
        <p className="mt-3 text-muted-foreground">
          The class may have been closed, or the code changed. Check the code with your teacher and enter it here.
        </p>
        <div className="mt-6 max-w-sm">
          <JoinClassForm />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{preview.schoolName}</p>
      <h1 className="mt-3 text-page-title text-balance">Join {preview.className}?</h1>
      <p className="mt-3 text-muted-foreground">
        {preview.teacherFirstName} will be able to assign you homework here and see your results on it — nothing else from
        your PrepHub account: not your predicted score, not your other practice.
      </p>
      <div className="mt-6 max-w-sm">
        <JoinClassForm defaultCode={code} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Not your class?{" "}
        <Link href="/home" className="underline underline-offset-4">
          Go to PrepHub
        </Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">{children}</section>
    </div>
  );
}
