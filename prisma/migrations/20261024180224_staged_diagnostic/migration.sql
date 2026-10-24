-- CreateEnum
CREATE TYPE "DiagnosticFormat" AS ENUM ('FULL_21', 'STAGED');

-- AlterTable
ALTER TABLE "diagnostic_attempts" ADD COLUMN     "waivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "diagnostic_sessions" ADD COLUMN     "format" "DiagnosticFormat" NOT NULL DEFAULT 'FULL_21';
