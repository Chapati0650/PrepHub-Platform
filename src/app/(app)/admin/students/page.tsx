import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { OwnerSchoolSwitcher } from "../school-switcher";
import { getStudentDirectory, type StudentDirectoryFilters } from "@/lib/admin/student-directory";
import { PageHeader } from "@/components/page-header";
import { StudentDirectoryTable } from "./student-directory-table";
import { CampusInvitePanel } from "./invite-panel";
import { getRosterInviteSummary, inviteScopeForSchool } from "@/lib/owner/roster-invites";

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(searchParams: SearchParams): StudentDirectoryFilters {
  const page = Number(one(searchParams.page));
  const graduationYear = one(searchParams.graduationYear);
  const status = one(searchParams.status);
  return {
    search: one(searchParams.search),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    graduationYear: graduationYear ? Number(graduationYear) : undefined,
    status: status as StudentDirectoryFilters["status"],
  };
}

// PRD-011 §12-§14 — the administrator's registered-student roster: search,
// filter, and limited first-name/graduation-year correction. Filters live in
// the URL (mirroring the Owner Questions table's pattern) so they survive
// navigation and are shareable/bookmarkable.
export default async function StudentDirectoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(
    one(params.school),
  );

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl sm:text-2xl">Student Directory isn&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const filters = parseFilters(params);
  const [directory, invites] = await Promise.all([
    getStudentDirectory(schoolId, filters),
    inviteScopeForSchool(schoolId).then(getRosterInviteSummary),
  ]);
  const currentYear = new Date().getFullYear();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-8">
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin/students" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      {/* The description states the boundary out loud, because an
          administrator seeing engagement columns will reasonably wonder
          whether scores are here too, and a student deserves to be able to
          read the same sentence. */}
      <PageHeader
        eyebrow="Administrator"
        title="Student Directory"
        description="Every student registered through your school, with how much work each has done. Engagement only — PrepHub never shows you an individual student's answers, mastery or predicted score."
      />
      <CampusInvitePanel summary={invites} readOnly={viewingAsOwner} />

      <StudentDirectoryTable
        students={directory.entries}
        total={directory.total}
        page={directory.page}
        pageCount={directory.pageCount}
        filters={filters}
        currentYear={currentYear}
      />
    </div>
  );
}
