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
import { RenewOrganizationForm } from "./renew-organization-form";

export function StatusActions({ id, status }: { id: string; status: string }) {
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
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => run(suspendOrganizationAction)}
          >
            Suspend
          </Button>
        )}
        {status === "SUSPENDED" && (
          <Button disabled={isPending} onClick={() => run(activateOrganizationAction)}>
            Reactivate
          </Button>
        )}
        {(status === "EXPIRED" || status === "SUSPENDED") && <RenewOrganizationForm id={id} />}
        {status !== "ARCHIVED" && (
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => run(archiveOrganizationAction)}
          >
            Archive
          </Button>
        )}
      </div>
    </div>
  );
}
