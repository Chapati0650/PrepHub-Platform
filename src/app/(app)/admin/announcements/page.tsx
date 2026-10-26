import { prisma } from "@/lib/prisma";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { listAnnouncements } from "@/lib/announcements";
import { localDateInputValue } from "@/lib/community/local-day";
import { StaffHeader, StaffPage, StaffUnavailable } from "@/components/staff/staff-ui";
import { AnnouncementsPanel } from "./announcements-panel";

// PRD-011 §16-§18 — the administrator's brief, one-way message to students:
// write, check exactly what students will get, send (shown in PrepHub and
// emailed once), and take it down.
export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) return <StaffUnavailable title="Announcements aren't available for this account." />;

  const [announcements, org, recipients] = await Promise.all([
    listAnnouncements(schoolId),
    prisma.organization.findUniqueOrThrow({ where: { id: schoolId }, select: { officialName: true } }),
    // The same set publishAnnouncement mails: students whose access is live.
    prisma.studentMembership.count({ where: { schoolId, status: "ACTIVE" } }),
  ]);

  return (
    <StaffPage>
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/announcements" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      <StaffHeader
        eyebrow="Your school"
        title="Announcements"
        description="Send a short message to every student at your school. It appears at the top of their PrepHub home page and is emailed to their school address once, when you send it."
      />
      <AnnouncementsPanel
        announcements={announcements}
        schoolName={org.officialName}
        recipients={recipients}
        readOnly={viewingAsOwner}
        today={localDateInputValue(new Date())}
      />
    </StaffPage>
  );
}
