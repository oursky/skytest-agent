import type { Messages } from '../../types';
import { ZH_HANT_CORE_MESSAGES } from './core';
import { ZH_HANT_PROJECT_CATALOG_MESSAGES } from './project-catalog';
import { ZH_HANT_PROJECT_SCHEDULING_MESSAGES } from './project-scheduling';
import { ZH_HANT_PROJECT_SETTINGS_MESSAGES } from './project-settings';
import { ZH_HANT_SLACK_MESSAGES } from './slack';
import { ZH_HANT_TEAMS_MESSAGES } from './teams';
import { ZH_HANT_TEAM_AI_MESSAGES } from './team-ai';
import { ZH_HANT_RUNNERS_MESSAGES } from './runners';
import { ZH_HANT_USAGE_MESSAGES } from './usage';
import { ZH_HANT_RUNS_MESSAGES } from './runs';
import { ZH_HANT_TEST_AUTHORING_MESSAGES } from './test-authoring';
import { ZH_HANT_TEST_GROUPS_MESSAGES } from './test-groups';
import { ZH_HANT_DEVICES_MESSAGES } from './devices';
import { ZH_HANT_MCP_MESSAGES } from './mcp';

export const ZH_HANT_MESSAGES: Messages = {
  ...ZH_HANT_CORE_MESSAGES,
  ...ZH_HANT_PROJECT_CATALOG_MESSAGES,
  ...ZH_HANT_PROJECT_SCHEDULING_MESSAGES,
  ...ZH_HANT_PROJECT_SETTINGS_MESSAGES,
  ...ZH_HANT_SLACK_MESSAGES,
  ...ZH_HANT_TEAMS_MESSAGES,
  ...ZH_HANT_TEAM_AI_MESSAGES,
  ...ZH_HANT_RUNNERS_MESSAGES,
  ...ZH_HANT_USAGE_MESSAGES,
  ...ZH_HANT_RUNS_MESSAGES,
  ...ZH_HANT_TEST_AUTHORING_MESSAGES,
  ...ZH_HANT_TEST_GROUPS_MESSAGES,
  ...ZH_HANT_DEVICES_MESSAGES,
  ...ZH_HANT_MCP_MESSAGES,
};
