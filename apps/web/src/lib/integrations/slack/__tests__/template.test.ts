import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SLACK_FAILURE_TEMPLATE,
    renderTemplate,
} from '@/lib/integrations/slack/template';

describe('renderTemplate', () => {
    it('renders all provided variables', () => {
        const result = renderTemplate('Run {runId} failed in {projectName}', {
            runId: 'run-123',
            projectName: 'Checkout',
        });

        expect(result.text).toBe('Run run-123 failed in Checkout');
        expect(result.truncated).toBe(false);
        expect(result.missingVariables).toEqual([]);
    });

    it('keeps unknown variables and reports them', () => {
        const result = renderTemplate('Run {runId} failed by {owner}', {
            runId: 'run-123',
        });

        expect(result.text).toBe('Run run-123 failed by {owner}');
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
        const result = renderTemplate('Notify <@U123ABC> about {runId}', {
            runId: 'run-123',
        });

        expect(result.text).toBe('Notify <@U123ABC> about run-123');
    });

    it('falls back to default template when input is empty', () => {
        const result = renderTemplate('   ', {
            runUrl: 'https://skytest.dev/run/run-1',
            testCaseName: 'Checkout flow',
            projectName: 'Shop',
            triggeredBy: 'qa@example.com',
            startedAt: '2026-04-29T00:00:00Z',
            completedAt: '2026-04-29T00:00:42Z',
            errorSummary: 'Element not found',
        });

        expect(result.text).toContain(':rotating_light: *Test failed*');
        expect(result.text).not.toContain('{runUrl}');
    });

    it('default template contains expected placeholders', () => {
        expect(DEFAULT_SLACK_FAILURE_TEMPLATE).toContain('{runUrl}');
        expect(DEFAULT_SLACK_FAILURE_TEMPLATE).toContain('{errorSummary}');
    });
});
