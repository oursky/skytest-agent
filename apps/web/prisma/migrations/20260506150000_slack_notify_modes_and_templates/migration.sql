CREATE TYPE "SlackNotifyOn" AS ENUM ('FAILED_ONLY', 'BOTH_PASSED_AND_FAILED');

ALTER TABLE "Project"
ADD COLUMN "slackNotifyOn" "SlackNotifyOn" NOT NULL DEFAULT 'FAILED_ONLY',
ADD COLUMN "slackFailureTemplate" TEXT,
ADD COLUMN "slackSuccessTemplate" TEXT;

UPDATE "Project"
SET "slackFailureTemplate" = "slackMessageTemplate"
WHERE "slackMessageTemplate" IS NOT NULL;

ALTER TABLE "Project" DROP COLUMN "slackMessageTemplate";
