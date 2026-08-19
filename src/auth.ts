import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { sendWelcomeEmail } from "@/lib/auth/account";
import { authConfig } from "./auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
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

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash || user.deletedAt) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.firstName,
          image: user.image,
        };
      },
    }),
  ],
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
        select: { role: true, tokenVersion: true, deletedAt: true },
      });
      if (!dbUser || dbUser.deletedAt) return {};
      if (token.tokenVersion !== undefined && token.tokenVersion !== dbUser.tokenVersion) {
        return {};
      }
      token.role = dbUser.role;
      token.tokenVersion = dbUser.tokenVersion;
      return token;
    },
  },
});
