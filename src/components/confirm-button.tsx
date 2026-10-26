"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * A button that asks first. CLAUDE.md: destructive or access-changing
 * actions need a confirmation that states the effect, its timing and whether
 * it can be undone — so `description` is required, and should say all three.
 *
 * `onConfirm` may return `{ error }` (a server action's state); the message is
 * shown in the dialog rather than the dialog closing on a failure.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = "outline",
  size = "sm",
  destructive = false,
  className,
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  variant?: "outline" | "ghost" | "default" | "destructive";
  size?: "sm" | "default" | "lg" | "xl" | "xs";
  destructive?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Button
        variant={variant}
        size={size}
        className={className}
        render={
          <button type="button" onClick={() => setOpen(true)}>
            {children}
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-base">{description}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-base text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="xl" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="xl"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await onConfirm();
                if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
                  setError(result.error);
                  return;
                }
                setOpen(false);
              })
            }
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
