import { MIDSCENE_MODEL_DEFAULTS } from '@/lib/runtime/model-families';
import { ConfigurationError } from '@/lib/core/errors';

export type MidsceneModelConfig = Record<string, string | number>;

const MIDSCENE_MODEL_ENV_DEFAULTS = {
    MIDSCENE_MODEL_BASE_URL: MIDSCENE_MODEL_DEFAULTS.baseUrl,
    MIDSCENE_MODEL_NAME: MIDSCENE_MODEL_DEFAULTS.mainModel,
    MIDSCENE_MODEL_FAMILY: MIDSCENE_MODEL_DEFAULTS.mainModelFamily,
    MIDSCENE_PLANNING_MODEL_BASE_URL: MIDSCENE_MODEL_DEFAULTS.baseUrl,
    MIDSCENE_PLANNING_MODEL_NAME: MIDSCENE_MODEL_DEFAULTS.planningModel,
    MIDSCENE_PLANNING_MODEL_FAMILY: MIDSCENE_MODEL_DEFAULTS.planningModelFamily,
    MIDSCENE_INSIGHT_MODEL_BASE_URL: MIDSCENE_MODEL_DEFAULTS.baseUrl,
    MIDSCENE_INSIGHT_MODEL_NAME: MIDSCENE_MODEL_DEFAULTS.insightModel,
    MIDSCENE_INSIGHT_MODEL_FAMILY: MIDSCENE_MODEL_DEFAULTS.insightModelFamily,
    MIDSCENE_MODEL_TEMPERATURE: String(MIDSCENE_MODEL_DEFAULTS.temperature),
} as const;

type MidsceneModelEnvVar = keyof typeof MIDSCENE_MODEL_ENV_DEFAULTS;
const VISIBLE_ASCII_KEY_PATTERN = /^[\x21-\x7E]+$/;
const INVALID_API_KEY_FORMAT_MESSAGE = 'API key must use visible ASCII characters only (no spaces, newlines, or emojis)';

export interface BuildMidsceneModelConfigOptions {
    baseUrl?: string;
    mainModel?: string;
    mainModelFamily?: string;
    planningModel?: string;
    planningModelFamily?: string;
    insightModel?: string;
    insightModelFamily?: string;
    temperature?: number;
}

const MIDSCENE_MODEL_OVERRIDE_ENV: Record<MidsceneModelEnvVar, string> = {
    MIDSCENE_MODEL_BASE_URL: 'SKYTEST_MIDSCENE_MODEL_BASE_URL',
    MIDSCENE_MODEL_NAME: 'SKYTEST_MIDSCENE_MODEL_NAME',
    MIDSCENE_MODEL_FAMILY: 'SKYTEST_MIDSCENE_MODEL_FAMILY',
    MIDSCENE_PLANNING_MODEL_BASE_URL: 'SKYTEST_MIDSCENE_PLANNING_MODEL_BASE_URL',
    MIDSCENE_PLANNING_MODEL_NAME: 'SKYTEST_MIDSCENE_PLANNING_MODEL_NAME',
    MIDSCENE_PLANNING_MODEL_FAMILY: 'SKYTEST_MIDSCENE_PLANNING_MODEL_FAMILY',
    MIDSCENE_INSIGHT_MODEL_BASE_URL: 'SKYTEST_MIDSCENE_INSIGHT_MODEL_BASE_URL',
    MIDSCENE_INSIGHT_MODEL_NAME: 'SKYTEST_MIDSCENE_INSIGHT_MODEL_NAME',
    MIDSCENE_INSIGHT_MODEL_FAMILY: 'SKYTEST_MIDSCENE_INSIGHT_MODEL_FAMILY',
    MIDSCENE_MODEL_TEMPERATURE: 'SKYTEST_MIDSCENE_MODEL_TEMPERATURE',
};

function resolveMidsceneModelValue(name: MidsceneModelEnvVar): string {
    const overrideName = MIDSCENE_MODEL_OVERRIDE_ENV[name];
    const skytestValue = process.env[overrideName]?.trim();
    if (skytestValue) {
        return skytestValue;
    }

    const currentValue = process.env[name]?.trim();
    if (currentValue) {
        return currentValue;
    }

    return MIDSCENE_MODEL_ENV_DEFAULTS[name];
}

function inferModelFamily(modelName: string): string {
    const rawFamily = modelName.split('/')[0]?.toLowerCase() ?? '';

    switch (rawFamily) {
        case 'google':
        case 'gemini':
            return 'gemini';
        case 'qwen':
            return 'qwen3.6';
        default:
            return 'gpt-5';
    }
}

export function validateMidsceneApiKey(apiKey: string): string | null {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
        return 'API key is required';
    }

    if (!VISIBLE_ASCII_KEY_PATTERN.test(trimmedApiKey)) {
        return INVALID_API_KEY_FORMAT_MESSAGE;
    }

    return null;
}

export function buildMidsceneModelConfig(apiKey: string, options?: BuildMidsceneModelConfigOptions): MidsceneModelConfig {
    const trimmedApiKey = apiKey.trim();
    const apiKeyValidationError = validateMidsceneApiKey(trimmedApiKey);
    if (apiKeyValidationError) {
        throw new ConfigurationError(apiKeyValidationError, 'apiKey');
    }

    const config: MidsceneModelConfig = {
        MIDSCENE_MODEL_API_KEY: trimmedApiKey,
        MIDSCENE_PLANNING_MODEL_API_KEY: trimmedApiKey,
        MIDSCENE_INSIGHT_MODEL_API_KEY: trimmedApiKey,
    };

    const baseUrl = options?.baseUrl ?? resolveMidsceneModelValue('MIDSCENE_MODEL_BASE_URL');
    const mainModel = options?.mainModel ?? resolveMidsceneModelValue('MIDSCENE_MODEL_NAME');
    const planningModel = options?.planningModel ?? resolveMidsceneModelValue('MIDSCENE_PLANNING_MODEL_NAME');
    const insightModel = options?.insightModel ?? resolveMidsceneModelValue('MIDSCENE_INSIGHT_MODEL_NAME');
    const mainModelFamily = options?.mainModelFamily ?? inferModelFamily(mainModel);
    const planningModelFamily = options?.planningModelFamily ?? inferModelFamily(planningModel);
    const insightModelFamily = options?.insightModelFamily ?? inferModelFamily(insightModel);

    config.MIDSCENE_MODEL_BASE_URL = baseUrl;
    config.MIDSCENE_MODEL_NAME = mainModel;
    config.MIDSCENE_MODEL_FAMILY = mainModelFamily;

    config.MIDSCENE_PLANNING_MODEL_BASE_URL = baseUrl;
    config.MIDSCENE_PLANNING_MODEL_NAME = planningModel;
    config.MIDSCENE_PLANNING_MODEL_FAMILY = planningModelFamily;

    config.MIDSCENE_INSIGHT_MODEL_BASE_URL = baseUrl;
    config.MIDSCENE_INSIGHT_MODEL_NAME = insightModel;
    config.MIDSCENE_INSIGHT_MODEL_FAMILY = insightModelFamily;

    if (options?.temperature !== undefined) {
        config.MIDSCENE_MODEL_TEMPERATURE = options.temperature;
    } else {
        config.MIDSCENE_MODEL_TEMPERATURE = parseFloat(resolveMidsceneModelValue('MIDSCENE_MODEL_TEMPERATURE'));
    }

    return config;
}
