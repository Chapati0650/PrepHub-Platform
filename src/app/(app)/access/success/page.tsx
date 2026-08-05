import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// PRD-002 §11.2 success screen. Only reachable by a student who actually has
// an active membership — not a static "did you just verify?" trust-the-URL page.
export default async function AccessSuccessPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const membership = await prisma.studentMembership.findUnique({
    where: { studentId: session.user.id },
  });
  if (!membership || membership.status !== "ACTIVE") {
    redirect("/access");
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <PartyPopper className="mb-2 size-6 text-primary" aria-hidden />
          <CardTitle>You&apos;re all set</CardTitle>
          <CardDescription>Your school district provides PrepHub at no cost.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/home">Go to Dashboard</Link>} />
        </CardContent>
      </Card>
    </div>
  );
}
