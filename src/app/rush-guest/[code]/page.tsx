import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { normalizeRushCode } from "@/lib/rush/codes";
import { guestRoomProblem } from "@/lib/rush/guest-join";
import { isGuestRoomCode } from "@/lib/rush/guest-rooms";
import { GuestJoinForm } from "./guest-join-form";

export const metadata: Metadata = { title: "1v1 Rush", robots: { index: false } };

// Where a guest room's link lands for a signed-out visitor (middleware.ts,
// src/lib/rush/guest-rooms.ts): a first name and the room, no sign-up.
// Signed in, or any other code, it's the ordinary join page.
export default async function RushGuestPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeRushCode((await params).code);
  if (!code) redirect("/");
  if ((await auth())?.user?.id || !isGuestRoomCode(code)) redirect(`/rush/join/${code}`);

  const { hostName, questionCount, problem } = await guestRoomProblem(code);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <Logo />
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">1v1 Rush · Live</p>
        {problem ? (
          <>
            <h1 className="mt-3 text-page-title sm:text-page-title-lg">{problem}</h1>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton size="cta" href={`/rush-guest/${code}`}>
                Try again
              </LinkButton>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-display-sm sm:text-display">
              {hostName} is waiting for you in a <Marker>live</Marker> rush.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">
              {questionCount} SAT questions, the same clock for both of you. Points for right and fast. The match starts when {hostName} presses Start.
            </p>
            <GuestJoinForm code={code} />
          </>
        )}
      </section>
    </main>
  );
}
