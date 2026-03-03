import { createLogger } from '@/lib/logger';

const logger = createLogger('midscene-env');

const MIDSCENE_ENV_VARS = [
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_PLANNING_MODEL_API_KEY',
    'MIDSCENE_INSIGHT_MODEL_API_KEY'
] as const;

type MidsceneEnvVar = typeof MIDSCENE_ENV_VARS[number];

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
    return {
        MIDSCENE_MODEL_API_KEY: process.env.MIDSCENE_MODEL_API_KEY,
        MIDSCENE_PLANNING_MODEL_API_KEY: process.env.MIDSCENE_PLANNING_MODEL_API_KEY,
        MIDSCENE_INSIGHT_MODEL_API_KEY: process.env.MIDSCENE_INSIGHT_MODEL_API_KEY
    };
}

function applyApiKey(apiKey: string): void {
    process.env.MIDSCENE_MODEL_API_KEY = apiKey;
    process.env.MIDSCENE_PLANNING_MODEL_API_KEY = apiKey;
    process.env.MIDSCENE_INSIGHT_MODEL_API_KEY = apiKey;
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
        applyApiKey(apiKey);
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
        applyApiKey(apiKey);
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
