import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveManagedMidsceneRunDir } from './runner-manager';

describe('resolveManagedMidsceneRunDir', () => {
    const originalMidsceneRunDir = process.env.MIDSCENE_RUN_DIR;

    afterEach(() => {
        if (originalMidsceneRunDir === undefined) {
            delete process.env.MIDSCENE_RUN_DIR;
        } else {
            process.env.MIDSCENE_RUN_DIR = originalMidsceneRunDir;
        }
    });

    it('defaults to runtime state midscene dir when unset', () => {
        delete process.env.MIDSCENE_RUN_DIR;

        const resolved = resolveManagedMidsceneRunDir({
            runtimeStateDir: '/tmp/skytest/runtime',
            loadedEnv: {},
        });

        expect(resolved).toBe('/tmp/skytest/runtime/midscene');
    });

    it('resolves relative MIDSCENE_RUN_DIR against runtime state dir', () => {
        delete process.env.MIDSCENE_RUN_DIR;

        const resolved = resolveManagedMidsceneRunDir({
            runtimeStateDir: '/tmp/skytest/runtime',
            loadedEnv: {
                MIDSCENE_RUN_DIR: 'skytest-perf',
            },
        });

        expect(resolved).toBe('/tmp/skytest/runtime/skytest-perf');
    });

    it('keeps absolute MIDSCENE_RUN_DIR as-is', () => {
        delete process.env.MIDSCENE_RUN_DIR;

        const resolved = resolveManagedMidsceneRunDir({
            runtimeStateDir: '/tmp/skytest/runtime',
            loadedEnv: {
                MIDSCENE_RUN_DIR: '/var/tmp/skytest-midscene',
            },
        });

        expect(resolved).toBe('/var/tmp/skytest-midscene');
    });

    it('prefers process env over loaded env', () => {
        process.env.MIDSCENE_RUN_DIR = 'from-process-env';

        const resolved = resolveManagedMidsceneRunDir({
            runtimeStateDir: '/tmp/skytest/runtime',
            loadedEnv: {
                MIDSCENE_RUN_DIR: 'from-loaded-env',
            },
        });

        expect(resolved).toBe(path.join('/tmp/skytest/runtime', 'from-process-env'));
    });
});
