import { describe, expect, it } from 'vitest';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';

describe('evaluateRunnerCompatibility', () => {
    it('accepts current protocol and minimum runner version', () => {
        const result = evaluateRunnerCompatibility({
            protocolVersion: '1.0.0',
            runnerVersion: '0.1.0',
        });

        expect(result.upgradeRequired).toBe(false);
        expect(result.currentProtocolVersion).toBe('1.0.0');
        expect(result.minimumSupportedProtocolVersion).toBe('1.0.0');
        expect(result.minimumSupportedRunnerVersion).toBe('0.1.0');
    });

    it('requires upgrade for older runner versions', () => {
        const result = evaluateRunnerCompatibility({
            protocolVersion: '1.0.0',
            runnerVersion: '0.0.9',
        });

        expect(result.upgradeRequired).toBe(true);
    });

    it('requires upgrade for unsupported protocol versions', () => {
        const result = evaluateRunnerCompatibility({
            protocolVersion: '2.0.0',
            runnerVersion: '0.1.0',
        });

        expect(result.upgradeRequired).toBe(true);
    });
});
