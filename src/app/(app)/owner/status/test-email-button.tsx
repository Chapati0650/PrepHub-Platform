"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendTestEmailAction } from "./actions";

export function TestEmailButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => setResult(await sendTestEmailAction()))
          }
        >
          {pending ? "Sending…" : "Send a test email to myself"}
        </Button>
      </div>
      {result && (
        <Alert variant={result.ok ? "default" : "destructive"}>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
