-- AlterTable
ALTER TABLE "TestGroup" ADD COLUMN     "retryPolicy" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "RunSession" ADD COLUMN     "retryPolicy" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "retryPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1;

-- DropIndex
DROP INDEX "TestRun_runSessionId_sessionPosition_idx";

-- CreateIndex
CREATE INDEX "TestRun_runSessionId_sessionPosition_attempt_idx" ON "TestRun"("runSessionId", "sessionPosition", "attempt");
