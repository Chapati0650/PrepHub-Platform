import { ShieldCheck, Mail } from "lucide-react";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getSchoolAccessInfo } from "@/lib/admin/access-info";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

const ACCESS_STATUS_LABELS: Record<string, string> = {
  SETUP: "Setting Up",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  ARCHIVED: "Archived",
};

const SUPPORT_EMAIL = "support@prephub.app";

function formatMonthYear(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

// PRD-011 §19-§20 — a simple, non-billing view of whether the school
// currently has access, plus how to reach PrepHub support. Deliberately does
// not show contract amount, invoices, or other billing/contract-management
// detail — "the dashboard does not function as a billing or
// contract-management portal."
export default async function SchoolAccessPage() {
  const { schoolId } = await requireAdminSchoolContext();

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl sm:text-2xl">School Access & Support isn&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const info = await getSchoolAccessInfo(schoolId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      <PageHeader eyebrow="Administrator" title="School Access & Support" icon={ShieldCheck} />

      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">School Access Status</p>
          <Badge variant={info.status === "ACTIVE" ? "default" : "secondary"}>
            {ACCESS_STATUS_LABELS[info.status] ?? info.status}
          </Badge>
        </div>
        <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">
          {formatMonthYear(info.contractStartDate)} – {formatMonthYear(info.contractEndDate)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Student Access Period</p>
      </div>

      <div className="rounded-lg border border-border p-6">
        <div className="mb-3 flex items-center gap-3">
          <div className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Mail className="size-4.5" aria-hidden />
          </div>
          <h2 className="text-base font-semibold">PrepHub Support</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Support can help with administrator password resets, incorrect student email addresses or school associations,
          student access problems, technical issues, announcement-delivery problems, enrollment corrections, and other
          account issues you can&apos;t resolve here.
        </p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-block text-sm font-medium underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>
      </div>
    </div>
  );
}
