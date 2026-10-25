import { cn } from "@/lib/utils";

/**
 * The line every sign-up and log-in surface carries (Owner, 2026-10-24): a
 * student whose school or district pays for PrepHub needs to know, before
 * they choose how to sign in, that using their school email is all it takes.
 *
 * True as written. A school Google account enrolls on its first sign-in
 * (lib/district/enrollment.ts); a password account on a school email is sent
 * one confirmation link (lib/district/email-verification.ts) — the "one
 * click" the sign-up copy promises — because enrolling on a typed address
 * would let anyone claim a district seat. No price: this sits on the landing
 * page too, which carries none.
 *
 * A rule rather than a box — it's information beside a form, not a second
 * call to action competing with the button.
 */
export function SchoolAccessNote({
  variant,
  className,
}: {
  variant: "signup" | "login" | "landing";
  className?: string;
}) {
  if (variant === "landing") {
    return (
      <p className={cn("border-l-2 border-marker pl-3 text-sm text-muted-foreground", className)}>
        <span className="font-medium text-foreground">Does your school or district provide PrepHub?</span> Sign up with
        your school email and Premium unlocks free, automatically.
      </p>
    );
  }
  return (
    <div className={cn("border-l-2 border-marker pl-3 text-sm", className)}>
      <p className="font-medium">Does your school or district provide PrepHub?</p>
      <p className="mt-0.5 text-muted-foreground">
        {variant === "signup"
          ? "Sign up with your school email and Premium unlocks free, automatically — instantly with Google, or with one click in the email we send you."
          : "Log in with your school email and Premium unlocks free, automatically."}
      </p>
    </div>
  );
}
