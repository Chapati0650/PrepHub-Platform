import { describe, expect, it } from "vitest";
import { parseRoster, splitCsvLine, type RosterCampus } from "@/lib/owner/roster-parse";

const ONE: RosterCampus[] = [{ id: "c1", officialName: "Northwest High School" }];
const MANY: RosterCampus[] = [
  { id: "c1", officialName: "Northwest High School" },
  { id: "c2", officialName: "Byron Nelson High School" },
  { id: "c3", officialName: "Eaton High School" },
];
const YEAR = new Date().getFullYear();

describe("splitCsvLine", () => {
  it("splits on commas, tabs and semicolons", () => {
    expect(splitCsvLine("a,b")).toEqual(["a", "b"]);
    expect(splitCsvLine("a\tb")).toEqual(["a", "b"]);
    expect(splitCsvLine("a;b")).toEqual(["a", "b"]);
  });

  it("keeps commas inside quotes, which is how school names arrive", () => {
    expect(splitCsvLine('a@x.org,"High School, North",11')).toEqual(["a@x.org", "High School, North", "11"]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('"say ""hi""",b')).toEqual(['say "hi"', "b"]);
  });
});

describe("parseRoster", () => {
  it("reads a bare list of emails pasted out of a spreadsheet", () => {
    const r = parseRoster("a@x.org\nb@x.org\n\nc@x.org\n", ONE);
    expect(r.headerless).toBe(true);
    expect(r.rows.map((x) => x.email)).toEqual(["a@x.org", "b@x.org", "c@x.org"]);
    expect(r.rows.every((x) => x.schoolId === "c1")).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("reads a headered CSV regardless of column order or naming", () => {
    const csv = [
      "Grad Year,Student Email,First Name,SIS ID",
      `${YEAR + 2},Ada@X.org,Ada,99812`,
    ].join("\n");
    const r = parseRoster(csv, ONE);
    expect(r.headerless).toBe(false);
    expect(r.rows[0]).toMatchObject({
      email: "ada@x.org",       // lowercased
      firstName: "Ada",
      graduationYear: YEAR + 2,
      externalStudentId: "99812",
      schoolId: "c1",
    });
  });

  it("ignores columns it does not understand", () => {
    const r = parseRoster(`email,homeroom,bus route\na@x.org,204,Blue`, ONE);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].email).toBe("a@x.org");
  });

  it("treats a line without an email column as data, not a header", () => {
    const r = parseRoster("a@x.org\nb@x.org", ONE);
    expect(r.rows).toHaveLength(2);
  });

  it("reports invalid addresses with the line number", () => {
    const r = parseRoster("a@x.org\nnot-an-email\nc@x.org", ONE);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toEqual([{ line: 2, value: "not-an-email", reason: "not a valid email address" }]);
  });

  it("keeps the first of a duplicated address and points at it", () => {
    const r = parseRoster("a@x.org\nb@x.org\nA@X.org", ONE);
    expect(r.rows).toHaveLength(2);
    expect(r.errors[0]).toMatchObject({ line: 3, reason: "duplicate of line 1" });
  });

  it("skips blank cells rather than reporting them as errors", () => {
    const r = parseRoster("email\na@x.org\n\n\nb@x.org", ONE);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toEqual([]);
  });

  describe("campus assignment", () => {
    it("assigns the only campus when there is just one", () => {
      expect(parseRoster("a@x.org", ONE).rows[0].schoolId).toBe("c1");
    });

    // Guessing would put a student into the wrong school's aggregates, which
    // the Administrator area reports on — so it refuses instead.
    it("refuses to guess when a district has several campuses", () => {
      const r = parseRoster("a@x.org", MANY);
      expect(r.rows).toEqual([]);
      expect(r.errors[0].reason).toMatch(/campus is required/);
    });

    it("matches a campus by exact name", () => {
      const r = parseRoster("email,campus\na@x.org,Byron Nelson High School", MANY);
      expect(r.rows[0].schoolId).toBe("c2");
    });

    it("matches a campus by id", () => {
      const r = parseRoster("email,campus\na@x.org,c3", MANY);
      expect(r.rows[0].schoolId).toBe("c3");
    });

    it("accepts an unambiguous partial name", () => {
      const r = parseRoster("email,school\na@x.org,Eaton", MANY);
      expect(r.rows[0].schoolId).toBe("c3");
    });

    it("rejects a partial name that matches more than one campus", () => {
      const r = parseRoster("email,school\na@x.org,High School", MANY);
      expect(r.errors[0].reason).toMatch(/more than one campus/);
    });

    it("rejects a campus name that matches nothing", () => {
      const r = parseRoster("email,school\na@x.org,Sunset High", MANY);
      expect(r.errors[0].reason).toMatch(/no campus named/);
    });

    it("errors clearly when the organization has no campuses at all", () => {
      const r = parseRoster("a@x.org", []);
      expect(r.errors[0].reason).toMatch(/no campuses/);
    });
  });

  describe("graduation year", () => {
    it("accepts a plain four-digit year", () => {
      expect(parseRoster(`email,gradyear\na@x.org,${YEAR + 1}`, ONE).rows[0].graduationYear).toBe(YEAR + 1);
    });

    it("accepts 'Class of 2028' style values", () => {
      expect(parseRoster(`email,classof\na@x.org,Class of ${YEAR + 3}`, ONE).rows[0].graduationYear).toBe(YEAR + 3);
    });

    it("leaves it null when the column is absent", () => {
      expect(parseRoster("a@x.org", ONE).rows[0].graduationYear).toBeNull();
    });

    it("rejects a two-digit year rather than guessing the century", () => {
      expect(parseRoster("email,gradyear\na@x.org,28", ONE).errors[0].reason).toMatch(/four-digit/);
    });

    it("rejects a year far outside a plausible range", () => {
      expect(parseRoster(`email,gradyear\na@x.org,2099`, ONE).errors[0].reason).toMatch(/plausible range/);
    });
  });
});
