import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/teacher/access";
import { getClassroomDetail } from "@/lib/teacher/classrooms";
import { gradebookRows } from "@/lib/teacher/gradebook-export";
import { TeacherError } from "@/lib/teacher/errors";
import { toCsv } from "@/lib/admin/student-export";

// The class page's "Download gradebook". The same gate as the page: the
// teacher's own class at their own school, or a 404 (a guessed id from
// another teacher's class is logged by requireOwnedClassroom).
export async function GET(_request: Request, { params }: { params: Promise<{ classId: string }> }) {
  const context = await requireTeacher();
  const { classId } = await params;

  let detail;
  try {
    detail = await getClassroomDetail(context, classId);
  } catch (err) {
    if (err instanceof TeacherError && err.code === "NOT_FOUND") return new NextResponse(null, { status: 404 });
    throw err;
  }

  const slug = detail.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class";
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(gradebookRows(detail, new Date())), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prephub-gradebook-${slug}-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
