import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getStudentDirectory, type StudentDirectoryFilters } from "@/lib/admin/student-directory";
import { StudentDirectoryTable } from "./student-directory-table";

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(searchParams: SearchParams): StudentDirectoryFilters {
  const graduationYear = one(searchParams.graduationYear);
  const status = one(searchParams.status);
  return {
    search: one(searchParams.search),
    graduationYear: graduationYear ? Number(graduationYear) : undefined,
    status: status as StudentDirectoryFilters["status"],
  };
}

// PRD-011 §12-§14 — the administrator's registered-student roster: search,
// filter, and limited first-name/graduation-year correction. Filters live in
// the URL (mirroring the Owner Questions table's pattern) so they survive
// navigation and are shareable/bookmarkable.
export default async function StudentDirectoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { schoolId } = await requireAdminSchoolContext();

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Student Directory isn&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const filters = parseFilters(await searchParams);
  const students = await getStudentDirectory(schoolId, filters);
  const currentYear = new Date().getFullYear();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <div>
        <p className="text-sm text-muted-foreground">Administrator</p>
        <h1 className="text-2xl font-semibold">Student Directory</h1>
      </div>
      <StudentDirectoryTable students={students} filters={filters} currentYear={currentYear} />
    </div>
  );
}
