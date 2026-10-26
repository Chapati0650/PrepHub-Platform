"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activateOrganizationAction,
  suspendOrganizationAction,
  archiveOrganizationAction,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/confirm-button";
import { RenewOrganizationForm } from "./renew-organization-form";

/**
 * `paidByDistrict`: a campus under a district. Its students' Premium comes
 * from the district's row (entitlements read `membership.organization`), so
 * suspending or archiving the campus alone doesn't end it, and the
 * confirmations say so rather than promising an effect that won't happen.
 */
export function StatusActions({ id, status, paidByDistrict }: { id: string; status: string; paidByDistrict: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (id: string) => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action(id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  // For the two that need confirming: the dialog shows an error itself.
  async function confirmed(action: (id: string) => Promise<{ error?: string }>) {
    const result = await action(id);
    if (!result.error) router.refresh();
    return result;
  }

  const studentEffect = paidByDistrict
    ? "This campus's students get Premium through the district's contract, so their access doesn't change; only this campus's own status does."
    : "Every student whose access comes through this organization loses Premium immediately. Their accounts and history are kept.";

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "SETUP" && (
          <Button disabled={isPending} onClick={() => run(activateOrganizationAction)}>
            Activate
          </Button>
        )}
        {status === "ACTIVE" && (
          <ConfirmButton
            size="default"
            title="Suspend this organization?"
            description={`${studentEffect} Its administrators see access as paused. You can reactivate it at any time while the contract dates are current.`}
            confirmLabel="Suspend"
            onConfirm={() => confirmed(suspendOrganizationAction)}
          >
            Suspend
          </ConfirmButton>
        )}
        {status === "SUSPENDED" && (
          <Button disabled={isPending} onClick={() => run(activateOrganizationAction)}>
            Reactivate
          </Button>
        )}
        {(status === "EXPIRED" || status === "SUSPENDED") && <RenewOrganizationForm id={id} />}
        {status !== "ARCHIVED" && (
          <ConfirmButton
            variant="destructive"
            size="default"
            destructive
            title="Archive this organization?"
            description={`It stops being operational as soon as you confirm. ${studentEffect} An archived organization can't be reactivated or renewed from this page; it's kept only for history and reporting.`}
            confirmLabel="Archive"
            onConfirm={() => confirmed(archiveOrganizationAction)}
          >
            Archive
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}
