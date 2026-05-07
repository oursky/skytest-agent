import { describe, expect, it } from 'vitest';
import {
    buildRunUrl,
    resolveSlackAppBaseUrlFromEnv,
} from '@/lib/integrations/slack/message';

describe('slack message', () => {
    it('builds run urls with trimmed base url and encoded path segments', () => {
        const url = buildRunUrl({
            appBaseUrl: ' https://skytest.example.com/ ',
            testCaseId: 'TC 1/alpha',
            runId: 'run/42',
        });

        expect(url).toBe('https://skytest.example.com/test-cases/TC%201%2Falpha/history/run%2F42');
    });

    it('returns null when base url is unavailable', () => {
        expect(buildRunUrl({
            appBaseUrl: null,
            testCaseId: 'tc-1',
            runId: 'run-1',
        })).toBeNull();

        expect(buildRunUrl({
            appBaseUrl: '   ',
            testCaseId: 'tc-1',
            runId: 'run-1',
        })).toBeNull();
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
