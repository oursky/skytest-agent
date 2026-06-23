-- Consolidated branch migration: test case kinds (login flows), run sessions, test groups, group notifications & schedule links

-- ===== Test case kind (login flows) =====
ALTER TABLE "TestCase" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEST';

DROP INDEX IF EXISTS "TestCase_projectId_updatedAt_idx";
CREATE INDEX "TestCase_projectId_kind_updatedAt_idx" ON "TestCase"("projectId", "kind", "updatedAt" DESC);

-- ===== Run sessions =====
-- AlterTable
ALTER TABLE "TestRun"
    ADD COLUMN "runSessionId" TEXT,
    ADD COLUMN "sessionPosition" INTEGER,
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEST',
    ADD COLUMN "reusedSession" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RunSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SINGLE',
    "status" TEXT NOT NULL,
    "triggeredByEmail" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'USER',
    "requiredCapability" TEXT,
    "assignedRunnerId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "slackNotifiedAt" TIMESTAMP(3),
    "slackNotifyClaimedAt" TIMESTAMP(3),
    "slackNotifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "slackNotifyError" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunSession_status_requiredCapability_createdAt_idx" ON "RunSession"("status", "requiredCapability", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "RunSession_projectId_createdAt_idx" ON "RunSession"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RunSession_assignedRunnerId_leaseExpiresAt_idx" ON "RunSession"("assignedRunnerId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "TestRun_runSessionId_sessionPosition_idx" ON "TestRun"("runSessionId", "sessionPosition");

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_runSessionId_fkey" FOREIGN KEY ("runSessionId") REFERENCES "RunSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSession" ADD CONSTRAINT "RunSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Test groups =====
-- AlterTable
ALTER TABLE "RunSession" ADD COLUMN "testGroupId" TEXT;

-- CreateTable
CREATE TABLE "TestGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayId" TEXT,
    "onFailure" TEXT NOT NULL DEFAULT 'STOP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestGroupLoginSession" (
    "id" TEXT NOT NULL,
    "testGroupId" TEXT NOT NULL,
    "loginFlowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TestGroupLoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestGroupItem" (
    "id" TEXT NOT NULL,
    "testGroupId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TestGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestGroup_projectId_updatedAt_idx" ON "TestGroup"("projectId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TestGroupItem_testGroupId_position_idx" ON "TestGroupItem"("testGroupId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TestGroupItem_testGroupId_testCaseId_key" ON "TestGroupItem"("testGroupId", "testCaseId");

-- CreateIndex
CREATE INDEX "RunSession_testGroupId_createdAt_idx" ON "RunSession"("testGroupId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "RunSession" ADD CONSTRAINT "RunSession_testGroupId_fkey" FOREIGN KEY ("testGroupId") REFERENCES "TestGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroup" ADD CONSTRAINT "TestGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroupItem" ADD CONSTRAINT "TestGroupItem_testGroupId_fkey" FOREIGN KEY ("testGroupId") REFERENCES "TestGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroupItem" ADD CONSTRAINT "TestGroupItem_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "TestGroupLoginSession_testGroupId_loginFlowId_key" ON "TestGroupLoginSession"("testGroupId", "loginFlowId");

-- CreateIndex
CREATE INDEX "TestGroupLoginSession_testGroupId_position_idx" ON "TestGroupLoginSession"("testGroupId", "position");

-- CreateIndex
CREATE INDEX "TestGroupLoginSession_loginFlowId_idx" ON "TestGroupLoginSession"("loginFlowId");

-- AddForeignKey
ALTER TABLE "TestGroupLoginSession" ADD CONSTRAINT "TestGroupLoginSession_testGroupId_fkey" FOREIGN KEY ("testGroupId") REFERENCES "TestGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestGroupLoginSession" ADD CONSTRAINT "TestGroupLoginSession_loginFlowId_fkey" FOREIGN KEY ("loginFlowId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Group notifications & schedule test-group links =====
-- AlterTable
ALTER TABLE "Project"
    ADD COLUMN "slackGroupNotifyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ScheduleTestGroup" (
    "scheduleId" TEXT NOT NULL,
    "testGroupId" TEXT NOT NULL,

    CONSTRAINT "ScheduleTestGroup_pkey" PRIMARY KEY ("scheduleId", "testGroupId")
);

-- CreateIndex
CREATE INDEX "ScheduleTestGroup_testGroupId_idx" ON "ScheduleTestGroup"("testGroupId");

-- AddForeignKey
ALTER TABLE "ScheduleTestGroup" ADD CONSTRAINT "ScheduleTestGroup_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTestGroup" ADD CONSTRAINT "ScheduleTestGroup_testGroupId_fkey" FOREIGN KEY ("testGroupId") REFERENCES "TestGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
