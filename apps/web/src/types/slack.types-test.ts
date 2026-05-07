import type { TeamSlackSettings } from '@/types/slack';

type ForbiddenTeamSlackKeys = 'token' | 'slackBotTokenEncrypted' | 'maskedToken';
type AssertNoForbiddenKeys = Extract<keyof TeamSlackSettings, ForbiddenTeamSlackKeys> extends never ? true : never;

const assertTeamSlackSettingsNoTokenLeak: AssertNoForbiddenKeys = true;

void assertTeamSlackSettingsNoTokenLeak;
