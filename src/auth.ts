import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { cache } from "react";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { sendWelcomeEmail } from "@/lib/auth/account";
import { checkRateLimitEnforced, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuthFailure, logEvent, logRateLimitExceeded } from "@/lib/logger";
import { authConfig } from "./auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Thrown from `authorize` when a login is over its rate limit. Auth.js passes
 * a CredentialsSignin subclass through untouched, so `loginAction` can tell
 * "slow down" apart from "wrong password" by its type.
 */
export class LoginRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const { handlers, signIn, signOut, auth: uncachedAuth } = NextAuth({
  ...authConfig,
  adapter: {
    ...PrismaAdapter(prisma),
    // PRD-001: the User model only ever stores a first name (no `name`
    // column exists at all — "only first name is collected, never last
    // name/username/phone"). The default PrismaAdapter assumes a `name`
    // column and writes it directly, which fails Prisma's required-field
    // validation on `firstName` for every brand-new OAuth sign-in
    // (confirmed via a real "Argument `firstName` is missing" crash on
    // first Google sign-up). Google's profile gives a full display name;
    // take its first token as a reasonable first name.
    createUser: async (newUser) => {
      const firstName = newUser.name?.trim().split(/\s+/)[0] || "Student";
      const user = await prisma.user.create({
        data: { email: newUser.email, image: newUser.image, emailVerified: newUser.emailVerified, firstName },
      });
      // Best-effort — mirrors the credentials-signup path in
      // src/lib/auth/account.ts's createAccount.
      await sendWelcomeEmail(user);
      void track(FUNNEL_EVENTS.SIGNED_UP, { userId: user.id, path: "/api/auth/google-sign-in" });
      return { ...user, name: user.firstName };
    },
  },
  // session/pages come from authConfig above. PRD-001: Credentials sign-in is
  // incompatible with database sessions in Auth.js, so the whole app uses
  // JWT sessions. "Log out all devices" / password changes / account
  // deletion invalidate outstanding tokens via User.tokenVersion (see jwt
  // callback below).
  providers: [
    Google({
      // PRD-001: a Google sign-in with a verified email that matches an existing
      // PrepHub account must link to that account rather than create a duplicate.
      // Safe here because Google only reports emails it has itself verified.
      allowDangerousEmailAccountLinking: true,
      // Without this, Google silently reuses whichever Google account is
      // already active in the browser instead of showing the account
      // picker — confirmed as the real cause of a report that every
      // "different" account still landed on Owner in a normal (non-incognito)
      // browser, while incognito (no existing Google session) worked fine:
      // it wasn't linking accounts, it was silently authenticating as the
      // same Google identity every time. Forces the chooser on every sign-in.
      authorization: { params: { prompt: "select_account" } },
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // GER §3's login limit lives here rather than in loginAction, because
        // this function is also reachable directly: Auth.js serves
        // POST /api/auth/callback/credentials from the same route handler, and
        // a limit only the login form passed through left that endpoint open
        // to unlimited password guessing. Keyed by both IP and the targeted
        // email; see RATE_LIMITS for why the two sizes differ so much.
        const ip = await getClientIp();
        const [ipLimit, emailLimit] = await Promise.all([
          checkRateLimitEnforced(`login:ip:${ip}`, RATE_LIMITS.LOGIN_PER_IP),
          checkRateLimitEnforced(`login:email:${email}`, RATE_LIMITS.LOGIN_PER_EMAIL),
        ]);
        if (!ipLimit.allowed || !emailLimit.allowed) {
          logRateLimitExceeded("Login rate limit exceeded", { ip, email });
          throw new LoginRateLimited();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = !!user?.passwordHash && !user.deletedAt && (await verifyPassword(password, user.passwordHash));
        if (!user?.passwordHash || !valid) {
          logAuthFailure("Login failed: incorrect credentials", { email, ip });
          return null;
        }

        // The password is correct and in hand, so this is the one moment the
        // stored hash can be re-costed without asking the user for anything.
        // Deliberately not awaited: it must never add latency to the login it
        // is trying to make faster, and a failure just means the account is
        // migrated on some later sign-in instead.
        if (needsRehash(user.passwordHash)) {
          void hashPassword(password)
            .then((passwordHash) => prisma.user.update({ where: { id: user.id }, data: { passwordHash } }))
            .catch(() => {});
        }

        return {
          id: user.id,
          email: user.email,
          name: user.firstName,
          image: user.image,
        };
      },
    }),
  ],
  events: {
    // Google has verified the address it hands us. Auth.js nonetheless creates
    // an OAuth user with `emailVerified: null` and never sets it when linking,
    // so a Google student on a partner district's domain was asked to confirm
    // an address Google had already confirmed: district enrollment acts only
    // on a verified email (src/lib/district/enrollment.ts). Done on every
    // Google sign-in, so accounts made before this existed are fixed the next
    // time their owner signs in.
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.id) return;
      try {
        await prisma.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: new Date() } });
      } catch (err) {
        logEvent("AUTH_FAILURE", "Could not record a Google-verified email", { userId: user.id, error: String(err) });
      }
    },
    // Linking Google to an existing account by email (allowDangerousEmailAccountLinking
    // above) proves the person signing in owns the address. It proves nothing
    // about whoever set the account's password: a password signup never
    // confirms its email, so anyone could have registered this address first
    // and be waiting for its real owner to arrive. When the address had never
    // been confirmed, that password is dropped and every other session ended,
    // so the account answers to the Google sign-in alone. "Forgot password"
    // sets a new one through the owner's own inbox. This runs before the
    // sign-in's own token is issued, so the jwt callback reads the new
    // tokenVersion and the person signing in now stays signed in.
    async linkAccount({ user, account }) {
      if (account.provider !== "google" || !user.id) return;
      try {
        await prisma.user.updateMany({
          where: { id: user.id, emailVerified: null, passwordHash: { not: null } },
          data: { emailVerified: new Date(), passwordHash: null, tokenVersion: { increment: 1 } },
        });
      } catch (err) {
        logEvent("AUTH_FAILURE", "Could not secure an account on Google linking", { userId: user.id, error: String(err) });
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      if (!token.userId) return token;

      // Checked on every call so a revoked session (password change, "log out all
      // devices", account deletion) stops working immediately rather than at next
      // token expiry. Trades a DB read per request for correct instant revocation.
      // Deliberately only wired up here, not in the Edge-safe authConfig middleware
      // uses (see auth.config.ts) — src/app/(app)/layout.tsx already calls this full
      // auth() on every protected page render, so revocation still takes effect on
      // the very next real page load either way.
      const dbUser = await prisma.user.findUnique({
        where: { id: token.userId as string },
        select: { role: true, tokenVersion: true, deletedAt: true, firstName: true },
      });
      if (!dbUser || dbUser.deletedAt) return {};
      if (token.tokenVersion !== undefined && token.tokenVersion !== dbUser.tokenVersion) {
        return {};
      }
      token.role = dbUser.role;
      token.tokenVersion = dbUser.tokenVersion;
      // Refreshed from the DB rather than trusted from sign-in: both
      // sign-in paths set `name: user.firstName`, but only on the *first*
      // Google sign-up (createUser above). A returning Google user comes
      // back through the adapter's getUser, which hands Auth.js the raw
      // Prisma row — and User has no `name` column (PRD-001, first name
      // only) — so token.name was undefined for every returning Google
      // session and the app shell fell back to showing the email. Doing it
      // here also means a first-name edit in Settings is reflected on the
      // very next request instead of at the next sign-in.
      token.name = dbUser.firstName;
      return token;
    },
  },
});

export { handlers, signIn, signOut };

/**
 * Memoized per request. `auth()` is not free: its jwt callback reads the user
 * row on every call so a revoked session stops working immediately (see the
 * callback above). The app layout calls it and then so does the page, so every
 * authenticated render paid for that lookup at least twice — confirmed by
 * query logging on /home, which showed two identical role/tokenVersion
 * selects before anything else ran.
 *
 * Safe because `auth()` is always called with no arguments here (verified
 * across the codebase), so there is nothing to key the cache on, and React
 * `cache` degrades to a plain call outside a request scope. Revocation is
 * unaffected: the cache lives for one request, so the next one re-reads.
 */
export const auth = cache(uncachedAuth);
