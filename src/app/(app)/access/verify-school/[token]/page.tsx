import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { resolveVerificationToken } from "@/lib/school-verification";
import { SchoolVerificationError } from "@/lib/school-verification/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(app)/actions";
import { CompleteVerification } from "./complete-verification";

export default async function VerifyTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  let resolved;
  try {
    resolved = await resolveVerificationToken(token);
  } catch (err) {
    if (err instanceof SchoolVerificationError) {
      if (err.code === "ALREADY_COMPLETED") {
        redirect("/home");
      }

      const isExpired = err.code === "EXPIRED_TOKEN";
      return (
        <div className="mx-auto max-w-md p-8">
          <Card>
            <CardHeader>
              <CardTitle>{isExpired ? "Link expired" : "Invalid link"}</CardTitle>
              <CardDescription>{err.message}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button render={<Link href="/access/verify-school">Send New Link</Link>} />
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
  }

  // PRD-002 §8.4: signed into a different account than the one the link was created for.
  if (session?.user.id !== resolved.studentId) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>Wrong account</CardTitle>
            <CardDescription>
              This verification link was created for a different PrepHub account. Log out and
              sign in with the correct account to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
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
          <CardDescription>
            {resolved.requiresSchoolSelection
              ? `Confirming your access through ${resolved.organization.officialName}.`
              : `Your school district provides PrepHub at no cost.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompleteVerification
            token={token}
            organizationName={resolved.organization.officialName}
            requiresSchoolSelection={resolved.requiresSchoolSelection}
            schools={resolved.schools}
          />
        </CardContent>
      </Card>
    </div>
  );
}
