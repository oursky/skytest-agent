import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    clearRunnerPid,
    clearStateRoot,
    listLocalRunnerIds,
    readRunnerCredential,
    readRunnerMetadata,
    readRunnerPid,
    saveRunnerCredential,
    saveRunnerMetadata,
    writeRunnerPid,
} from './store';
import type { LocalRunnerCredential, LocalRunnerMetadata } from './types';

describe('state store', () => {
    let previousStateDir: string | undefined;
    let tempStateDir: string;

    beforeEach(async () => {
        previousStateDir = process.env.SKYTEST_STATE_DIR;
        tempStateDir = await mkdtemp(path.join(os.tmpdir(), 'skytest-cli-state-'));
        process.env.SKYTEST_STATE_DIR = tempStateDir;
    });

    afterEach(async () => {
        if (previousStateDir === undefined) {
            delete process.env.SKYTEST_STATE_DIR;
        } else {
            process.env.SKYTEST_STATE_DIR = previousStateDir;
        }
        await rm(tempStateDir, { recursive: true, force: true });
    });

    it('writes and reads runner metadata and credential', async () => {
        const runnerId = 'abc123';
        const metadata: LocalRunnerMetadata = {
            localRunnerId: runnerId,
            serverRunnerId: 'server-1',
            label: 'Runner 1',
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z',
        };
        const credential: LocalRunnerCredential = {
            runnerToken: 'token',
            runnerId: 'server-1',
            credentialExpiresAt: '2026-03-09T00:00:00.000Z',
            transport: {
                heartbeatIntervalSeconds: 10,
                claimLongPollTimeoutSeconds: 15,
                deviceSyncIntervalSeconds: 20,
            },
            updatedAt: '2026-03-08T00:00:00.000Z',
        };

        await saveRunnerMetadata(runnerId, metadata);
        await saveRunnerCredential(runnerId, credential);

        expect(await readRunnerMetadata(runnerId)).toEqual(metadata);
        expect(await readRunnerCredential(runnerId)).toEqual(credential);
        expect(await listLocalRunnerIds()).toEqual([runnerId]);
    });

    it('writes and clears pid file', async () => {
        const runnerId = 'pid001';
        await writeRunnerPid(runnerId, 12345);
        expect(await readRunnerPid(runnerId)).toBe(12345);

        await clearRunnerPid(runnerId);
        expect(await readRunnerPid(runnerId)).toBeNull();
    });

    it('clears whole state root', async () => {
        const runnerId = 'clear1';
        await saveRunnerMetadata(runnerId, {
            localRunnerId: runnerId,
            serverRunnerId: 'server-1',
            label: 'Runner',
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z',
        });

        expect(await listLocalRunnerIds()).toEqual([runnerId]);
        await clearStateRoot();
        expect(await listLocalRunnerIds()).toEqual([]);
    });
});
