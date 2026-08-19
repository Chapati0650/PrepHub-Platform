-- Defense-in-depth invariant, per explicit Owner request after a string of
-- account-identity bugs today: no application-code path currently assigns
-- role=OWNER except prisma/seed.ts's one-time Owner creation, but this makes
-- the invariant impossible to violate even by a future bug or a direct SQL
-- statement, rather than relying on every code path staying correct forever.
ALTER TABLE "users"
ADD CONSTRAINT "owner_role_single_email_check"
CHECK (role != 'OWNER' OR email = 'prithvirajchauhan0650@gmail.com');
