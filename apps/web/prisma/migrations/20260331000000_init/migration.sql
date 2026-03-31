-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "RateLimitWindow" (
    "bucketKey" TEXT NOT NULL,
    "windowStartMs" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitWindow_pkey" PRIMARY KEY ("bucketKey","windowStartMs")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "aiActions" INTEGER NOT NULL,
    "testRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "openRouterKeyEncrypted" TEXT,
    "openRouterKeyUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "role" "TeamRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxConcurrentRuns" INTEGER NOT NULL DEFAULT 1,
    "teamId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "displayId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "prompt" TEXT,
    "steps" TEXT,
    "browserConfig" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseFile" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "triggeredByEmail" TEXT,
    "requiredCapability" TEXT,
    "requiredRunnerKind" TEXT,
    "requestedDeviceId" TEXT,
    "requestedRunnerId" TEXT,
    "assignedRunnerId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "nextEventSequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "logs" TEXT,
    "error" TEXT,
    "configurationSnapshot" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunFile" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRunFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "group" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseConfig" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "group" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCaseConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runner" (
    "id" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "hostFingerprint" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "protocolVersion" TEXT NOT NULL,
    "runnerVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AndroidResourceLock" (
    "hostFingerprint" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AndroidResourceLock_pkey" PRIMARY KEY ("hostFingerprint","resourceKey")
);

-- CreateTable
CREATE TABLE "RunnerToken" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "runnerId" TEXT,
    "createdByUserId" TEXT,
    "kind" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunnerDevice" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "metadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunnerDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "artifactKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimitWindow_updatedAt_idx" ON "RateLimitWindow"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_authId_key" ON "User"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_testRunId_key" ON "UsageRecord"("testRunId");

-- CreateIndex
CREATE INDEX "UsageRecord_projectId_createdAt_idx" ON "UsageRecord"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UsageRecord_actorUserId_createdAt_idx" ON "UsageRecord"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UsageRecord_projectId_actorUserId_createdAt_idx" ON "UsageRecord"("projectId", "actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Team_updatedAt_idx" ON "Team"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TeamMembership_userId_teamId_idx" ON "TeamMembership"("userId", "teamId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_role_idx" ON "TeamMembership"("teamId", "role");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_email_idx" ON "TeamMembership"("teamId", "email");

-- CreateIndex
CREATE INDEX "TeamMembership_email_idx" ON "TeamMembership"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_userId_key" ON "TeamMembership"("teamId", "userId");

-- CreateIndex
CREATE INDEX "Project_teamId_updatedAt_idx" ON "Project"("teamId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Project_createdByUserId_updatedAt_idx" ON "Project"("createdByUserId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TestCase_projectId_updatedAt_idx" ON "TestCase"("projectId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TestCaseFile_testCaseId_idx" ON "TestCaseFile"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseFile_testCaseId_filename_key" ON "TestCaseFile"("testCaseId", "filename");

-- CreateIndex
CREATE INDEX "TestRun_testCaseId_createdAt_idx" ON "TestRun"("testCaseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TestRun_status_idx" ON "TestRun"("status");

-- CreateIndex
CREATE INDEX "TestRun_status_requiredCapability_createdAt_idx" ON "TestRun"("status", "requiredCapability", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "TestRun_assignedRunnerId_leaseExpiresAt_idx" ON "TestRun"("assignedRunnerId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "TestRun_requestedDeviceId_idx" ON "TestRun"("requestedDeviceId");

-- CreateIndex
CREATE INDEX "TestRun_requestedRunnerId_idx" ON "TestRun"("requestedRunnerId");

-- CreateIndex
CREATE INDEX "TestRun_deletedAt_completedAt_idx" ON "TestRun"("deletedAt", "completedAt" ASC);

-- CreateIndex
CREATE INDEX "TestRunFile_runId_idx" ON "TestRunFile"("runId");

-- CreateIndex
CREATE INDEX "ProjectConfig_projectId_idx" ON "ProjectConfig"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectConfig_projectId_name_key" ON "ProjectConfig"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "TestCaseConfig_testCaseId_idx" ON "TestCaseConfig"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseConfig_testCaseId_name_key" ON "TestCaseConfig"("testCaseId", "name");

-- CreateIndex
CREATE INDEX "Runner_teamId_kind_idx" ON "Runner"("teamId", "kind");

-- CreateIndex
CREATE INDEX "Runner_teamId_status_lastSeenAt_idx" ON "Runner"("teamId", "status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AndroidResourceLock_runId_key" ON "AndroidResourceLock"("runId");

-- CreateIndex
CREATE INDEX "AndroidResourceLock_runnerId_leaseExpiresAt_idx" ON "AndroidResourceLock"("runnerId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AndroidResourceLock_leaseExpiresAt_idx" ON "AndroidResourceLock"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunnerToken_hash_key" ON "RunnerToken"("hash");

-- CreateIndex
CREATE INDEX "RunnerToken_teamId_kind_expiresAt_idx" ON "RunnerToken"("teamId", "kind", "expiresAt");

-- CreateIndex
CREATE INDEX "RunnerToken_runnerId_kind_expiresAt_idx" ON "RunnerToken"("runnerId", "kind", "expiresAt");

-- CreateIndex
CREATE INDEX "RunnerDevice_runnerId_state_lastSeenAt_idx" ON "RunnerDevice"("runnerId", "state", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunnerDevice_runnerId_deviceId_key" ON "RunnerDevice"("runnerId", "deviceId");

-- CreateIndex
CREATE INDEX "TestRunEvent_runId_createdAt_idx" ON "TestRunEvent"("runId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "TestRunEvent_createdAt_idx" ON "TestRunEvent"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TestRunEvent_runId_sequence_key" ON "TestRunEvent"("runId", "sequence");

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseFile" ADD CONSTRAINT "TestCaseFile_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_assignedRunnerId_fkey" FOREIGN KEY ("assignedRunnerId") REFERENCES "Runner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunFile" ADD CONSTRAINT "TestRunFile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConfig" ADD CONSTRAINT "ProjectConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseConfig" ADD CONSTRAINT "TestCaseConfig_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runner" ADD CONSTRAINT "Runner_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AndroidResourceLock" ADD CONSTRAINT "AndroidResourceLock_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AndroidResourceLock" ADD CONSTRAINT "AndroidResourceLock_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunnerToken" ADD CONSTRAINT "RunnerToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunnerToken" ADD CONSTRAINT "RunnerToken_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunnerToken" ADD CONSTRAINT "RunnerToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunnerDevice" ADD CONSTRAINT "RunnerDevice_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunEvent" ADD CONSTRAINT "TestRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
