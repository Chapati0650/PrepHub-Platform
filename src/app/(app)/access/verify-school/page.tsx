"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestSchoolVerificationAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

export default function VerifySchoolPage() {
  const [state, formAction, pending] = useActionState(requestSchoolVerificationAction, initialState);

  if (state.success) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>Check your school email</CardTitle>
            <CardDescription>
              We sent a verification link to your school email. Open the email and select the
              link to verify your access. The link expires in 24 hours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/access" className="text-sm underline">
              Back to access options
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>Verify Your School</CardTitle>
          <CardDescription>Enter your school-issued email to verify your eligibility.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">School Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>

            <Button type="submit" disabled={pending}>
              {pending ? "Sending..." : "Verify School Email"}
            </Button>
          </form>

          <Link href="/access" className="mt-4 inline-block text-sm underline">
            Back to access options
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
