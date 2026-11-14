import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getStudentExportRows, toCsv } from "@/lib/admin/student-export";
import { hasDirectoryFilters, matchingMembershipIds, parseDirectoryFilters } from "@/lib/admin/student-directory";

// The Students page's "Download as a spreadsheet". The same gate as the page
// itself: an administrator gets their own school and nothing else (the
// `school` parameter only moves the Owner's read-only preview). The list's
// filters, when the URL carries any, narrow it to exactly the students the
// page is showing.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const school = params.get("school") ?? undefined;
  const { schoolId } = await requireAdminSchoolContext(school);
  // An administrator with no school sees the Students page's own "isn't
  // available for this account" explanation, not a download of raw JSON.
  if (!schoolId) redirect("/admin/students");

  const filters = parseDirectoryFilters(params);
  const filtered = hasDirectoryFilters(filters);
  const [org, rows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: schoolId }, select: { officialName: true } }),
    filtered ? matchingMembershipIds(schoolId, filters).then((ids) => getStudentExportRows(schoolId, ids)) : getStudentExportRows(schoolId),
  ]);
  const slug = (org?.officialName ?? "school").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const day = new Date().toISOString().slice(0, 10);

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prephub-students-${slug}${filtered ? "-filtered" : ""}-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
