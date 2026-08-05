"use client";

import { useActionState, useState } from "react";
import { renewOrganizationAction, type ActionState } from "../actions";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const initialState: ActionState = {};

export function RenewOrganizationForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(renewOrganizationAction, initialState);

  useCloseDialogOnSuccess(state.success, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Renew Contract
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew contract</DialogTitle>
          <DialogDescription>
            Previously active memberships automatically regain access once the organization is
            Active again.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="renew-contractStartDate">New start date</Label>
              <Input id="renew-contractStartDate" name="contractStartDate" type="date" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="renew-contractEndDate">New end date</Label>
              <Input id="renew-contractEndDate" name="contractEndDate" type="date" required />
            </div>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Renewing..." : "Renew"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
