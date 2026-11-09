import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getDistrictOverview, type CampusRow, type FigureRow } from "@/lib/admin/district-overview";
import { MIN_GROUP_SIZE } from "@/lib/admin/impact";
import { toCsv } from "@/lib/admin/student-export";

/**
 * The district Overview's campus table as a spreadsheet (2026-11-09): a CCMR office takes these figures
 * into its own reports. Exactly the figures the page shows, protected the same way (a withheld cell says
 * so in words); nothing about any one student. Only a district administrator, for their own district.
 */
export async function GET() {
  const { district } = await requireAdminSchoolContext(undefined);
  if (!district) redirect("/admin");
  const overview = await getDistrictOverview(district.name, district.campuses);

  const count = (v: number | null) => (v === null ? `Fewer than ${MIN_GROUP_SIZE}` : String(v));
  const gain = (r: FigureRow) => (r.averageScoreGain === null ? "Not enough yet" : String(r.averageScoreGain));
  const tsi = (c: CampusRow) =>
    !c.readiness ? "Not enough yet" : "withheld" in c.readiness ? "Withheld" : c.readiness.meet === null ? `Fewer than ${MIN_GROUP_SIZE}` : String(c.readiness.meet);
  const tsiOf = (c: CampusRow) => (!c.readiness || "withheld" in c.readiness ? "" : String(c.readiness.measured));

  const rows: string[][] = [
    ["Campus", "Signed up", "Started practicing", "Active this week", "Questions answered", "Practice Sets finished", "Average predicted-score gain", "Meet TSI now", "Measured for TSI"],
    ...overview.campuses.map((c) => [
      c.campusName,
      String(c.registered),
      count(c.started),
      count(c.activeThisWeek),
      String(c.questionsAnswered),
      String(c.practiceSetsFinished),
      gain(c),
      tsi(c),
      tsiOf(c),
    ]),
    [
      `${overview.districtName} (district)`,
      String(overview.totals.registered),
      count(overview.totals.started),
      count(overview.totals.activeThisWeek),
      String(overview.totals.questionsAnswered),
      String(overview.totals.practiceSetsFinished),
      gain(overview.totals),
      !overview.readiness
        ? "Not enough yet"
        : overview.readiness.meetNow === "withheld"
          ? "Withheld"
          : overview.readiness.meetNow === null
            ? `Fewer than ${MIN_GROUP_SIZE}`
            : String(overview.readiness.meetNow),
      overview.readiness ? String(overview.readiness.measured) : "",
    ],
  ];
  const slug = overview.districtName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "district";
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prephub-${slug}-by-campus-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
