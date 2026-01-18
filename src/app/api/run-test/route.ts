import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { validateTargetUrl } from '@/lib/url-security';
import { createLogger } from '@/lib/logger';
import type { BrowserConfig, TestStep } from '@/types';

const logger = createLogger('api:run-test');

export const dynamic = 'force-dynamic';

interface RunTestRequest {
    name?: string;
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
    username?: string;
    password?: string;
    testCaseId?: string;
}

function sanitizeBrowserConfig(browserConfig?: Record<string, BrowserConfig>) {
    if (!browserConfig) return undefined;
    return Object.fromEntries(
        Object.entries(browserConfig).map(([id, entry]) => [
            id,
            { ...entry, username: undefined, password: undefined }
        ])
    );
}

function createConfigurationSnapshot(config: RunTestRequest) {
    const { prompt: _prompt, steps: _steps, username: _username, password: _password, browserConfig, ...rest } = config;
    return {
        ...rest,
        browserConfig: sanitizeBrowserConfig(browserConfig),
    };
}

function validateConfigUrls(config: RunTestRequest): string | null {
    const urls: string[] = [];
    if (config.url) urls.push(config.url);
    if (config.browserConfig) {
        for (const entry of Object.values(config.browserConfig)) {
            if (entry.url) urls.push(entry.url);
        }
    }

    for (const url of urls) {
        const result = validateTargetUrl(url);
        if (!result.valid) {
            return result.error || 'Target URL is not allowed';
        }
    }

    return null;
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload || !authPayload.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const authId = authPayload.sub as string;

    const config = await request.json() as RunTestRequest;
    const { url, prompt, steps, browserConfig, testCaseId } = config;

    const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;
    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasBrowserConfig && !url) {
        return NextResponse.json(
            { error: 'Valid configuration (URL or BrowserConfig) is required' },
            { status: 400 }
        );
    }

    if (!hasSteps && !hasPrompt) {
        return NextResponse.json(
            { error: 'Instructions (Prompt or Steps) are required' },
            { status: 400 }
        );
    }

    const urlValidationError = validateConfigUrls(config);
    if (urlValidationError) {
        return NextResponse.json(
            { error: urlValidationError },
            { status: 400 }
        );
    }

    try {
        if (!testCaseId) {
            return NextResponse.json(
                { error: 'TestCase ID is required for background execution' },
                { status: 400 }
            );
        }

        const user = await prisma.user.findUnique({
            where: { authId },
            select: { id: true, openRouterKey: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!user.openRouterKey) {
            return NextResponse.json(
                { error: 'Please configure your OpenRouter API key' },
                { status: 400 }
            );
        }

        const userId = user.id;

        const testCase = await prisma.testCase.findUnique({
            where: { id: testCaseId },
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        let openRouterApiKey: string;
        try {
            openRouterApiKey = decrypt(user.openRouterKey);
        } catch (e) {
            return NextResponse.json(
                { error: 'Failed to decrypt API key. Please re-enter your API key.' },
                { status: 400 }
            );
        }

        const files = await prisma.testCaseFile.findMany({
            where: { testCaseId },
            select: { id: true, filename: true, storedName: true, mimeType: true, size: true }
        });

        const configurationSnapshot = JSON.stringify(createConfigurationSnapshot(config));

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId,
                status: 'QUEUED',
                configurationSnapshot
            }
        });

        if (files && files.length > 0) {
            try {
                await prisma.testRunFile.createMany({
                    data: files.map((f) => ({
                        runId: testRun.id,
                        filename: f.filename,
                        storedName: f.storedName,
                        mimeType: f.mimeType,
                        size: f.size,
                    }))
                });
            } catch (e) {
                logger.warn('Failed to snapshot run files', e);
            }
        }

        await queue.add(testRun.id, { ...config, userId, openRouterApiKey, testCaseId, projectId: testCase.projectId, files });

        return NextResponse.json({ runId: testRun.id });

    } catch (error) {
        logger.error('Failed to submit test job', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}
