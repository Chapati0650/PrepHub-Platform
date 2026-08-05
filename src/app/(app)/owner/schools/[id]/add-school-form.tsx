"use client";

import { useActionState, useState } from "react";
import { createOrganizationAction, type ActionState } from "../actions";
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

// PRD-017 §18: "Add ... Schools under a District". Reuses createOrganizationAction
// with organizationType fixed to SCHOOL and parentDistrictId pre-set.
export function AddSchoolForm({
  districtId,
  districtCity,
  districtState,
  districtSchoolYear,
  contractStartDate,
  contractEndDate,
}: {
  districtId: string;
  districtCity: string;
  districtState: string;
  districtSchoolYear: string;
  contractStartDate: Date;
  contractEndDate: Date;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Add School
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a school to this district</DialogTitle>
          <DialogDescription>
            Inherits the district&apos;s contract dates — edit them afterward if this school&apos;s
            differ.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationType" value="SCHOOL" />
          <input type="hidden" name="parentDistrictId" value={districtId} />
          <input type="hidden" name="returnTo" value={`/owner/schools/${districtId}`} />
          <input type="hidden" name="city" value={districtCity} />
          <input type="hidden" name="state" value={districtState} />
          <input type="hidden" name="schoolYear" value={districtSchoolYear} />
          <input
            type="hidden"
            name="contractStartDate"
            value={contractStartDate.toISOString().slice(0, 10)}
          />
          <input
            type="hidden"
            name="contractEndDate"
            value={contractEndDate.toISOString().slice(0, 10)}
          />

          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-school-officialName">School name</Label>
            <Input id="add-school-officialName" name="officialName" required />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Adding..." : "Add School"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
