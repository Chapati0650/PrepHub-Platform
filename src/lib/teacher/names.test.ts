import { describe, expect, it } from "vitest";
import {
  cleanLastName,
  cleanTeacherDisplayName,
  compareRosterNames,
  studentFullName,
  studentRosterName,
  teacherName,
} from "./names";
import { TeacherError } from "./errors";

describe("cleanLastName", () => {
  it("keeps real surnames, tidying spaces", () => {
    expect(cleanLastName("  O'Brien ")).toBe("O'Brien");
    expect(cleanLastName("García-López")).toBe("García-López");
    expect(cleanLastName("St.  John")).toBe("St. John");
    expect(cleanLastName("Nguyễn")).toBe("Nguyễn");
    expect(cleanLastName("D’Angelo")).toBe("D’Angelo");
  });

  it("refuses blanks, emails, digits and anything too long", () => {
    for (const bad of ["", "   ", "mason@school.org", "Smith2", "-Smith", "x".repeat(61)]) {
      expect(() => cleanLastName(bad)).toThrow(TeacherError);
    }
  });
});

describe("cleanTeacherDisplayName", () => {
  it("accepts how students address a teacher", () => {
    expect(cleanTeacherDisplayName(" Ms.  Alvarez ")).toBe("Ms. Alvarez");
    expect(cleanTeacherDisplayName("Coach Reyes")).toBe("Coach Reyes");
  });

  it("refuses an empty or overlong name", () => {
    expect(() => cleanTeacherDisplayName("  ")).toThrow(TeacherError);
    expect(() => cleanTeacherDisplayName("x".repeat(61))).toThrow(TeacherError);
  });
});

describe("studentRosterName / studentFullName", () => {
  it("is Last, First for a roster and First Last for a sentence, or just the first name", () => {
    expect(studentRosterName({ firstName: "Mason", lastName: "Ortiz" })).toBe("Ortiz, Mason");
    expect(studentRosterName({ firstName: "Mason", lastName: null })).toBe("Mason");
    expect(studentFullName({ firstName: "Mason", lastName: "Ortiz" })).toBe("Mason Ortiz");
    expect(studentFullName({ firstName: "Mason", lastName: null })).toBe("Mason");
  });
});

describe("compareRosterNames", () => {
  it("sorts by last name, then first, with students who gave none last", () => {
    const students = [
      { firstName: "Zoe", lastName: null },
      { firstName: "Mason", lastName: "Tran" },
      { firstName: "Ana", lastName: null },
      { firstName: "Mason", lastName: "ortiz" },
      { firstName: "Aiden", lastName: "Ortiz" },
    ];
    expect(students.sort(compareRosterNames).map(studentRosterName)).toEqual([
      "Ortiz, Aiden",
      "ortiz, Mason",
      "Tran, Mason",
      "Ana",
      "Zoe",
    ]);
  });
});

describe("teacherName", () => {
  it("uses the teacher's chosen name, falling back to their first name", () => {
    expect(teacherName({ firstName: "Maria", teacherDisplayName: "Ms. Alvarez" })).toBe("Ms. Alvarez");
    expect(teacherName({ firstName: "Maria", teacherDisplayName: null })).toBe("Maria");
    expect(teacherName({ firstName: "Maria", teacherDisplayName: "  " })).toBe("Maria");
  });
});
