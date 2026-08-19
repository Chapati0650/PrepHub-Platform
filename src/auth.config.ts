import type { NextAuthConfig } from "next-auth";

// Edge-safe base config — no providers, no Prisma adapter, no DB-touching
// callbacks. This is what middleware.ts uses directly (it must run without a
// Postgres connection, since Netlify's adapter doesn't support Node.js-
// runtime middleware). auth.ts extends this with real providers and the
// DB-backed jwt callback for everywhere else.
//
// Middleware never needs the jwt callback here: it only ever reads an
// *already-signed* token produced by the full config in auth.ts (a prior
// real sign-in), so the base framework's JWT decode already has
// token.userId/token.role available with no custom callback required — this
// config only needs the session callback to surface those onto
// session.user, which is what middleware.ts actually reads.
//
// This does not weaken session revocation: src/app/(app)/layout.tsx already
// calls the full auth() (with the DB tokenVersion check) on every protected
// page render and redirects to /login if it's invalid, independent of
// whatever middleware decided. Middleware dropping the DB check only means
// a revoked-but-not-yet-expired token might pass middleware's fast-path
// redirect and get caught one layer later at the layout instead — same
// user-visible outcome (redirected to /login), same request.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
