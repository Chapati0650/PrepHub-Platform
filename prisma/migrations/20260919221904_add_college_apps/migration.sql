-- CreateEnum
CREATE TYPE "ApplicationPlatform" AS ENUM ('COMMON_APP', 'UC_APPLICATION', 'COALITION', 'APPLY_TEXAS', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationPlan" AS ENUM ('EARLY_DECISION', 'EARLY_DECISION_2', 'EARLY_ACTION', 'RESTRICTIVE_EARLY_ACTION', 'REGULAR_DECISION', 'ROLLING');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('RESEARCHING', 'APPLYING', 'SUBMITTED', 'ACCEPTED', 'WAITLISTED', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationItemKind" AS ENUM ('PROMPT', 'RECOMMENDATION', 'TEST_SCORES', 'FEE', 'FINANCIAL_AID', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationItemSource" AS ENUM ('PLATFORM', 'CURATED', 'STUDENT');

-- CreateTable
CREATE TABLE "college_apps_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "platforms" "ApplicationPlatform"[],
    "onboardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "college_apps_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_applications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "collegeId" INTEGER NOT NULL,
    "collegeName" TEXT NOT NULL,
    "platform" "ApplicationPlatform",
    "plan" "ApplicationPlan",
    "deadline" TIMESTAMP(3),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'RESEARCHING',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "college_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_items" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "applicationId" TEXT,
    "kind" "ApplicationItemKind" NOT NULL,
    "source" "ApplicationItemSource" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "wordLimit" INTEGER,
    "position" INTEGER NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_supplements" (
    "id" TEXT NOT NULL,
    "collegeId" INTEGER NOT NULL,
    "cycle" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "wordLimit" INTEGER,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "college_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "college_apps_profiles_userId_key" ON "college_apps_profiles"("userId");

-- CreateIndex
CREATE INDEX "college_applications_studentId_deadline_idx" ON "college_applications"("studentId", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "college_applications_studentId_collegeId_key" ON "college_applications"("studentId", "collegeId");

-- CreateIndex
CREATE INDEX "application_items_studentId_applicationId_position_idx" ON "application_items"("studentId", "applicationId", "position");

-- CreateIndex
CREATE INDEX "college_supplements_collegeId_cycle_position_idx" ON "college_supplements"("collegeId", "cycle", "position");

-- AddForeignKey
ALTER TABLE "college_apps_profiles" ADD CONSTRAINT "college_apps_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_applications" ADD CONSTRAINT "college_applications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_items" ADD CONSTRAINT "application_items_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_items" ADD CONSTRAINT "application_items_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "college_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
