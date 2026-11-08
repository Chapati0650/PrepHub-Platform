import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/teacher/access";
import { getSessionReport } from "@/lib/guided/console";
import { GuidedError } from "@/lib/guided/errors";
import { studentDetailRows, studentSummaryRows } from "@/lib/guided/report-export";
import { toCsv } from "@/lib/admin/student-export";

// "Download results" on a Guided Session's report. The same gate as the page:
// only the teacher who ran the session, at their own school, or a 404 (a
// guessed id from another teacher's session is logged by requireOwnedSession).
// `?detail=questions` flattens the drill-down: one row per student per question.
export async function GET(request: Request, { params }: { params: Promise<{ classId: string; sessionId: string }> }) {
  const context = await requireTeacher();
  const { classId, sessionId } = await params;

  let page;
  try {
    page = await getSessionReport(context, sessionId);
  } catch (err) {
    if (err instanceof GuidedError && err.code === "NOT_FOUND") return new NextResponse(null, { status: 404 });
    throw err;
  }
  if (page.classroomId !== classId) return new NextResponse(null, { status: 404 });

  const detail = new URL(request.url).searchParams.get("detail") === "questions";
  const slug = page.className.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class";
  const day = page.createdAt.toISOString().slice(0, 10);
  const rows = detail ? studentDetailRows(page.students) : studentSummaryRows(page.students);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prephub-session-${slug}-${day}${detail ? "-questions" : ""}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
