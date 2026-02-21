import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { validateTargetUrl } from '@/lib/url-security';
import { createLogger } from '@/lib/logger';
import { resolveConfigs } from '@/lib/config-resolver';
import { config as appConfig } from '@/config/app';
import { emulatorPool } from '@/lib/emulator-pool';
import type { BrowserConfig, TargetConfig, AndroidTargetConfig, ResolvedConfig, TestStep } from '@/types';

const logger = createLogger('api:run-test');

export const dynamic = 'force-dynamic';

interface RunTestRequest {
    name?: string;
    url?: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    testCaseId?: string;
}

function createConfigurationSnapshot(config: RunTestRequest, resolvedConfigurations?: ResolvedConfig[]) {
    const { testCaseId, ...sanitized } = config;
    void testCaseId;

    const masked = resolvedConfigurations?.map(c => ({
        ...c,
        value: c.type === 'SECRET' ? '••••••' : c.value,
    }));

    return {
        ...sanitized,
        ...(masked && masked.length > 0 ? { resolvedConfigurations: masked } : {})
    };
}

function validateConfigUrls(config: RunTestRequest): string | null {
    const urls: string[] = [];
    if (config.url) urls.push(config.url);
    if (config.browserConfig) {
        for (const entry of Object.values(config.browserConfig)) {
            if ('type' in entry && entry.type === 'android') continue;
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

function isAndroidTargetConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

const APP_ID_REGEX = /^[A-Za-z0-9._]+$/;

async function validateAndroidTargets(
    browserConfig: RunTestRequest['browserConfig'],
    projectIds: ReadonlySet<string>
): Promise<string | null> {
    if (!browserConfig || Object.keys(browserConfig).length === 0) {
        return null;
    }

    const androidTargets = Object.values(browserConfig).filter(isAndroidTargetConfig);
    if (androidTargets.length === 0) {
        return null;
    }

    const status = emulatorPool.getStatus(projectIds);
    const emulatorMap = new Map(status.emulators.map((emulator) => [emulator.id, emulator]));

    for (const target of androidTargets) {
        if (!target.emulatorId) {
            return 'Android target must include an emulator';
        }
        if (!target.appId) {
            return 'Android target must include an app ID';
        }
        if (!APP_ID_REGEX.test(target.appId)) {
            return `App ID "${target.appId}" is invalid`;
        }

        const emulator = emulatorMap.get(target.emulatorId);
        if (!emulator) {
            return `Emulator "${target.emulatorId}" is not available`;
        }

        if (emulator.state !== 'IDLE') {
            return `Emulator "${target.emulatorId}" is currently in use`;
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

    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > appConfig.api.maxRunRequestBodyBytes) {
            return NextResponse.json(
                { error: 'Request body too large' },
                { status: 413 }
            );
        }
    }

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

        const projects = await prisma.project.findMany({
            where: { userId },
            select: { id: true },
        });
        const projectIds = new Set(projects.map((project) => project.id));

        const androidValidationError = await validateAndroidTargets(browserConfig, projectIds);
        if (androidValidationError) {
            return NextResponse.json({ error: androidValidationError }, { status: 400 });
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
        const configurationSnapshot = JSON.stringify(createConfigurationSnapshot(config, resolved.allConfigs));

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
            ...config,
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
