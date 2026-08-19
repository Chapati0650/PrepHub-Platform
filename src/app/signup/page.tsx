"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { signInWithGoogle } from "@/lib/auth/client-google-sign-in";
import { signUpAction, type ActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Logo } from "@/components/logo";
import { GoogleIcon } from "@/components/google-icon";
import { DiagnosticVisual } from "@/app/landing-visuals";

const initialState: ActionState = {};

// Split-screen layout (visual left, form right) per direct request, modeled
// on Khan Academy's signup page structurally — not its stock photo/random
// trivia fact, which PrepHub has no equivalent of. The left panel reuses the
// landing page's real Diagnostic visual instead, so a visitor sees an actual
// product surface rather than decorative art. Lives outside the (auth) route
// group deliberately: (auth)/layout.tsx's centered-card chrome (shared with
// /login and /reset-password) doesn't fit this two-column design, and route
// groups are how Next.js lets one route opt out of a sibling layout without
// changing its URL.
export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between gap-10 bg-accent p-10 lg:flex">
        <Logo size="lg" />
        <div className="flex flex-col gap-6">
          <h2 className="max-w-sm font-heading text-3xl font-semibold tracking-tight text-balance">
            One Diagnostic. A real starting point.
          </h2>
          <p className="max-w-sm text-muted-foreground">
            21 questions across every SAT category give you an initial Predicted SAT Score range — no guessing where
            to begin.
          </p>
          <div className="max-w-sm">
            <DiagnosticVisual />
          </div>
        </div>
        <div />
      </div>

      <div className="flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Link>
            <Logo className="lg:hidden" />
          </div>

          <div>
            <h1 className="text-2xl font-semibold">Create your account</h1>
            <p className="text-muted-foreground">Start with a free diagnostic — no card required.</p>
          </div>

          <div className="flex flex-col gap-4">
            {/* signInWithGoogle (client-side signIn(), not a Server Action —
                see login/page.tsx for why) also signs out first: Auth.js
                silently *links* a new Google account to whoever's already
                logged in, rather than switching to it — see that helper's
                comment for the real incident this caused. */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 w-full gap-3 text-base"
              onClick={() => void signInWithGoogle("/home")}
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
          </div>
        </div>
      </div>
    </div>
  );
}
