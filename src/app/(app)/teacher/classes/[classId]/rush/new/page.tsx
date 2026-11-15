import { notFound } from "next/navigation";
import { requireOwnedClassroom, requireTeacher } from "@/lib/teacher/access";
import { TeacherError } from "@/lib/teacher/errors";
import { RUSH_SECTIONS, RUSH_SECTION_ORDER, RUSH_TIME_LIMIT_MS } from "@/lib/rush/config";
import { CLASS_RUSH_SIZES } from "@/lib/rush/class-rush-clock";
import { Button } from "@/components/ui/button";
import { StaffHeader, StaffPage, StaffSection, StaffSteps } from "@/components/staff/staff-ui";
import { createClassRushAction } from "../../../../rush/actions";

export const metadata = { title: "Class Rush" };

function Choice({ name, value, label, detail, defaultChecked }: { name: string; value: string; label: string; detail: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-2xl border border-border p-5 transition-colors has-[:checked]:border-primary has-[:checked]:bg-surface-tint has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
      <span className="flex items-center gap-3">
        <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="size-5 accent-primary" />
        <span className="text-lg font-medium">{label}</span>
      </span>
      <span className="pl-8 text-base text-muted-foreground">{detail}</span>
    </label>
  );
}

// Setting up a Class Rush (2026-11-15): one Rush the whole class plays at once.
// Two choices and a button; the game screen does the rest.
export default async function NewClassRushPage({ params }: { params: Promise<{ classId: string }> }) {
  const context = await requireTeacher();
  const { classId } = await params;
  let classroom;
  try {
    classroom = await requireOwnedClassroom(context, classId);
  } catch (err) {
    if (err instanceof TeacherError) notFound();
    throw err;
  }

  return (
    <StaffPage className="max-w-4xl">
      <StaffHeader
        back={{ href: `/teacher/classes/${classId}`, label: classroom.name }}
        eyebrow={classroom.name}
        title="Class Rush"
        description="The whole class plays the same 1v1 Rush questions at once, on one clock, with a live leaderboard on your screen. Fast, a little loud, and every student practices the whole time."
      />

      <form action={createClassRushAction} className="flex flex-col gap-10">
        <input type="hidden" name="classroomId" value={classId} />

        <StaffSection title="Section">
          <div className="grid gap-4 sm:grid-cols-2">
            {RUSH_SECTION_ORDER.map((s, i) => (
              <Choice
                key={s}
                name="section"
                value={s}
                label={RUSH_SECTIONS[s].label}
                detail={`Easy, medium and hard questions mixed, ${Math.round(RUSH_TIME_LIMIT_MS[s] / 1000)} seconds each at most.`}
                defaultChecked={i === 0}
              />
            ))}
          </div>
        </StaffSection>

        <StaffSection title="Length" description="Each question ends the moment everyone has answered, so a quick class finishes sooner.">
          <div className="grid gap-4 sm:grid-cols-2">
            {CLASS_RUSH_SIZES.map((n, i) => (
              <Choice
                key={n}
                name="size"
                value={String(n)}
                label={`${n} questions`}
                detail={n === 5 ? "About 5 minutes. A warm-up or a closer." : "About 10 minutes. A full round."}
                defaultChecked={i === 0}
              />
            ))}
          </div>
        </StaffSection>

        <StaffSection title="How it runs">
          <StaffSteps
            steps={[
              { title: "Open the game and put your screen on the projector", body: "It shows who has joined, a countdown, and after each question the right answer and the leaderboard." },
              { title: "Students join from their own screens", body: "A Join button appears on their PrepHub home and 1v1 Rush pages for as long as the game is open." },
              { title: "Press Start when everyone's in", body: "Latecomers can still join; they start at the question the class is on." },
            ]}
          />
        </StaffSection>

        <div>
          <Button type="submit" size="cta">
            Open the game
          </Button>
        </div>
      </form>
    </StaffPage>
  );
}
