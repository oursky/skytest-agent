import { describe, expect, it } from 'vitest';
import { TEST_STATUS } from '@/types';
import {
    buildSlackRunMessage,
    resolveSlackAppBaseUrlFromEnv,
} from '@/lib/integrations/slack/message';

describe('slack message', () => {
    it('renders failed message with run link and date tokens', () => {
        const text = buildSlackRunMessage({
            status: TEST_STATUS.FAIL,
            testCaseDisplayId: 'TC-001',
            testCaseName: 'Checkout flow',
            testCaseId: 'tc-1',
            runId: 'run-1',
            startedAt: new Date('2026-05-07T09:33:00.000Z'),
            completedAt: new Date('2026-05-07T09:33:42.000Z'),
            errorSummary: 'Element not found',
            durationSeconds: 42,
            appBaseUrl: 'http://localhost:3000/',
        });

        expect(text).toContain('*Test failed* TC-001');
        expect(text).toContain('*Run ID:* <!date^');
        expect(text).toContain('^Run - {date_short} {time}^http://localhost:3000/test-cases/tc-1/history/run-1|Run - 7 May 2026, 09:33 UTC>');
        expect(text).toContain('*Started:* <!date^');
        expect(text).toContain('*Error:* Element not found');
    });

    it('renders passed message with duration line', () => {
        const text = buildSlackRunMessage({
            status: TEST_STATUS.PASS,
            testCaseDisplayId: 'TC-002',
            testCaseName: 'Login flow',
            testCaseId: 'tc-2',
            runId: 'run-2',
            startedAt: new Date('2026-05-07T09:00:00.000Z'),
            completedAt: new Date('2026-05-07T09:00:30.000Z'),
            errorSummary: 'ignored',
            durationSeconds: 30,
            appBaseUrl: null,
        });

        expect(text).toContain('*Test passed* TC-002');
        expect(text).toContain('*Run ID:* <!date^');
        expect(text).toContain('|Run - 7 May 2026, 09:00 UTC>');
        expect(text).toContain('*Duration:* 30s');
        expect(text).not.toContain('*Error:*');
    });

    it('resolves base url from SKYTEST_BASE_URL first', () => {
        const previousSkytestBaseUrl = process.env.SKYTEST_BASE_URL;
        const previousRedirect = process.env.AUTHGEAR_REDIRECT_URI;

        process.env.SKYTEST_BASE_URL = 'https://skytest.example.com';
        process.env.AUTHGEAR_REDIRECT_URI = 'https://auth.example.com/auth-redirect';

        expect(resolveSlackAppBaseUrlFromEnv()).toBe('https://skytest.example.com');

        process.env.SKYTEST_BASE_URL = previousSkytestBaseUrl;
        process.env.AUTHGEAR_REDIRECT_URI = previousRedirect;
    });
});
