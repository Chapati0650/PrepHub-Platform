import { CreditCard, HelpCircle } from "lucide-react";
import { ChoiceCard } from "@/components/choice-card";

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
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-8">
      <div>
        <h1 className="text-page-title">How would you like to access PrepHub?</h1>
        <p className="mt-1 text-muted-foreground">Choose how you&apos;d like to use PrepHub. You can change this later.</p>
      </div>

      <div className="flex flex-col gap-3">
        <ChoiceCard
          href="/pricing"
          icon={CreditCard}
          title="Pay for PrepHub Myself"
          description="I'll use my own individual subscription."
        />
      </div>

      {/* PRD-012 §5/§26: the diagnostic is free for every student, including
          those who haven't chosen an access method yet — it must remain
          reachable from here rather than gating behind subscription choice.
          It stays a full, equally-clickable ChoiceCard (not a subtle link)
          but visually separated and toned down from the access decision
          above, since it's an alternative path for the undecided rather
          than a second access method. */}
      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">Not sure yet?</p>
        <ChoiceCard
          href="/diagnostic"
          icon={HelpCircle}
          title="Take the Diagnostic First"
          description="See your predicted SAT score before deciding how you'd like to use PrepHub."
        />
      </div>
    </div>
  );
}
