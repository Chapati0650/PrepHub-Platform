"use client";

import { useActionState, useState } from "react";
import { createOrganizationAction, type ActionState } from "./actions";
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

export function CreateOrganizationForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Create Organization
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>Add a new partner school or district.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="organizationType">Type</Label>
            <Select name="organizationType" defaultValue="SCHOOL" required>
              <SelectTrigger id="organizationType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCHOOL">School</SelectItem>
                <SelectItem value="DISTRICT">District</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="officialName">Official name</Label>
            <Input id="officialName" name="officialName" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" required />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="schoolYear">School year</Label>
            <Input id="schoolYear" name="schoolYear" placeholder="2026-2027" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="contractStartDate">Contract start</Label>
              <Input id="contractStartDate" name="contractStartDate" type="date" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contractEndDate">Contract end</Label>
              <Input id="contractEndDate" name="contractEndDate" type="date" required />
            </div>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Creating..." : "Create Organization"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
