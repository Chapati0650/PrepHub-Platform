"use client";

import { use, useActionState } from "react";
import Link from "next/link";
import { loginAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GoogleIcon } from "@/components/google-icon";
import { SchoolAccessNote } from "@/components/school-access-note";

const initialState: ActionState = {};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string; next?: string; error?: string }>;
}) {
  const params = use(searchParams);
  // Set by the set-password page on its way here, so a teacher finishing
  // their invitation (or anyone after a reset) knows it worked.
  const passwordSet = params.password === "set";
  // Where middleware was sending them (a homework link in an email); checked
  // again on the server before it's followed (lib/auth/next-path.ts).
  const next = typeof params.next === "string" ? params.next : "";
  // Auth.js sends a failed Google sign-in back here with ?error=.
  const googleFailed = typeof params.error === "string" && params.error.length > 0;
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-display-sm font-semibold">Welcome back</h1>
        </CardTitle>
        <CardDescription className="text-base">Pick up right where you left off.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SchoolAccessNote variant="login" className="mb-1" />
        {/* A real <a> tag, not next/link's <Link> — three real incidents now,
            see src/app/api/auth/google-sign-in for the full history: (1) a
            Server Action whose response is an external redirect broke on
            Netlify with "An unexpected response was received from the
            server"; (2) a client-side signOut()-then-signIn() pair left a
            timing window where a stale session from another tab could still
            get linked instead of switched; (3) even a plain <Link> to this
            same Route Handler gets soft-navigated by Next's client router via
            fetch() — confirmed live via a real browser: once the redirect
            chain reaches accounts.google.com, the browser's CORS policy
            blocks fetch() from following a cross-origin redirect, so the
            whole flow silently dies with a blank screen. Only a genuine full
            browser navigation (a plain <a>, never intercepted by the router)
            can follow a redirect all the way to an external origin. */}
        <LinkButton
          variant="outline"
          size="lg"
          className="h-12 w-full gap-3 rounded-full text-base"
          href={next ? `/api/auth/google-sign-in?next=${encodeURIComponent(next)}` : "/api/auth/google-sign-in"}
          hardNavigation
        >
          <GoogleIcon className="size-5" />
          Continue with Google
        </LinkButton>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {next && <input type="hidden" name="next" value={next} />}
          {googleFailed && !state.error && (
            <Alert variant="destructive">
              <AlertDescription>
                Google sign-in didn&apos;t finish. Try again, or log in with your email and password below. Some school
                Google accounts don&apos;t allow signing in to other sites; if that&apos;s yours,{" "}
                <Link href="/reset-password" className="font-medium underline underline-offset-4">
                  set a password
                </Link>{" "}
                for the same email instead.
              </AlertDescription>
            </Alert>
          )}
          {passwordSet && !state.error && (
            <Alert role="status">
              <AlertDescription>Your password is set. Log in with it below.</AlertDescription>
            </Alert>
          )}
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={state.fields?.email}
              required
            />
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

          <Button type="submit" size="lg" className="h-12 rounded-full text-base" disabled={pending}>
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
