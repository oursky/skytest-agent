import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocalCommandGroup } from './local';

vi.mock('node:child_process', () => ({
    execFile: vi.fn(),
}));

type ExecFileCallback = (error: Error | null, stdout?: string) => void;

describe('runLocalCommandGroup', () => {
    const execFileMock = vi.mocked(execFile);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    beforeEach(() => {
        vi.resetAllMocks();
        logSpy.mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockReset();
    });

    it('runs setup flow with bootstrap and init', async () => {
        execFileMock.mockImplementation((command, args, _options, callback) => {
            (callback as ExecFileCallback)(null, 'ok');
            return {} as never;
        });

        await runLocalCommandGroup({ action: 'setup' });

        expect(execFileMock).toHaveBeenNthCalledWith(
            1,
            'make',
            ['bootstrap'],
            expect.any(Object),
            expect.any(Function),
        );
        expect(execFileMock).toHaveBeenNthCalledWith(
            2,
            'npm',
            ['run', 'skytest', '--', 'init'],
            expect.any(Object),
            expect.any(Function),
        );
    });

    it('runs down flow with runner reset and services down', async () => {
        execFileMock.mockImplementation((command, args, _options, callback) => {
            (callback as ExecFileCallback)(null, 'ok');
            return {} as never;
        });

        await runLocalCommandGroup({ action: 'down' });

        expect(execFileMock).toHaveBeenNthCalledWith(
            1,
            'make',
            ['runner-reset'],
            expect.any(Object),
            expect.any(Function),
        );
        expect(execFileMock).toHaveBeenNthCalledWith(
            2,
            'make',
            ['services-down'],
            expect.any(Object),
            expect.any(Function),
        );
    });

    it('runs update flow in expected order', async () => {
        execFileMock.mockImplementation((command, args, _options, callback) => {
            (callback as ExecFileCallback)(null, 'ok');
            return {} as never;
        });

        await runLocalCommandGroup({ action: 'update' });

        expect(execFileMock.mock.calls.map((call) => [call[0], call[1]])).toEqual([
            ['make', ['install']],
            ['make', ['services-up']],
            ['make', ['db-setup']],
            ['make', ['playwright-ensure']],
            ['make', ['seed-local-defaults']],
            ['npm', ['run', 'skytest', '--', 'init']],
        ]);
    });

    it('prints status from docker and process checks', async () => {
        execFileMock.mockImplementation((command, args, _options, callback) => {
            if (command === 'sh' && Array.isArray(args) && args[0] === '-c') {
                const script = args[1];
                if (script.includes('docker compose')) {
                    (callback as ExecFileCallback)(
                        null,
                        'NAME IMAGE COMMAND SERVICE CREATED STATUS PORTS\nskytest-local-postgres postgres:16 postgres postgres 1m Up 1m 0.0.0.0:5432->5432/tcp\n',
                    );
                    return {} as never;
                }

                if (script.includes('next dev --hostname')) {
                    (callback as ExecFileCallback)(null, '12345 node next dev --hostname 127.0.0.1\n');
                    return {} as never;
                }

                if (script.includes('runner:maintenance')) {
                    (callback as ExecFileCallback)(null, '');
                    return {} as never;
                }

                if (script.includes('browser:worker')) {
                    (callback as ExecFileCallback)(null, '22334 npm run --workspace @skytest/web browser:worker\n');
                    return {} as never;
                }
            }

            (callback as ExecFileCallback)(null, '');
            return {} as never;
        });

        await runLocalCommandGroup({ action: 'status' });

        expect(logSpy).toHaveBeenCalledWith('Local SkyTest status');
        expect(logSpy).toHaveBeenCalledWith('- Services: skytest-local-postgres');
        expect(logSpy).toHaveBeenCalledWith('- App process: running');
        expect(logSpy).toHaveBeenCalledWith('- Maintenance worker: not running');
        expect(logSpy).toHaveBeenCalledWith('- Browser worker: running');
    });
});
