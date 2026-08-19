import { School, CreditCard, HelpCircle, Search } from "lucide-react";
import { ChoiceCard } from "@/components/choice-card";
import { DirectorySearch } from "./directory-search";

// PRD-002 §5: shown to a student who hasn't chosen an access method yet.
export default function AccessSelectionPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-8">
      <div>
        <h1 className="text-page-title">How would you like to access PrepHub?</h1>
        <p className="mt-1 text-muted-foreground">Choose how you&apos;d like to use PrepHub. You can change this later.</p>
      </div>

      <div className="flex flex-col gap-3">
        <ChoiceCard
          href="/access/verify-school"
          icon={School}
          title="Access Through My School"
          description="My school or district provides PrepHub access."
        />
        <ChoiceCard
          href="/pricing"
          icon={CreditCard}
          title="Pay for PrepHub Myself"
          description="I'll use my own individual subscription."
        />
      </div>

      {/* PRD-012 §5/§26: the diagnostic is free for every student, including
          those who haven't chosen an access method yet — it must remain
          reachable from here rather than gating behind school/subscription
          choice. It stays a full, equally-clickable ChoiceCard (not a subtle
          link) but visually separated and toned down from the two access
          decisions above, since it's an alternative path for the undecided
          rather than a third access method. */}
      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">Not sure yet?</p>
        <ChoiceCard
          href="/diagnostic"
          icon={HelpCircle}
          title="Take the Diagnostic First"
          description="See your predicted SAT score before deciding how you'd like to use PrepHub."
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="size-4" aria-hidden />
          <p>Not sure if your school offers PrepHub? Search for your school or district.</p>
        </div>
        <DirectorySearch />
      </div>
    </div>
  );
}
