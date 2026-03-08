import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isProcessAlive, stopProcessWithTimeout } from './process';

describe('process runtime helpers', () => {
    it('detects and stops a live process', async () => {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            stdio: 'ignore',
        });

        const pid = child.pid;
        if (!pid) {
            throw new Error('Missing child pid');
        }

        expect(isProcessAlive(pid)).toBe(true);
        const result = await stopProcessWithTimeout(pid, 3000);
        expect(result).toBe('stopped');
        expect(isProcessAlive(pid)).toBe(false);
    });

    it('returns not-running for missing process', async () => {
        const result = await stopProcessWithTimeout(999999, 100);
        expect(result).toBe('not-running');
    });
});
