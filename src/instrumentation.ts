import type { Instrumentation } from "next";
import { logServerError } from "@/lib/logger";

// Global Engineering Requirements §16 — "Unexpected server errors" is a
// required logging category. This hook is Next.js's own centralized capture
// point for uncaught errors across Server Components, Route Handlers, and
// Server Actions, so it's a backstop that needs no per-callsite try/catch:
// anything not already caught and logged with a more specific category
// (auth failure, generation failure, etc.) lands here instead of silently
// vanishing into the default error page.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;

  logServerError("Unhandled server error", {
    errorType: message,
    digest,
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
