import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReportSessionLabel, writeRunFileReport } from './file-reporter';

describe('file-reporter', () => {
    const originalFetch = global.fetch;
    let tempRoot = '';

    beforeEach(async () => {
        tempRoot = await mkdtemp(path.join(tmpdir(), 'skytest-file-reporter-'));
    });

    afterEach(async () => {
        global.fetch = originalFetch;
        if (tempRoot) {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('creates session/case/run folders and writes json+markdown reports', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => (
            new Response(Buffer.from('fake-image-bytes'), { status: 200 })
        ));
        global.fetch = fetchMock as unknown as typeof fetch;

        const report = await writeRunFileReport({
            runId: 'run-123',
            reportDir: tempRoot,
            sessionLabel: '20260408-141500',
            caseId: 'HAN-T11',
            summary: {
                displayId: 'HAN-T11',
                status: 'PASS',
                completedAt: '2026-04-08T14:15:10.000Z',
                error: null,
            },
            detail: {
                status: 'PASS',
                events: [
                    { type: 'step-start' },
                    { type: 'screenshot', data: { src: 'https://example.com/a.jpg' } },
                    { type: 'screenshot', data: { src: 'https://example.com/a.jpg' } },
                    { type: 'screenshot', data: { src: 'https://example.com/b.png' } },
                ],
            },
        });

        expect(report.sessionDirectory).toBe(path.join(tempRoot, '20260408-141500'));
        expect(report.runDirectory).toContain(path.join('20260408-141500', 'HAN-T11'));
        expect(report.screenshotCount).toBe(2);

        await stat(report.resultFile);
        await stat(report.markdownFile);
        await stat(report.screenshotsDirectory);

        const jsonContent = JSON.parse(await readFile(report.resultFile, 'utf8')) as {
            sessionLabel: string;
            caseId: string;
            screenshotFiles: string[];
            eventCounts: Record<string, number>;
        };
        expect(jsonContent.sessionLabel).toBe('20260408-141500');
        expect(jsonContent.caseId).toBe('HAN-T11');
        expect(jsonContent.screenshotFiles.length).toBe(2);
        expect(jsonContent.eventCounts.screenshot).toBe(3);

        const markdownContent = await readFile(report.markdownFile, 'utf8');
        expect(markdownContent).toContain('# SkyTest Run Report');
        expect(markdownContent).toContain('- Case ID: HAN-T11');
        expect(markdownContent).toContain('## Screenshot Files');

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('creates stable session label format', () => {
        const label = createReportSessionLabel(new Date('2026-04-08T11:22:33.000Z'));
        expect(label).toMatch(/^\d{8}-\d{6}$/);
    });
});
