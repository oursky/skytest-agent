-- CreateEnum
CREATE TYPE "SchedulePatternType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN "triggerSource" TEXT NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "patternType" "SchedulePatternType" NOT NULL DEFAULT 'DAILY',
    "cronExpression" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastEnqueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTestCase" (
    "scheduleId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,

    CONSTRAINT "ScheduleTestCase_pkey" PRIMARY KEY ("scheduleId", "testCaseId")
);

-- CreateIndex
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Schedule_projectId_idx" ON "Schedule"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleTestCase_testCaseId_idx" ON "ScheduleTestCase"("testCaseId");

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTestCase" ADD CONSTRAINT "ScheduleTestCase_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTestCase" ADD CONSTRAINT "ScheduleTestCase_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
