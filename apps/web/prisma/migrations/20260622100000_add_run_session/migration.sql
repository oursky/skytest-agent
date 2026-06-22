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
