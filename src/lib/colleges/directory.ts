import data from "./data/colleges.json";

// The college directory: ~1,900 bachelor's-granting U.S. institutions from
// the Department of Education's College Scorecard, shipped as JSON and
// searched in memory. See scripts/pull-colleges.mjs for provenance and the
// yearly refresh. Server-side only (the JSON is 500 KB); the client gets
// search results through a server action.

export type College = {
  id: number;
  name: string;
  alias: string | null;
  city: string;
  state: string;
  url: string | null;
  /** 1 public, 2 private nonprofit, 3 private for-profit */
  ownership: number | null;
  size: number | null;
  admissionRate: number | null;
  /** Composite 25th/75th percentile of admitted students (sum of section percentiles); null when not reported. */
  sat25: number | null;
  sat75: number | null;
  /** Scorecard ADMCON7: 1 required, 2 recommended, 3 neither, 4 unknown, 5 considered but not required. */
  testRequirements: number | null;
  tuitionInState: number | null;
  tuitionOutOfState: number | null;
};

const COLLEGES = data.colleges as College[];
const BY_ID = new Map(COLLEGES.map((c) => [c.id, c]));

export const DIRECTORY_SOURCE = data.source as string;
export const DIRECTORY_PULLED_AT = data.pulledAt as string;

export function getCollege(id: number): College | null {
  return BY_ID.get(id) ?? null;
}

export type TestPolicy = "required" | "recommended" | "optional" | "not-considered" | "unknown";

export function testPolicy(college: Pick<College, "testRequirements">): TestPolicy {
  switch (college.testRequirements) {
    case 1:
      return "required";
    case 2:
      return "recommended";
    case 5:
      return "optional";
    case 3:
      return "not-considered";
    default:
      return "unknown";
  }
}

export const TEST_POLICY_LABEL: Record<TestPolicy, string> = {
  required: "SAT/ACT required",
  recommended: "SAT/ACT recommended",
  optional: "Test-optional",
  "not-considered": "Tests not considered",
  unknown: "Test policy not reported",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ranked substring search over name and alias. Rank: the query starts the
// name (3) > starts a word in the name or alias (2) > appears anywhere (1);
// ties broken by undergraduate size so "michigan" puts the University of
// Michigan above smaller schools that also match. Pure and synchronous —
// the whole directory is in memory.
export function searchColleges(query: string, limit = 12): College[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const scored: { college: College; score: number }[] = [];
  for (const c of COLLEGES) {
    const name = normalize(c.name);
    const alias = c.alias ? normalize(c.alias) : "";
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(` ${q}`) || alias.split(/[ |]/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q) || alias.includes(q)) score = 1;
    if (score > 0) scored.push({ college: c, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.college.size ?? 0) - (a.college.size ?? 0) || a.college.name.localeCompare(b.college.name));
  return scored.slice(0, limit).map((s) => s.college);
}
