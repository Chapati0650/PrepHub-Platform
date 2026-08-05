-- AlterTable
ALTER TABLE "organization_domains" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "directoryVisible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "school_verification_tokens" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "requestedEmail" TEXT NOT NULL,
    "matchedOrganizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "school_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_verification_tokens_tokenHash_key" ON "school_verification_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "student_memberships_verifiedSchoolEmail_key" ON "student_memberships"("verifiedSchoolEmail");

-- AddForeignKey
ALTER TABLE "student_memberships" ADD CONSTRAINT "student_memberships_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_verification_tokens" ADD CONSTRAINT "school_verification_tokens_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_verification_tokens" ADD CONSTRAINT "school_verification_tokens_matchedOrganizationId_fkey" FOREIGN KEY ("matchedOrganizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

