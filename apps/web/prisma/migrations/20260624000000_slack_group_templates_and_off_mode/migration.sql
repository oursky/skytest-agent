-- Allow individual per-case Slack notifications to be turned off independently of test group notifications.
ALTER TYPE "SlackNotifyOn" ADD VALUE IF NOT EXISTS 'OFF';

-- Dedicated message templates for test group notifications (separate from per-case templates).
ALTER TABLE "Project" ADD COLUMN     "slackGroupFailureTemplate" TEXT,
ADD COLUMN     "slackGroupSuccessTemplate" TEXT;
