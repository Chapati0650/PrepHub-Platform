import { Megaphone } from "lucide-react";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { listAnnouncements } from "@/lib/announcements";
import { PageHeader } from "@/components/page-header";
import { AnnouncementsPanel } from "./announcements-panel";

// PRD-011 §16-§18 — the administrator's brief, one-way communication tool:
// create, preview, publish (with email delivery to every registered student),
// and manage active/previous announcements.
export default async function AnnouncementsPage() {
  const { schoolId } = await requireAdminSchoolContext();

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
      <PageHeader
        eyebrow="Administrator"
        title="Announcements"
        icon={Megaphone}
        description="Share a brief update with your registered students. Announcements appear inside PrepHub and are emailed once, at publish time."
      />
      <AnnouncementsPanel announcements={announcements} />
    </div>
  );
}
