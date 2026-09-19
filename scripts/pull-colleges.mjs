// Builds the college directory (src/lib/colleges/data/colleges.json) from the
// U.S. Department of Education's College Scorecard bulk download.
//
// Run once a year, after Scorecard's fall refresh, and commit the result:
//   node scripts/pull-colleges.mjs
//
// Uses the bulk CSV rather than the API: the API needs a key and the shared
// DEMO_KEY allows ten requests an hour, while the ~100 MB institution-level
// CSV is public, unauthenticated, and one request. The download URL carries
// the release date; find the current one at https://collegescorecard.ed.gov/data/
// ("Most Recent Institution-Level Data") and update DOWNLOAD_URL below.
//
// Why a committed JSON and not a database table: ~1,900 rows of public-domain
// data that change yearly don't need a migration or a production seeding
// step; the app searches them in memory and the tracker stores the Scorecard
// id. The Owner's curated supplements live in the DB keyed by that id.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const DOWNLOAD_URL = "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_06102026.zip";
const RELEASE = "2026-06-10";
const CSV_NAME = "Most-Recent-Cohorts-Institution.csv";

// Reads one named entry out of a zip. Dependency-free and cross-platform on
// purpose: shelling out to `tar`/`unzip` picked up Git Bash's GNU tar on
// Windows, which reads "C:\…" as a remote host. Walks the central directory
// (end-of-central-directory record → entries) and inflates the raw deflate
// stream of the entry we want. No ZIP64 needed: the archive is ~100 MB.
function readZipEntry(buf, wantedName) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error("not a zip file");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf-8", p + 46, p + 46 + nameLen);
    if (name === wantedName) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wantedName} not found in the archive`);
}

// RFC-4180 line parser — INSTNM and ALIAS contain commas and quotes.
function parseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

// Scorecard writes several spellings of "no value"; "NA" is the one that
// bites (it looked like a real alias for 1,900 schools).
const NULLS = new Set(["", "NULL", "NA", "PrivacySuppressed"]);
const num = (v) => (NULLS.has(v) ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v) => (num(v) === null ? null : Math.trunc(num(v)));
const str = (v) => (NULLS.has(v) ? null : v);

process.stdout.write("downloading… ");
const res = await fetch(DOWNLOAD_URL);
if (!res.ok) throw new Error(`HTTP ${res.status} — the release URL has probably moved; see collegescorecard.ed.gov/data`);
const zip = Buffer.from(await res.arrayBuffer());
process.stdout.write("done\nextracting… ");
const text = readZipEntry(zip, CSV_NAME).toString("utf-8");
process.stdout.write("done\n");

const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]);
const col = (name) => {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`column ${name} not in this release`);
  return i;
};
const C = Object.fromEntries(
  ["UNITID", "INSTNM", "ALIAS", "CITY", "STABBR", "INSTURL", "CONTROL", "UGDS", "ADM_RATE", "SATVR25", "SATVR75", "SATMT25", "SATMT75", "ADMCON7", "TUITIONFEE_IN", "TUITIONFEE_OUT", "PREDDEG", "CURROPER"].map((n) => [n, col(n)]),
);

const colleges = [];
for (const line of lines.slice(1)) {
  const f = parseCsvLine(line);
  if (f[C.PREDDEG] !== "3" || f[C.CURROPER] !== "1") continue; // bachelor's-granting, operating
  const vr25 = num(f[C.SATVR25]), vr75 = num(f[C.SATVR75]), mt25 = num(f[C.SATMT25]), mt75 = num(f[C.SATMT75]);
  colleges.push({
    id: int(f[C.UNITID]),
    name: f[C.INSTNM],
    alias: str(f[C.ALIAS]),
    city: f[C.CITY],
    state: f[C.STABBR],
    url: str(f[C.INSTURL]),
    ownership: int(f[C.CONTROL]), // 1 public, 2 private nonprofit, 3 private for-profit
    size: int(f[C.UGDS]),
    admissionRate: num(f[C.ADM_RATE]),
    // Composite 25th/75th as the sum of the section percentiles — the
    // standard approximation; Scorecard publishes no composite range.
    sat25: vr25 !== null && mt25 !== null ? vr25 + mt25 : null,
    sat75: vr75 !== null && mt75 !== null ? vr75 + mt75 : null,
    // ADMCON7: 1 required, 2 recommended, 3 neither, 4 unknown, 5 considered but not required
    testRequirements: int(f[C.ADMCON7]),
    tuitionInState: int(f[C.TUITIONFEE_IN]),
    tuitionOutOfState: int(f[C.TUITIONFEE_OUT]),
  });
}
colleges.sort((a, b) => a.name.localeCompare(b.name));

const dest = path.join("src", "lib", "colleges", "data", "colleges.json");
await mkdir(path.dirname(dest), { recursive: true });
await writeFile(
  dest,
  JSON.stringify({
    pulledAt: new Date().toISOString().slice(0, 10),
    source: `College Scorecard, U.S. Department of Education (Most-Recent-Cohorts-Institution, ${RELEASE} release)`,
    colleges,
  }),
);
const withSat = colleges.filter((c) => c.sat25 !== null).length;
console.log(`wrote ${colleges.length} colleges (${withSat} with SAT ranges) to ${dest}`);
