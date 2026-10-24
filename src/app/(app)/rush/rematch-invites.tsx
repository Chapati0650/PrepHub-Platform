import type { RematchInvite } from "@/lib/rush/rematch";
import { Button } from "@/components/ui/button";
import { acceptRematchAction } from "./actions";

/**
 * Rematch requests waiting for this student, at the top of the hub — the
 * other place, besides the results page itself, that a student who walked
 * away will see one. A live invitation only appears while its sender is
 * still in the room (listRematchInvites drops the rest), so "waiting now" is
 * true when it says so. Accepting is free.
 */
export function RematchInvites({ invites }: { invites: RematchInvite[] }) {
  if (invites.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="rematch-heading">
      <h2 id="rematch-heading" className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Rematch requests
      </h2>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {invites.map((invite) => (
          <li key={invite.challengeId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-sm">
              <span className="font-medium">{invite.fromName}</span> wants a rematch
              <span className="text-muted-foreground">
                {" "}
                · {invite.sectionLabel}
                {invite.live ? " · waiting in the room now" : " · race their run whenever"}
              </span>
            </p>
            <form action={acceptRematchAction}>
              <input type="hidden" name="rematchId" value={invite.challengeId} />
              <Button type="submit" className="rounded-full">
                Accept
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
