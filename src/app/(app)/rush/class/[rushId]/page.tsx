import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { ClassRushError, classRushForStudent } from "@/lib/rush/class-rush";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { joinClassRushAction } from "../actions";
import { ClassRushPlay } from "./class-rush-play";

export const metadata = { title: "Class Rush" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 pt-10 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-sm font-medium text-muted-foreground">Class Rush</p>
        <h1 className="mt-2 text-display-sm">{title}</h1>
        <div className="mt-4 flex flex-col gap-6 text-lg text-foreground/80">{children}</div>
      </section>
    </div>
  );
}

// A student's Class Rush page (2026-11-15): the Join button, then the game.
export default async function ClassRushStudentPage({ params }: { params: Promise<{ rushId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const { rushId } = await params;

  let view;
  try {
    view = await classRushForStudent(session.user.id, rushId);
  } catch (err) {
    if (!(err instanceof ClassRushError)) throw err;
    return (
      <Card title={err.code === "NOT_IN_CLASS" ? "This game is for another class." : "This Class Rush isn't here any more."}>
        <p>Ask your teacher which game to join, or play a rush of your own.</p>
        <div>
          <LinkButton href="/rush" size="cta">
            Go to 1v1 Rush
          </LinkButton>
        </div>
      </Card>
    );
  }

  if (!view.joined) {
    if (view.status === "FINISHED") {
      return (
        <Card title="This Class Rush has ended.">
          <div>
            <LinkButton href="/rush" size="cta">
              Go to 1v1 Rush
            </LinkButton>
          </div>
        </Card>
      );
    }
    return (
      <Card title="Your class is playing a Class Rush.">
        <p>Everyone answers the same questions on the same clock. Points for being right, more for being fast. Your teacher&apos;s screen shows the leaderboard.</p>
        <form action={joinClassRushAction}>
          <input type="hidden" name="rushId" value={rushId} />
          <Button type="submit" size="cta">
            Join the game
          </Button>
        </form>
      </Card>
    );
  }

  return <ClassRushPlay rushId={rushId} stateKey={view.stateKey} />;
}
