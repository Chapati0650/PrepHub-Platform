// One-off helper: start an already-initialized embedded Postgres data dir
// without re-running initdb (used to recover this dev DB after its long-running
// process was accidentally killed mid-session).
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

const pg = new EmbeddedPostgres({
  databaseDir: path.join(process.cwd(), ".pgdata"),
  user: "postgres",
  password: "postgres",
  port: 5433,
  persistent: true,
});

await pg.start();
console.log("Postgres ready: postgresql://postgres:postgres@localhost:5433/prephub");

async function shutdown() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
