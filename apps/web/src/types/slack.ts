export interface TeamSlackSettings {
    hasToken: boolean;
    slackTeamName: string | null;
    slackBotUserId: string | null;
    slackConfigUpdatedAt: string | null;
}

export interface ProjectSlackSettings {
    slackEnabled: boolean;
    slackChannelId: string | null;
    slackChannelName: string | null;
    slackMessageTemplate: string | null;
    slackUpdatedAt: string | null;
    parentTeamHasToken: boolean;
}

export interface SlackUserSummary {
    id: string;
    displayName: string;
    realName: string | null;
    email: string | null;
}
