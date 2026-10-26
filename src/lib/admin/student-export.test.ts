import { describe, expect, it, vi } from "vitest";
import { EXPORT_ACTIVITY_CHUNK, getStudentExportRows, toCsv } from "./student-export";
import { getStudentActivity } from "@/lib/school/student-activity";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({ prisma: { studentMembership: { findMany: vi.fn() } } }));
vi.mock("@/lib/school/student-activity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/school/student-activity")>("@/lib/school/student-activity");
  return { ...actual, getStudentActivity: vi.fn(async () => new Map()) };
});

const mockedFindMany = prisma.studentMembership.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedActivity = getStudentActivity as unknown as ReturnType<typeof vi.fn>;

describe("getStudentExportRows", () => {
  it("reads activity a slice at a time, so a large school stays under Postgres's parameter limit", async () => {
    const count = EXPORT_ACTIVITY_CHUNK * 2 + 7;
    mockedFindMany.mockResolvedValue(
      Array.from({ length: count }, (_, i) => ({
        studentId: `s${i}`,
        verifiedSchoolEmail: `s${i}@school.edu`,
        expectedGraduationYear: 2028,
        status: "ACTIVE",
        activatedAt: new Date("2026-09-01"),
        student: { firstName: `S${i}` },
      })),
    );

    const rows = await getStudentExportRows("school1");

    expect(rows).toHaveLength(count + 1); // plus the header
    expect(mockedActivity.mock.calls.map(([ids]) => ids.length)).toEqual([EXPORT_ACTIVITY_CHUNK, EXPORT_ACTIVITY_CHUNK, 7]);
  });
});

describe("toCsv", () => {
  it("joins plain cells with commas and rows with CRLF, after a byte-order mark", () => {
    expect(toCsv([["First name", "Class of"], ["Ada", "2027"]])).toBe("﻿First name,Class of\r\nAda,2027\r\n");
  });

  it("quotes a cell with a comma, quote or line break, doubling inner quotes", () => {
    expect(toCsv([["Smith, Jr.", 'Ana "AJ"', "two\nlines"]])).toBe('﻿"Smith, Jr.","Ana ""AJ""","two\nlines"\r\n');
  });

  it("defuses a cell a spreadsheet would run as a formula", () => {
    const csv = toCsv([["=HYPERLINK(\"x\")", "+1", "-2", "@cmd", "Ada"]]);
    expect(csv).toBe('﻿"\'=HYPERLINK(""x"")",\'+1,\'-2,\'@cmd,Ada\r\n');
  });

  it("leaves an empty cell empty", () => {
    expect(toCsv([["Ada", "", "0"]])).toBe("﻿Ada,,0\r\n");
  });
});
