"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GoogleIcon } from "@/components/google-icon";

const initialState: ActionState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold sm:text-3xl">Welcome back</CardTitle>
        <CardDescription className="text-base">Pick up right where you left off.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* A plain link to a Route Handler, not a client onClick — two
            earlier real incidents, see src/app/api/auth/google-sign-in for
            the full history: (1) a Server Action whose response is an
            external redirect broke on Netlify with "An unexpected response
            was received from the server"; (2) even a client-side
            signOut()-then-signIn() pair left a timing window where a stale
            session from another tab could still get linked instead of
            switched. A plain link to a server Route Handler that does both
            steps in one request has no client-JS timing dependency at all. */}
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-full gap-3 text-base"
          render={<Link href="/api/auth/google-sign-in" />}
        >
          <GoogleIcon className="size-5" />
          Continue with Google
        </Button>

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
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/reset-password" className="text-xs underline">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
            {pending ? "Logging in..." : "Log in"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="underline">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
