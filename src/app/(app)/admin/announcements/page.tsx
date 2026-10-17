import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { listAnnouncements } from "@/lib/announcements";
import { PageHeader } from "@/components/page-header";
import { AnnouncementsPanel } from "./announcements-panel";

// PRD-011 §16-§18 — the administrator's brief, one-way communication tool:
// create, preview, publish (with email delivery to every registered student),
// and manage active/previous announcements.
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl sm:text-2xl">Announcements aren&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const announcements = await listAnnouncements(schoolId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/announcements" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      <PageHeader
        eyebrow="Administrator"
        title="Announcements"
        description="Share a brief update with your registered students. Announcements appear inside PrepHub and are emailed once, at publish time."
      />
      <AnnouncementsPanel announcements={announcements} />
    </div>
  );
}
