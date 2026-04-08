import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface ScreenshotEvent {
    type?: unknown;
    data?: {
        src?: unknown;
    };
}

interface ScreenshotAsset {
    sourceUrl: string;
    relativePath: string;
}

function formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

function sanitizeSegment(text: string): string {
    const normalized = text.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-');
    return normalized.length > 0 ? normalized : 'unknown';
}

export function createReportSessionLabel(now: Date = new Date()): string {
    return formatTimestamp(now);
}

function resolveReportRoot(reportDir?: string): string {
    return path.resolve(reportDir ?? 'skytest-results');
}

function normalizeExtensionFromUrl(urlText: string): string {
    try {
        const url = new URL(urlText);
        const ext = path.extname(url.pathname);
        if (!ext || ext.length > 8) {
            return '.png';
        }
        return ext;
    } catch {
        return '.png';
    }
}

function collectScreenshotUrls(events: unknown): string[] {
    if (!Array.isArray(events)) {
        return [];
    }

    const urls: string[] = [];
    for (const event of events as ScreenshotEvent[]) {
        if (event?.type !== 'screenshot') {
            continue;
        }

        const src = event.data?.src;
        if (typeof src !== 'string' || !src.startsWith('http')) {
            continue;
        }

        urls.push(src);
    }

    return [...new Set(urls)];
}

export async function writeRunFileReport(options: {
    runId: string;
    reportDir?: string;
    sessionLabel?: string;
    caseId?: string;
    summary: unknown;
    detail?: unknown;
}): Promise<{
    sessionDirectory: string;
    runDirectory: string;
    resultFile: string;
    markdownFile: string;
    screenshotsDirectory: string;
    screenshotCount: number;
}> {
    const reportRoot = resolveReportRoot(options.reportDir);
    const sessionLabel = sanitizeSegment(options.sessionLabel ?? createReportSessionLabel());
    const caseId = sanitizeSegment(options.caseId ?? 'unknown-case');
    const runLabel = `${formatTimestamp(new Date())}-${sanitizeSegment(options.runId)}`;
    const sessionDirectory = path.join(reportRoot, sessionLabel);
    const runDirectory = path.join(sessionDirectory, caseId, runLabel);
    const screenshotsDirectory = path.join(runDirectory, 'screenshots');
    const resultFile = path.join(runDirectory, 'result.json');
    const markdownFile = path.join(runDirectory, 'report.md');

    await mkdir(screenshotsDirectory, { recursive: true });

    const screenshotUrls = collectScreenshotUrls((options.detail as { events?: unknown } | undefined)?.events);
    const screenshotFiles: ScreenshotAsset[] = [];

    for (let index = 0; index < screenshotUrls.length; index += 1) {
        const screenshotUrl = screenshotUrls[index];
        const response = await fetch(screenshotUrl);
        if (!response.ok) {
            continue;
        }

        const extension = normalizeExtensionFromUrl(screenshotUrl);
        const screenshotFile = path.join(screenshotsDirectory, `screenshot-${String(index + 1).padStart(2, '0')}${extension}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(screenshotFile, bytes);
        screenshotFiles.push({
            sourceUrl: screenshotUrl,
            relativePath: path.relative(runDirectory, screenshotFile),
        });
    }

    const summaryRecord = (typeof options.summary === 'object' && options.summary !== null)
        ? (options.summary as Record<string, unknown>)
        : {};
    const detailRecord = (typeof options.detail === 'object' && options.detail !== null)
        ? (options.detail as Record<string, unknown>)
        : {};

    const status = typeof summaryRecord.status === 'string'
        ? summaryRecord.status
        : (typeof detailRecord.status === 'string' ? detailRecord.status : 'UNKNOWN');
    const completedAt = typeof summaryRecord.completedAt === 'string'
        ? summaryRecord.completedAt
        : (typeof detailRecord.completedAt === 'string' ? detailRecord.completedAt : null);
    const error = typeof summaryRecord.error === 'string'
        ? summaryRecord.error
        : (typeof detailRecord.error === 'string' ? detailRecord.error : null);

    const eventCounts: Record<string, number> = {};
    const rawEvents = (detailRecord.events as unknown[] | undefined) ?? [];
    if (Array.isArray(rawEvents)) {
        for (const event of rawEvents) {
            const type = typeof (event as { type?: unknown })?.type === 'string'
                ? String((event as { type?: unknown }).type)
                : 'unknown';
            eventCounts[type] = (eventCounts[type] ?? 0) + 1;
        }
    }

    const reportPayload = {
        generatedAt: new Date().toISOString(),
        sessionLabel,
        caseId,
        runId: options.runId,
        status,
        completedAt,
        error,
        summary: options.summary,
        screenshotFiles: screenshotFiles.map((asset) => asset.relativePath),
        screenshots: screenshotFiles,
        eventCounts,
        detail: options.detail ?? null,
    };

    await writeFile(resultFile, JSON.stringify(reportPayload, null, 2));

    const markdownLines: string[] = [
        '# SkyTest Run Report',
        '',
        `- Generated: ${reportPayload.generatedAt}`,
        `- Session: ${sessionLabel}`,
        `- Case ID: ${caseId}`,
        `- Run ID: ${options.runId}`,
        `- Status: ${status}`,
        `- Completed At: ${completedAt ?? 'n/a'}`,
        `- Screenshots: ${screenshotFiles.length}`,
    ];

    if (error) {
        markdownLines.push(`- Error: ${error}`);
    }

    markdownLines.push('', '## Event Counts');
    const eventTypes = Object.keys(eventCounts).sort();
    if (eventTypes.length === 0) {
        markdownLines.push('', '- none');
    } else {
        markdownLines.push('');
        for (const type of eventTypes) {
            markdownLines.push(`- ${type}: ${eventCounts[type]}`);
        }
    }

    markdownLines.push('', '## Screenshot Files');
    if (screenshotFiles.length === 0) {
        markdownLines.push('', '- none');
    } else {
        markdownLines.push('');
        for (const screenshot of screenshotFiles) {
            markdownLines.push(`- ${screenshot.relativePath}`);
        }
    }

    await writeFile(markdownFile, `${markdownLines.join('\n')}\n`);

    return {
        sessionDirectory,
        runDirectory,
        resultFile,
        markdownFile,
        screenshotsDirectory,
        screenshotCount: screenshotFiles.length,
    };
}
