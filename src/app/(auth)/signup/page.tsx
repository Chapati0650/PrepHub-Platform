"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, googleSignInAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: ActionState = {};

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Start with a free diagnostic — no card required.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={googleSignInAction}>
          <Button type="submit" variant="outline" className="w-full">
            Continue with Google
          </Button>
        </form>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" autoComplete="given-name" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="grade">Grade</Label>
            <Select name="grade" required>
              <SelectTrigger id="grade" className="w-full">
                <SelectValue placeholder="Select your grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="9">9th grade</SelectItem>
                <SelectItem value="10">10th grade</SelectItem>
                <SelectItem value="11">11th grade</SelectItem>
                <SelectItem value="12">12th grade</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Each checkbox gets an explicit aria-label rather than relying on the
              wrapping <label>'s computed text, since that text includes a nested
              <Link> — without this, assistive tech announces the link text as part
              of the checkbox's name, and clicking the link (correctly) navigates
              instead of toggling the box, which needs a name distinct from that. */}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="ageConfirmed" required aria-label="I confirm I am 13 years of age or older" />
            I confirm I am 13 years of age or older.
          </label>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="tosAccepted" required aria-label="I agree to the Terms of Service" />
            I agree to the{" "}
            <Link href="/terms" className="underline">
              Terms of Service
            </Link>
            .
          </label>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="privacyAccepted" required aria-label="I agree to the Privacy Policy" />
            I agree to the{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </label>

          <Button type="submit" disabled={pending}>
            {pending ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
