/**
 * Parsing and validating a district's student roster, as pure functions.
 *
 * Deliberately forgiving about what arrives: a district might send a tidy CSV
 * with headers, an export with extra columns in a different order, or a
 * secretary might paste a column of email addresses out of a spreadsheet. All
 * three should work, because the alternative is the Owner hand-editing a file
 * before every upload.
 *
 * Nothing here touches the database — `roster.ts` does that. Keeping the rules
 * pure means every validation branch is directly testable, which matters: a
 * silent mis-parse here would enrol students at the wrong campus.
 */

export type RosterCampus = { id: string; officialName: string };

export type ParsedRosterRow = {
  /** 1-based line number in the input, for error messages the Owner can act on. */
  line: number;
  email: string;
  firstName: string | null;
  graduationYear: number | null;
  externalStudentId: string | null;
  schoolId: string;
};

export type RosterRowError = { line: number; value: string; reason: string };

export type ParsedRoster = {
  rows: ParsedRosterRow[];
  errors: RosterRowError[];
  /** True when the input had no header line and was read as bare emails. */
  headerless: boolean;
};

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Column aliases, so an export doesn't have to be renamed before upload. */
const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "emailaddress", "studentemail", "schoolemail", "mail", "e-mail"],
  firstName: ["firstname", "first", "givenname", "fname", "preferredname"],
  graduationYear: ["graduationyear", "gradyear", "classof", "cohort", "expectedgraduationyear"],
  externalStudentId: ["studentid", "externalstudentid", "sisid", "id", "localid", "stateid"],
  campus: ["campus", "school", "schoolname", "site", "building"],
};

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, "");

/** Splits one CSV line, honouring double quotes around values containing commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === "," || c === "\t" || c === ";") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Maps a header row to field names, or null when the line isn't a header. */
function mapHeaders(cells: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  cells.forEach((cell, i) => {
    const n = normalizeHeader(cell);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(n) && map[field] === undefined) map[field] = i;
    }
  });
  // Only a line that names an email column counts as a header — otherwise a
  // first data row would be silently eaten.
  return map.email === undefined ? null : map;
}

function resolveCampus(
  raw: string | undefined,
  campuses: RosterCampus[],
): { schoolId: string } | { error: string } {
  if (campuses.length === 0) return { error: "this organization has no campuses to assign students to" };
  const value = (raw ?? "").trim();
  if (!value) {
    // One campus is unambiguous, so a missing column is fine. Several is not:
    // guessing would put students in the wrong school's aggregates.
    if (campuses.length === 1) return { schoolId: campuses[0].id };
    return { error: "campus is required when the district has more than one school" };
  }
  const needle = value.toLowerCase();
  const exact = campuses.filter((c) => c.officialName.toLowerCase() === needle || c.id === value);
  if (exact.length === 1) return { schoolId: exact[0].id };
  const partial = campuses.filter((c) => c.officialName.toLowerCase().includes(needle));
  if (partial.length === 1) return { schoolId: partial[0].id };
  if (partial.length > 1) return { error: `"${value}" matches more than one campus` };
  return { error: `no campus named "${value}"` };
}

function parseGraduationYear(raw: string | undefined): number | null | { error: string } {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // Accepts "2028" and "Class of 2028"; a two-digit "28" is too ambiguous to guess.
  const m = value.match(/\b(20\d{2})\b/);
  if (!m) return { error: `"${value}" is not a four-digit graduation year` };
  const year = Number(m[1]);
  const thisYear = new Date().getFullYear();
  if (year < thisYear - 1 || year > thisYear + 8) {
    return { error: `graduation year ${year} is outside the plausible range` };
  }
  return year;
}

/**
 * Reads a pasted or uploaded roster.
 *
 * `campuses` are the schools a student may be assigned to — the district's
 * schools, or the single school itself for a standalone organization.
 */
export function parseRoster(input: string, campuses: RosterCampus[]): ParsedRoster {
  const lines = input.split(/\r?\n/);
  const rows: ParsedRosterRow[] = [];
  const errors: RosterRowError[] = [];
  const seen = new Map<string, number>();

  let headers: Record<string, number> | null = null;
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    headers = mapHeaders(splitCsvLine(lines[i]));
    startLine = headers ? i + 1 : i;
    break;
  }

  for (let i = startLine; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const line = i + 1;
    const cells = splitCsvLine(raw);

    const email = (headers ? cells[headers.email] : cells[0] ?? "").trim().toLowerCase();
    if (!email) continue; // a trailing comma or an empty cell, not worth reporting
    if (!EMAIL_RE.test(email)) {
      errors.push({ line, value: email, reason: "not a valid email address" });
      continue;
    }
    const firstSeen = seen.get(email);
    if (firstSeen !== undefined) {
      errors.push({ line, value: email, reason: `duplicate of line ${firstSeen}` });
      continue;
    }

    const campus = resolveCampus(headers?.campus !== undefined ? cells[headers.campus] : undefined, campuses);
    if ("error" in campus) {
      errors.push({ line, value: email, reason: campus.error });
      continue;
    }

    const gradYear = parseGraduationYear(headers?.graduationYear !== undefined ? cells[headers.graduationYear] : undefined);
    if (gradYear !== null && typeof gradYear === "object") {
      errors.push({ line, value: email, reason: gradYear.error });
      continue;
    }

    const pick = (field: string) => {
      const idx = headers?.[field];
      const v = idx === undefined ? "" : (cells[idx] ?? "").trim();
      return v || null;
    };

    seen.set(email, line);
    rows.push({
      line,
      email,
      firstName: headers ? pick("firstName") : null,
      graduationYear: gradYear,
      externalStudentId: headers ? pick("externalStudentId") : null,
      schoolId: campus.schoolId,
    });
  }

  return { rows, errors, headerless: headers === null };
}
