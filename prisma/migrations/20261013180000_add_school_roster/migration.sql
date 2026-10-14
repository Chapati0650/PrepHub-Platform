-- District-controlled eligibility: the long-term onboarding path.
-- The district supplies who is eligible; a person only gains school access by
-- matching an entry. No accounts and no credentials are created on a
-- student's behalf.

ALTER TYPE "ActivationMethod" ADD VALUE IF NOT EXISTS 'ROSTER';

CREATE TYPE "EnrollmentMode" AS ENUM ('DOMAIN', 'ROSTER', 'ROSTER_OR_DOMAIN');

-- Defaults to DOMAIN so every existing organization keeps its current
-- behaviour; a district opts in to ROSTER when it takes control of eligibility.
ALTER TABLE "organizations"
  ADD COLUMN "enrollmentMode" "EnrollmentMode" NOT NULL DEFAULT 'DOMAIN';

CREATE TABLE "school_roster_entries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "externalStudentId" TEXT,
  "firstName" TEXT,
  "graduationYear" INTEGER,
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "school_roster_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "school_roster_entries_organizationId_email_key"
  ON "school_roster_entries"("organizationId", "email");
CREATE INDEX "school_roster_entries_email_idx" ON "school_roster_entries"("email");
CREATE INDEX "school_roster_entries_organizationId_removedAt_idx"
  ON "school_roster_entries"("organizationId", "removedAt");

ALTER TABLE "school_roster_entries"
  ADD CONSTRAINT "school_roster_entries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_roster_entries"
  ADD CONSTRAINT "school_roster_entries_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
