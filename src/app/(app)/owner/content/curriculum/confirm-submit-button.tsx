"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// A submit button that asks first. Destructive Owner actions (deleting a
// module or lesson) state the effect in the prompt — CLAUDE.md's "explicit
// confirmation that states the effect, timing, and reversibility."
export function ConfirmSubmitButton({
  confirm,
  children,
  ...props
}: { confirm: string; children: ReactNode } & Omit<React.ComponentProps<typeof Button>, "type" | "onClick">) {
  return (
    <Button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
