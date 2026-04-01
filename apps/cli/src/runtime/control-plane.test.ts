import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlaneHttpError, unpairRunnerRegistration } from './control-plane';

const unpairResponsePayload = {
    runnerId: 'runner-1',
    unpaired: true,
    compatibility: {
        currentProtocolVersion: '1.0.0',
        minimumSupportedProtocolVersion: '1.0.0',
        minimumSupportedRunnerVersion: '0.1.0',
        upgradeRequired: false,
    },
    rotationRequired: false,
};

describe('control-plane unpair', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('calls unpair endpoint and returns parsed response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            JSON.stringify(unpairResponsePayload),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        ));
        vi.stubGlobal('fetch', fetchMock);

        const result = await unpairRunnerRegistration({
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            runnerToken: 'st_runner_token',
            runnerVersion: '0.1.0',
            reason: 'CLI unpair command',
        });

        expect(result).toEqual(unpairResponsePayload);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:3000/api/runners/v1/unpair',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer st_runner_token',
                }),
            })
        );
    });

    it('throws ControlPlaneHttpError for non-OK response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(unpairRunnerRegistration({
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            runnerToken: 'st_runner_token',
            runnerVersion: '0.1.0',
        })).rejects.toBeInstanceOf(ControlPlaneHttpError);
    });

    it('aborts unpair request on timeout', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            if (!signal) {
                return;
            }
            if (signal.aborted) {
                const abortError = new Error('aborted');
                abortError.name = 'AbortError';
                reject(abortError);
                return;
            }
            signal.addEventListener('abort', () => {
                const abortError = new Error('aborted');
                abortError.name = 'AbortError';
                reject(abortError);
            }, { once: true });
        }));
        vi.stubGlobal('fetch', fetchMock);

        const rejection = unpairRunnerRegistration({
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            runnerToken: 'st_runner_token',
            runnerVersion: '0.1.0',
        }).then(() => null, (error: unknown) => error);

        await vi.advanceTimersByTimeAsync(3_000);
        const error = await rejection;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('timed out');
    });
});
