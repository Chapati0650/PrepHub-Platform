"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PremiumUnlocked } from "@/components/premium-unlocked";

/** Plays the celebration on load and again on demand; remounting it is the replay. */
export function PremiumPreviewPlayer({ organizationName, logoMediaId }: { organizationName: string; logoMediaId: string | null }) {
  const [run, setRun] = useState(0);
  return (
    <>
      <Button size="cta" onClick={() => setRun((r) => r + 1)}>
        Play it again
      </Button>
      <PremiumUnlocked
        key={run}
        organizationName={organizationName}
        logoMediaId={logoMediaId}
        firstName="Jordan"
        onSeen={async () => {}}
      />
    </>
  );
}
