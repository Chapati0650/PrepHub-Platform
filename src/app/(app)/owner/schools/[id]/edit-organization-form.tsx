"use client";

import { useActionState } from "react";
import { updateOrganizationAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function EditOrganizationForm({
  id,
  officialName,
  city,
  state: stateName,
  schoolYear,
  contractStartDate,
  contractEndDate,
  internalNotes,
}: {
  id: string;
  officialName: string;
  city: string;
  state: string;
  schoolYear: string;
  contractStartDate: Date;
  contractEndDate: Date;
  internalNotes: string | null;
}) {
  const [formState, formAction, pending] = useActionState(updateOrganizationAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      {formState.error && (
        <Alert variant="destructive">
          <AlertDescription>{formState.error}</AlertDescription>
        </Alert>
      )}
      {formState.success && <p className="text-sm text-muted-foreground">Saved.</p>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-officialName">Official name</Label>
        <Input id="edit-officialName" name="officialName" defaultValue={officialName} required />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-city">City</Label>
          <Input id="edit-city" name="city" defaultValue={city} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-state">State</Label>
          <Input id="edit-state" name="state" defaultValue={stateName} required />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-schoolYear">School year</Label>
        <Input id="edit-schoolYear" name="schoolYear" defaultValue={schoolYear} required />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-contractStartDate">Contract start</Label>
          <Input
            id="edit-contractStartDate"
            name="contractStartDate"
            type="date"
            defaultValue={toDateInputValue(contractStartDate)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-contractEndDate">Contract end</Label>
          <Input
            id="edit-contractEndDate"
            name="contractEndDate"
            type="date"
            defaultValue={toDateInputValue(contractEndDate)}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-internalNotes">Internal notes (Owner-only)</Label>
        <Textarea id="edit-internalNotes" name="internalNotes" defaultValue={internalNotes ?? ""} />
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
