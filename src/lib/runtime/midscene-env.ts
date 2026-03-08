import { createLogger } from '@/lib/core/logger';

const logger = createLogger('midscene-env');

const MIDSCENE_API_KEY_ENV_VARS = [
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_PLANNING_MODEL_API_KEY',
    'MIDSCENE_INSIGHT_MODEL_API_KEY'
] as const;

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

type MidsceneModelEnvVar = keyof typeof MIDSCENE_MODEL_ENV_DEFAULTS;
type MidsceneApiKeyEnvVar = typeof MIDSCENE_API_KEY_ENV_VARS[number];
type MidsceneEnvVar = MidsceneApiKeyEnvVar | MidsceneModelEnvVar;

const MIDSCENE_MODEL_ENV_VARS = Object.keys(MIDSCENE_MODEL_ENV_DEFAULTS) as MidsceneModelEnvVar[];
const MIDSCENE_ENV_VARS = [
    ...MIDSCENE_API_KEY_ENV_VARS,
    ...MIDSCENE_MODEL_ENV_VARS,
] as const;

type SavedEnv = Record<MidsceneEnvVar, string | undefined>;

interface Waiter {
    apiKey: string;
    resolve: (release: () => void) => void;
}

let activeApiKey: string | null = null;
let activeCount = 0;
let savedEnv: SavedEnv | null = null;

const waitQueue: Waiter[] = [];

function captureEnv(): SavedEnv {
    const snapshot = {} as SavedEnv;
    for (const name of MIDSCENE_ENV_VARS) {
        snapshot[name] = process.env[name];
    }
    return snapshot;
}

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

function applyApiKeyAndModelConfig(apiKey: string): void {
    process.env.MIDSCENE_MODEL_API_KEY = apiKey;
    process.env.MIDSCENE_PLANNING_MODEL_API_KEY = apiKey;
    process.env.MIDSCENE_INSIGHT_MODEL_API_KEY = apiKey;

    for (const name of MIDSCENE_MODEL_ENV_VARS) {
        process.env[name] = resolveMidsceneModelValue(name);
    }
}

function restoreEnv(snapshot: SavedEnv): void {
    for (const name of MIDSCENE_ENV_VARS) {
        const value = snapshot[name];
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
}

function createRelease(): () => void {
    let released = false;

    return () => {
        if (released) return;
        released = true;

        activeCount = Math.max(0, activeCount - 1);

        if (activeCount === 0) {
            const snapshot = savedEnv;
            savedEnv = null;
            activeApiKey = null;

            if (snapshot) {
                restoreEnv(snapshot);
            }

            drainQueue();
        }
    };
}

function grantBatch(apiKey: string, waiters: Waiter[]): void {
    if (activeCount === 0) {
        activeApiKey = apiKey;
        savedEnv = captureEnv();
        applyApiKeyAndModelConfig(apiKey);
        logger.debug('MIDSCENE env acquired', { apiKeyLength: apiKey.length });
    }

    for (const waiter of waiters) {
        activeCount++;
        waiter.resolve(createRelease());
    }
}

function drainQueue(): void {
    if (activeCount !== 0) return;
    if (waitQueue.length === 0) return;

    const first = waitQueue.shift();
    if (!first) return;

    const apiKey = first.apiKey;
    const batch = [first];

    while (waitQueue.length > 0 && waitQueue[0].apiKey === apiKey) {
        const next = waitQueue.shift();
        if (!next) break;
        batch.push(next);
    }

    grantBatch(apiKey, batch);
}

export async function acquireMidsceneApiKey(apiKey: string): Promise<() => void> {
    if (!apiKey) {
        throw new Error('API key is required');
    }

    if (activeCount === 0) {
        activeApiKey = apiKey;
        savedEnv = captureEnv();
        applyApiKeyAndModelConfig(apiKey);
        logger.debug('MIDSCENE env acquired', { apiKeyLength: apiKey.length });
    }

    if (activeApiKey === apiKey) {
        activeCount++;
        return createRelease();
    }

    return await new Promise<() => void>((resolve) => {
        waitQueue.push({ apiKey, resolve });
    });
}

export async function withMidsceneApiKey<T>(apiKey: string, fn: () => Promise<T>): Promise<T> {
    const release = await acquireMidsceneApiKey(apiKey);
    try {
        return await fn();
    } finally {
        release();
    }
}
