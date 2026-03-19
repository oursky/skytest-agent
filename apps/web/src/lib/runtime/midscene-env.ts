export type MidsceneModelConfig = Record<string, string | number>;

const MIDSCENE_MODEL_ENV_DEFAULTS = {
    MIDSCENE_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
    MIDSCENE_MODEL_NAME: 'bytedance-seed/seed-1.6-flash',
    MIDSCENE_MODEL_FAMILY: 'doubao-vision',
    MIDSCENE_PLANNING_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
    MIDSCENE_PLANNING_MODEL_NAME: 'qwen/qwen3.5-35b-a3b',
    MIDSCENE_PLANNING_MODEL_FAMILY: 'qwen3.5',
    MIDSCENE_INSIGHT_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
    MIDSCENE_INSIGHT_MODEL_NAME: 'qwen/qwen3.5-35b-a3b',
    MIDSCENE_INSIGHT_MODEL_FAMILY: 'qwen3.5',
    MIDSCENE_MODEL_TEMPERATURE: '0.2',
} as const;

const MIDSCENE_MODEL_OVERRIDE_ENV = {
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
} as const;

const MIDSCENE_MODEL_ENV_VARS = Object.keys(MIDSCENE_MODEL_ENV_DEFAULTS) as MidsceneModelEnvVar[];
type MidsceneModelEnvVar = keyof typeof MIDSCENE_MODEL_ENV_DEFAULTS;

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

export function buildMidsceneModelConfig(apiKey: string): MidsceneModelConfig {
    if (!apiKey) {
        throw new Error('API key is required');
    }

    const config: MidsceneModelConfig = {
        MIDSCENE_MODEL_API_KEY: apiKey,
        MIDSCENE_PLANNING_MODEL_API_KEY: apiKey,
        MIDSCENE_INSIGHT_MODEL_API_KEY: apiKey,
    };

    for (const name of MIDSCENE_MODEL_ENV_VARS) {
        config[name] = resolveMidsceneModelValue(name);
    }

    return config;
}
