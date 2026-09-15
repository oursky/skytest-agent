import type { Messages } from '../../types';
import { ZH_HANS_CORE_MESSAGES } from './core';
import { ZH_HANS_PROJECT_CATALOG_MESSAGES } from './project-catalog';
import { ZH_HANS_PROJECT_SCHEDULING_MESSAGES } from './project-scheduling';
import { ZH_HANS_PROJECT_SETTINGS_MESSAGES } from './project-settings';
import { ZH_HANS_SLACK_MESSAGES } from './slack';
import { ZH_HANS_TEAMS_MESSAGES } from './teams';
import { ZH_HANS_TEAM_AI_MESSAGES } from './team-ai';
import { ZH_HANS_RUNNERS_MESSAGES } from './runners';
import { ZH_HANS_USAGE_MESSAGES } from './usage';
import { ZH_HANS_RUNS_MESSAGES } from './runs';
import { ZH_HANS_TEST_AUTHORING_MESSAGES } from './test-authoring';
import { ZH_HANS_TEST_GROUPS_MESSAGES } from './test-groups';
import { ZH_HANS_DEVICES_MESSAGES } from './devices';
import { ZH_HANS_MCP_MESSAGES } from './mcp';

export const ZH_HANS_MESSAGES: Messages = {
  ...ZH_HANS_CORE_MESSAGES,
  ...ZH_HANS_PROJECT_CATALOG_MESSAGES,
  ...ZH_HANS_PROJECT_SCHEDULING_MESSAGES,
  ...ZH_HANS_PROJECT_SETTINGS_MESSAGES,
  ...ZH_HANS_SLACK_MESSAGES,
  ...ZH_HANS_TEAMS_MESSAGES,
  ...ZH_HANS_TEAM_AI_MESSAGES,
  ...ZH_HANS_RUNNERS_MESSAGES,
  ...ZH_HANS_USAGE_MESSAGES,
  ...ZH_HANS_RUNS_MESSAGES,
  ...ZH_HANS_TEST_AUTHORING_MESSAGES,
  ...ZH_HANS_TEST_GROUPS_MESSAGES,
  ...ZH_HANS_DEVICES_MESSAGES,
  ...ZH_HANS_MCP_MESSAGES,
};
