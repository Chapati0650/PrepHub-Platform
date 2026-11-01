import { resetLinkProblem } from "@/lib/auth/account";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

/**
 * A password-reset link, and a teacher's invitation (the same token). The
 * link is checked before the form is shown, so someone holding a used or
 * expired one is told straight away rather than after choosing a password.
 */
export default async function ConfirmResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const problem = await resetLinkProblem(token);

  if (problem) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-display-sm font-semibold">This link doesn&apos;t work</h1>
          </CardTitle>
          <CardDescription className="text-base">{problem}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <LinkButton href="/reset-password" size="lg" className="h-12 text-base">
            Get a new link
          </LinkButton>
          <LinkButton href="/login" variant="link" className="px-0">
            Back to login
          </LinkButton>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-display-sm font-semibold">Set your password</h1>
        </CardTitle>
        <CardDescription className="text-base">Choose a password for your PrepHub account.</CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm token={token} />
      </CardContent>
    </Card>
  );
}
