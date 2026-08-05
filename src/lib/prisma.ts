import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logDatabaseConnectivityFailure } from "@/lib/logger";

// Substrings Prisma's query-engine error messages use for a database that's
// actually unreachable (vs. a query/data problem) — see
// https://www.prisma.io/docs/orm/reference/error-reference. Matched against
// the emitted "error" event's message rather than an error-code check so
// this can hook in via Prisma's event-based logging (no client extension,
// no change to `prisma`'s exported type — see the note below on why that
// matters here).
const CONNECTIVITY_ERROR_PATTERNS = [/can't reach database/i, /connection.*(timed out|refused|terminated)/i, /too many connections/i];

function isConnectivityErrorMessage(message: string): boolean {
  return CONNECTIVITY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

function createClient(): PrismaClient {
  const client = new PrismaClient({ adapter, log: [{ level: "error", emit: "event" }] });

  // Global Engineering Requirements §16 — "Database connectivity failures" is
  // a required logging category. Event-based logging (rather than a $extends
  // client extension) is deliberate: an extension changes `prisma`'s exported
  // type in a way that ripples into every `$transaction(async (tx) => ...)`
  // callback typed against the base `Prisma.TransactionClient` elsewhere in
  // this codebase — confirmed via a real `tsc` failure while building this.
  // The event hook is purely observational and can't affect query behavior
  // or types.
  client.$on("error", (event) => {
    if (isConnectivityErrorMessage(event.message)) {
      logDatabaseConnectivityFailure("Database connectivity failure", { errorType: event.message });
    }
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
