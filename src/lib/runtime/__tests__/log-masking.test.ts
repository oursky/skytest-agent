import { describe, expect, it } from 'vitest';
import { createExactValueMasker, maskEventForViewer, maskNullableText, maskOptionalText } from '@/lib/runtime/log-masking';
import { isLogData, isScreenshotData, type TestEvent } from '@/types';

describe('log-masking', () => {
    it('masks exact value matches in text', () => {
        const maskText = createExactValueMasker(['secret-token', 'a.b*c']);
        const input = 'token=secret-token and regex-like a.b*c';

        expect(maskText(input)).toBe('token=**** and regex-like ****');
    });

    it('prefers longest exact match to avoid partial leaks', () => {
        const maskText = createExactValueMasker(['abc', 'abc123']);

        expect(maskText('abc123 abc')).toBe('**** ****');
    });

    it('masks log event messages', () => {
        const event: TestEvent = {
            type: 'log',
            data: {
                level: 'info',
                message: 'response: secret-token',
            },
            timestamp: Date.now(),
        };

        const masked = maskEventForViewer(event, createExactValueMasker(['secret-token']));

        expect(masked.type).toBe('log');
        if (!isLogData(masked.data)) {
            throw new Error('Expected log event');
        }
        expect(masked.data.message).toBe('response: ****');
    });

    it('masks screenshot labels', () => {
        const event: TestEvent = {
            type: 'screenshot',
            data: {
                label: 'Step with secret-token',
                src: 'artifact:key',
            },
            timestamp: Date.now(),
        };

        const masked = maskEventForViewer(event, createExactValueMasker(['secret-token']));

        expect(masked.type).toBe('screenshot');
        if (!isScreenshotData(masked.data)) {
            throw new Error('Expected screenshot event');
        }
        expect(masked.data.label).toBe('Step with ****');
    });

    it('masks nullable and optional text helpers', () => {
        const maskText = createExactValueMasker(['secret-token']);

        expect(maskNullableText('secret-token', maskText)).toBe('****');
        expect(maskNullableText(null, maskText)).toBeNull();
        expect(maskOptionalText('secret-token', maskText)).toBe('****');
        expect(maskOptionalText(undefined, maskText)).toBeUndefined();
    });
});
