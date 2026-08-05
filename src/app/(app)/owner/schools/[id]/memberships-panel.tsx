"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  manuallyActivateStudentAction,
  removeMembershipAction,
  restoreMembershipAction,
  markGraduatedAction,
  updateGraduationInfoAction,
  resolveSchoolTransferAction,
  type ActionState,
} from "../actions";
import { useCloseDialogOnSuccess } from "@/hooks/use-close-dialog-on-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const initialState: ActionState = {};

export type MembershipRow = {
  id: string;
  status: string;
  currentGrade: number;
  expectedGraduationYear: number;
  verifiedSchoolEmail: string;
  student: { firstName: string; email: string };
};

export type TransferTarget = { id: string; officialName: string; parentDistrictId: string | null };

export function MembershipsPanel({
  organizationId,
  memberships,
  schools,
  transferTargets,
}: {
  organizationId: string;
  memberships: MembershipRow[];
  schools: { id: string; officialName: string }[];
  transferTargets: TransferTarget[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {memberships.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>School email</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Grad. year</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.map((m) => (
                <MembershipRowItem
                  key={m.id}
                  membership={m}
                  organizationId={organizationId}
                  transferTargets={transferTargets}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ManualActivationForm organizationId={organizationId} schools={schools} />
    </div>
  );
}

function MembershipRowItem({
  membership,
  organizationId,
  transferTargets,
}: {
  membership: MembershipRow;
  organizationId: string;
  transferTargets: TransferTarget[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [gradeState, gradeAction, gradePending] = useActionState(
    updateGraduationInfoAction,
    initialState,
  );

  function run(action: (membershipId: string, organizationId: string) => Promise<ActionState>) {
    startTransition(async () => {
      const result = await action(membership.id, organizationId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={6}>
          <form action={gradeAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="membershipId" value={membership.id} />
            <input type="hidden" name="organizationId" value={organizationId} />
            {gradeState.error && (
              <Alert variant="destructive" className="w-full">
                <AlertDescription>{gradeState.error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor={`grade-${membership.id}`}>Grade</Label>
              <Input
                id={`grade-${membership.id}`}
                name="currentGrade"
                type="number"
                min={9}
                max={12}
                defaultValue={membership.currentGrade}
                className="w-20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`grad-${membership.id}`}>Grad. year</Label>
              <Input
                id={`grad-${membership.id}`}
                name="expectedGraduationYear"
                type="number"
                defaultValue={membership.expectedGraduationYear}
                className="w-24"
              />
            </div>
            <Button type="submit" size="sm" disabled={gradePending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        {membership.student.firstName} ({membership.student.email})
      </TableCell>
      <TableCell>{membership.verifiedSchoolEmail}</TableCell>
      <TableCell>{membership.currentGrade}</TableCell>
      <TableCell>{membership.expectedGraduationYear}</TableCell>
      <TableCell>
        <Badge variant={membership.status === "ACTIVE" ? "default" : "secondary"}>
          {membership.status}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          {error && <p className="w-full text-xs text-destructive">{error}</p>}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {membership.status === "ACTIVE" && (
            <>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(removeMembershipAction)}>
                Remove
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(markGraduatedAction)}>
                Mark Graduated
              </Button>
              <TransferDialog
                membershipId={membership.id}
                organizationId={organizationId}
                transferTargets={transferTargets}
              />
            </>
          )}
          {membership.status === "REMOVED" && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(restoreMembershipAction)}>
              Restore
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ManualActivationForm({
  organizationId,
  schools,
}: {
  organizationId: string;
  schools: { id: string; officialName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(manuallyActivateStudentAction, initialState);

  // A plain <form action> auto-refreshes this route's data after it resolves,
  // but doesn't close the dialog on its own — left open, the still-mounted
  // form re-renders with its fields reset to blank, which reads as "nothing
  // happened" even though the membership was actually created underneath.
  useCloseDialogOnSuccess(state.success, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        className="w-fit"
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Manually Activate Student
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manually activate a student</DialogTitle>
          <DialogDescription>
            An exceptional support action — grants access without the student completing
            self-service email verification.
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
            <Label htmlFor="studentEmail">Student&apos;s PrepHub login email</Label>
            <Input id="studentEmail" name="studentEmail" type="email" required />
          </div>

          {schools.length === 1 ? (
            <input type="hidden" name="schoolId" value={schools[0].id} />
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="schoolId">School</Label>
              <Select name="schoolId" required>
                <SelectTrigger id="schoolId" className="w-full">
                  <SelectValue placeholder="Select a school" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.officialName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="verifiedSchoolEmail">School email on record</Label>
            <Input id="verifiedSchoolEmail" name="verifiedSchoolEmail" type="email" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="currentGrade">Grade</Label>
              <Input id="currentGrade" name="currentGrade" type="number" min={9} max={12} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="expectedGraduationYear">Expected graduation year</Label>
              <Input id="expectedGraduationYear" name="expectedGraduationYear" type="number" required />
            </div>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Activating..." : "Activate Student"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// PRD-017 §15: a dedicated student-facing transfer flow is out of scope — only
// the Owner can move a student between schools.
function TransferDialog({
  membershipId,
  organizationId,
  transferTargets,
}: {
  membershipId: string;
  organizationId: string;
  transferTargets: TransferTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(resolveSchoolTransferAction, initialState);

  useCloseDialogOnSuccess(state.success, setOpen);

  const selectedSchool = transferTargets.find((s) => s.id === selectedSchoolId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="ghost"
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Transfer
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve school transfer</DialogTitle>
          <DialogDescription>
            Ends this student&apos;s access at the current school and moves them to another.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="newDistrictId" value={selectedSchool?.parentDistrictId ?? ""} />

          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="newSchoolId">New school</Label>
            <Select name="newSchoolId" required onValueChange={setSelectedSchoolId}>
              <SelectTrigger id="newSchoolId" className="w-full">
                <SelectValue placeholder="Select a school" />
              </SelectTrigger>
              <SelectContent>
                {transferTargets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.officialName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="newVerifiedSchoolEmail">New school email</Label>
            <Input id="newVerifiedSchoolEmail" name="newVerifiedSchoolEmail" type="email" required />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Transferring..." : "Resolve Transfer"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
