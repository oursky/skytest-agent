-- AlterTable
ALTER TABLE "Project"
    ADD COLUMN "slackGroupNotifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "slackGroupNotifyOn" "SlackNotifyOn" NOT NULL DEFAULT 'FAILED_ONLY',
    ADD COLUMN "slackGroupSuccessTemplate" TEXT,
    ADD COLUMN "slackGroupFailureTemplate" TEXT;

-- CreateTable
CREATE TABLE "ScheduleRunGroup" (
    "scheduleId" TEXT NOT NULL,
    "runGroupId" TEXT NOT NULL,

    CONSTRAINT "ScheduleRunGroup_pkey" PRIMARY KEY ("scheduleId", "runGroupId")
);

-- CreateIndex
CREATE INDEX "ScheduleRunGroup_runGroupId_idx" ON "ScheduleRunGroup"("runGroupId");

-- AddForeignKey
ALTER TABLE "ScheduleRunGroup" ADD CONSTRAINT "ScheduleRunGroup_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRunGroup" ADD CONSTRAINT "ScheduleRunGroup_runGroupId_fkey" FOREIGN KEY ("runGroupId") REFERENCES "RunGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
