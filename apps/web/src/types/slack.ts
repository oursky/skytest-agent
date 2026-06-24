export const PROJECT_SLACK_NOTIFY_ON = {
    OFF: 'OFF',
    FAILED_ONLY: 'FAILED_ONLY',
    BOTH_PASSED_AND_FAILED: 'BOTH_PASSED_AND_FAILED',
} as const;

export type ProjectSlackNotifyOn = typeof PROJECT_SLACK_NOTIFY_ON[keyof typeof PROJECT_SLACK_NOTIFY_ON];

export interface TeamSlackSettings {
    hasToken: boolean;
    slackTeamName: string | null;
    slackBotUserId: string | null;
    slackConfigUpdatedAt: string | null;
}

export interface ProjectSlackSettings {
    slackEnabled: boolean;
    slackNotifyOn: ProjectSlackNotifyOn;
    slackChannelId: string | null;
    slackChannelName: string | null;
    slackFailureTemplate: string | null;
    slackSuccessTemplate: string | null;
    slackGroupNotifyEnabled: boolean;
    slackGroupFailureTemplate: string | null;
    slackGroupSuccessTemplate: string | null;
    slackUpdatedAt: string | null;
    parentTeamHasToken: boolean;
}
