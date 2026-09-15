import type { Messages } from '../../types';
import { EN_CORE_MESSAGES } from './core';
import { EN_PROJECT_CATALOG_MESSAGES } from './project-catalog';
import { EN_PROJECT_SCHEDULING_MESSAGES } from './project-scheduling';
import { EN_PROJECT_SETTINGS_MESSAGES } from './project-settings';
import { EN_SLACK_MESSAGES } from './slack';
import { EN_TEAMS_MESSAGES } from './teams';
import { EN_TEAM_AI_MESSAGES } from './team-ai';
import { EN_RUNNERS_MESSAGES } from './runners';
import { EN_USAGE_MESSAGES } from './usage';
import { EN_RUNS_MESSAGES } from './runs';
import { EN_TEST_AUTHORING_MESSAGES } from './test-authoring';
import { EN_TEST_GROUPS_MESSAGES } from './test-groups';
import { EN_DEVICES_MESSAGES } from './devices';
import { EN_MCP_MESSAGES } from './mcp';

export const EN_MESSAGES: Messages = {
  ...EN_CORE_MESSAGES,
  ...EN_PROJECT_CATALOG_MESSAGES,
  ...EN_PROJECT_SCHEDULING_MESSAGES,
  ...EN_PROJECT_SETTINGS_MESSAGES,
  ...EN_SLACK_MESSAGES,
  ...EN_TEAMS_MESSAGES,
  ...EN_TEAM_AI_MESSAGES,
  ...EN_RUNNERS_MESSAGES,
  ...EN_USAGE_MESSAGES,
  ...EN_RUNS_MESSAGES,
  ...EN_TEST_AUTHORING_MESSAGES,
  ...EN_TEST_GROUPS_MESSAGES,
  ...EN_DEVICES_MESSAGES,
  ...EN_MCP_MESSAGES,
};
