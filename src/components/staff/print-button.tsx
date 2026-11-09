"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Print or save as PDF" for a staff page (2026-11-09): a district office takes these figures into
 * its own reports. The app's sidebar and headers are `print:hidden`, so the printout is the page.
 */
export function PrintButton({ label = "Print or save as PDF", asOf }: { label?: string; asOf?: string }) {
  return (
    <>
      <Button type="button" variant="outline" size="xl" className="print:hidden" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden />
        {label}
      </Button>
      {/* A printout carries its date (review, 2026-11-09: a board copy was undated). */}
      {asOf && <span className="hidden text-base text-muted-foreground print:inline">As of {asOf}</span>}
    </>
  );
}
