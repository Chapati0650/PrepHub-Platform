import { auth } from "@/auth";
import { openClassRushesFor } from "@/lib/rush/class-rush";
import { LinkButton } from "@/components/ui/link-button";

/**
 * "Your class is playing a Class Rush · Join" (2026-11-15), on a student's
 * home, 1v1 Rush and Homework pages while a teacher has a game open for one of
 * their classes. It links to the game's page, where joining is a button press.
 */
export async function ClassRushBanner() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "STUDENT") return null;
  const games = await openClassRushesFor(session.user.id);
  if (games.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {games.map((g) => (
        <div
          key={g.id}
          className="flex flex-col gap-4 rounded-2xl bg-surface-deep p-5 text-surface-deep-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <p className="text-lg">
            <span className="font-semibold">{g.teacherName}</span>&apos;s {g.className} is {g.started ? "playing" : "starting"} a{" "}
            <span className="font-semibold">Class Rush</span>.
          </p>
          <LinkButton href={`/rush/class/${g.id}`} size="cta" className="shrink-0 bg-marker text-surface-deep hover:bg-marker/90">
            Join
          </LinkButton>
        </div>
      ))}
    </div>
  );
}
