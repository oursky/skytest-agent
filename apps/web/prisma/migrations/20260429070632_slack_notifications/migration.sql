-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "slackChannelId" TEXT,
ADD COLUMN     "slackChannelName" TEXT,
ADD COLUMN     "slackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slackMessageTemplate" TEXT,
ADD COLUMN     "slackUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "slackBotTokenEncrypted" TEXT,
ADD COLUMN     "slackBotUserId" TEXT,
ADD COLUMN     "slackConfigUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "slackTeamId" TEXT,
ADD COLUMN     "slackTeamName" TEXT;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "slackNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "slackNotifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "slackNotifyClaimedAt" TIMESTAMP(3),
ADD COLUMN     "slackNotifyError" TEXT;

-- CreateIndex
CREATE INDEX "TestRun_status_slackNotifiedAt_completedAt_idx" ON "TestRun"("status", "slackNotifiedAt", "completedAt");
