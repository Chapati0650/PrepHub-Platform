import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { DIRECTORY_SOURCE } from "@/lib/colleges/directory";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CollegeSearch } from "./college-search";

export default async function AddCollegePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  if (!(await hasPaidAccess(session.user.id))) redirect("/college-apps");

  const [existing, { error }] = await Promise.all([
    prisma.collegeApplication.findMany({ where: { studentId: session.user.id }, select: { collegeId: true } }),
    searchParams,
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <Link href="/college-apps" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Back to College Apps
      </Link>
      <div>
        <h1 className="text-page-title sm:text-page-title-lg">Add a college</h1>
        <p className="mt-2 text-muted-foreground">
          Every bachelor&apos;s-granting college in the U.S. Adding one brings in its essay prompts, test policy, and a
          score fit against your prediction.
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <CollegeSearch alreadyAdded={existing.map((e) => e.collegeId)} />
      <p className="text-xs text-muted-foreground">Directory and admissions data: {DIRECTORY_SOURCE}.</p>
    </div>
  );
}
