"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAdministratorAction, removeAdministratorAssignmentAction, type ActionState } from "../actions";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const initialState: ActionState = {};

type Administrator = {
  assignmentId: string;
  scope: string;
  userId: string;
  firstName: string;
  email: string;
};

export function AdministratorsPanel({
  organizationId,
  administrators,
}: {
  organizationId: string;
  administrators: Administrator[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createAdministratorAction, initialState);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The create form is a plain <form action> — Next.js auto-refreshes this
  // route's server data after it resolves, but doesn't close the dialog. Left
  // open, the still-mounted form re-renders with reset (blank) field values,
  // which reads as "nothing happened" even though the row was created.
  useCloseDialogOnSuccess(state.success, setOpen);

  function handleRemove(assignmentId: string) {
    setRemovingId(assignmentId);
    startTransition(async () => {
      await removeAdministratorAssignmentAction(assignmentId, organizationId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {administrators.length === 0 ? (
        <p className="text-sm text-muted-foreground">No administrators assigned yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {administrators.map((admin) => (
            <li key={admin.assignmentId} className="flex items-center justify-between text-sm">
              <span>
                {admin.firstName} ({admin.email}) — {admin.scope}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending && removingId === admin.assignmentId}
                onClick={() => handleRemove(admin.assignmentId)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          variant="outline"
          render={
            <button type="button" onClick={() => setOpen(true)}>
              Create Administrator
            </button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create administrator</DialogTitle>
            <DialogDescription>
              Creates a separate PrepHub account and assigns it to this organization.
            </DialogDescription>
          </DialogHeader>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" minLength={8} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="scope">Scope</Label>
              <Select name="scope" defaultValue="SCHOOL" required>
                <SelectTrigger id="scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHOOL">School</SelectItem>
                  <SelectItem value="DISTRICT">District</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create Administrator"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
