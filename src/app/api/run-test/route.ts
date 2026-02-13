import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { validateTargetUrl } from '@/lib/url-security';
import { createLogger } from '@/lib/logger';
import { resolveConfigs } from '@/lib/config-resolver';
import { assertProductionRunSafety } from '@/lib/deployment-guard';
import { getErrorMessage } from '@/lib/errors';
import type { BrowserConfig, ResolvedConfig, TestStep } from '@/types';

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

function redactBrowserConfigCredentials(browserConfig?: Record<string, BrowserConfig>) {
    if (!browserConfig) return undefined;

    return Object.fromEntries(
        Object.entries(browserConfig).map(([browserId, value]) => {
            const safeConfig: BrowserConfig = { ...value };
            delete safeConfig.username;
            delete safeConfig.password;
            return [browserId, safeConfig];
        })
    );
}

function createConfigurationSnapshot(config: RunTestRequest, resolvedConfigurations?: ResolvedConfig[]) {
    const sanitized: RunTestRequest = { ...config };
    delete sanitized.testCaseId;
    delete sanitized.username;
    delete sanitized.password;

    const browserConfig = sanitized.browserConfig;
    delete sanitized.browserConfig;

    const masked = resolvedConfigurations?.map(c => ({
        ...c,
        value: c.type === 'SECRET' ? '••••••' : c.value,
    }));
    const sanitizedBrowserConfig = redactBrowserConfigCredentials(browserConfig);

    return {
        ...sanitized,
        ...(sanitizedBrowserConfig ? { browserConfig: sanitizedBrowserConfig } : {}),
        ...(masked && masked.length > 0 ? { resolvedConfigurations: masked } : {})
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
    const sanitizedConfig: RunTestRequest = {
        ...config,
        browserConfig: redactBrowserConfigCredentials(config.browserConfig),
    };
    const { url, prompt, steps, browserConfig, testCaseId } = sanitizedConfig;

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

    const urlValidationError = validateConfigUrls(sanitizedConfig);
    if (urlValidationError) {
        return NextResponse.json(
            { error: urlValidationError },
            { status: 400 }
        );
    }

    try {
        assertProductionRunSafety();
    } catch (error) {
        logger.error('Run submission blocked by deployment safety guard', error);
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 503 });
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
        } catch {
            return NextResponse.json(
                { error: 'Failed to decrypt API key. Please re-enter your API key.' },
                { status: 400 }
            );
        }

        const files = await prisma.testCaseFile.findMany({
            where: { testCaseId },
            select: { id: true, filename: true, storedName: true, mimeType: true, size: true }
        });

        const resolved = await resolveConfigs(testCase.projectId, testCaseId);
        const configurationSnapshot = JSON.stringify(createConfigurationSnapshot(sanitizedConfig, resolved.allConfigs));

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

        await queue.add(testRun.id, {
            ...sanitizedConfig,
            userId,
            openRouterApiKey,
            testCaseId,
            projectId: testCase.projectId,
            files,
            resolvedVariables: resolved.variables,
            resolvedFiles: resolved.files,
        });

        return NextResponse.json({ runId: testRun.id });

    } catch (error) {
        logger.error('Failed to submit test job', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}
