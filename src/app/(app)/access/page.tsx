import { ChoiceCard } from "@/components/choice-card";
import { Marker } from "@/components/ui/marker";

// PRD-002 §5: shown to a student who hasn't chosen an access method yet.
//
// School/district access (verify-school, the directory search) is
// deliberately hidden from this page for now, by Owner request — launch is
// self-pay-only. The underlying functionality is untouched and still fully
// reachable directly (/access/verify-school, DirectorySearch in
// ./directory-search.tsx, every action in ./actions.ts) for whenever school
// access reopens; only the entry points on this page are removed.
export default function AccessSelectionPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 p-6 sm:p-10">
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">One last step</p>
        <h1 className="mt-3 text-display-sm text-balance">
          How would you like to <Marker>access</Marker> PrepHub?
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">
          Choose how you&apos;d like to use PrepHub. You can change this later.
        </p>
      </div>

      <ChoiceCard
        tone="primary"
        href="/pricing"
        title="Pay for PrepHub Myself"
        description="I'll use my own individual subscription."
        meta="$25/month at launch — 50% off, cancel anytime"
      />

      {/* PRD-012 §5/§26: the diagnostic is free for every student, including
          those who haven't chosen an access method yet — it must remain
          reachable from here rather than gating behind subscription choice.
          It stays a full, equally-clickable ChoiceCard (not a subtle link)
          but visually separated and toned down from the access decision
          above, since it's an alternative path for the undecided rather
          than a second access method. */}
      <div className="flex flex-col gap-4 border-t border-border pt-8">
        <p className="text-sm text-muted-foreground">Not sure yet?</p>
        <ChoiceCard
          href="/diagnostic"
          title="Take the Diagnostic First"
          description="See your predicted SAT score before deciding how you'd like to use PrepHub."
          meta="Free · 21 questions"
        />
      </div>
    </div>
  );
}
