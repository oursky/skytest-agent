import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    renderTemplate,
} from '@/lib/integrations/slack/template';

describe('renderTemplate', () => {
    it('renders all provided variables', () => {
        const result = renderTemplate('Run {testRunLink} failed in {projectName}', {
            testRunLink: 'http://localhost/run/123',
            projectName: 'Checkout',
        });

        expect(result.text).toBe('Run http://localhost/run/123 failed in Checkout');
        expect(result.truncated).toBe(false);
        expect(result.missingVariables).toEqual([]);
    });

    it('keeps unknown variables and reports them', () => {
        const result = renderTemplate('Run {testRunLink} failed by {owner}', {
            testRunLink: 'http://localhost/run/123',
        });

        expect(result.text).toBe('Run http://localhost/run/123 failed by {owner}');
        expect(result.missingVariables).toEqual(['owner']);
    });

    it('escapes mrkdwn characters in runtime values', () => {
        const result = renderTemplate('Error: {errorSummary}', {
            errorSummary: '<@channel> & <script>alert(1)</script>',
        });

        expect(result.text).toBe('Error: &lt;@channel&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('truncates output to 3500 chars', () => {
        const result = renderTemplate('{longText}', {
            longText: 'a'.repeat(3_800),
        });

        expect(result.truncated).toBe(true);
        expect(result.text.length).toBe(3_500);
    });

    it('preserves mention markup written directly in template', () => {
        const result = renderTemplate('Notify <@U123ABC> about {testRunLink}', {
            testRunLink: 'http://localhost/run/123',
        });

        expect(result.text).toBe('Notify <@U123ABC> about http://localhost/run/123');
    });

    it('falls back to default template when input is empty', () => {
        const result = renderTemplate('   ', {
            testRunLink: 'http://localhost/run/123',
            testCaseID: 'TC-1',
            testCaseName: 'Checkout flow',
            projectName: 'Storefront',
            triggeredBy: 'test@example.com',
            startedAt: '2026-04-29T00:00:00Z',
            completedAt: '2026-04-29T00:00:42Z',
            durationMinSec: '42s',
            errorSummary: 'Element not found',
        });

        expect(result.text).toContain(':x: *Test Failed* Storefront TC-1');
        expect(result.text).not.toContain('{testRunLink}');
    });

    it('default template contains expected placeholders', () => {
        expect(DEFAULT_SLACK_FAILURE_TEMPLATE).toContain('{testRunLink}');
        expect(DEFAULT_SLACK_FAILURE_TEMPLATE).toContain('{errorSummary}');
    });

    it('trims variable names inside braces', () => {
        const result = renderTemplate('Run link: { testRunLink }', {
            testRunLink: 'https://example.com/history/run-1',
        });

        expect(result.text).toBe('Run link: https://example.com/history/run-1');
        expect(result.missingVariables).toEqual([]);
    });
});
