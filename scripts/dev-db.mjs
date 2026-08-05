// Runs a real, native local Postgres for development/E2E — no Docker or root
// required (embedded-postgres bundles a real Postgres binary). We use this
// instead of `npx prisma dev`'s local proxy because that proxy corrupts
// prepared-statement state when a $transaction() overlaps with other
// concurrent queries (Postgres error 08P01) — confirmed as a proxy-specific
// issue, not present against this or any real hosted Postgres. See README.
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

const PORT = 5433;

const pg = new EmbeddedPostgres({
  databaseDir: path.join(process.cwd(), ".pgdata"),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

await pg.initialise();
await pg.start();

try {
  await pg.createDatabase("prephub");
} catch {
  // already exists from a previous run — fine
}

console.log(`Postgres ready: postgresql://postgres:postgres@localhost:${PORT}/prephub`);
console.log("Press Ctrl+C to stop.");

async function shutdown() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
