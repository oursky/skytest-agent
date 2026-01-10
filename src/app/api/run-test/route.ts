import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload || !authPayload.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = authPayload.sub as string;

    const config = await request.json();
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

    try {
        if (!testCaseId) {
            return NextResponse.json(
                { error: 'TestCase ID is required for background execution' },
                { status: 400 }
            );
        }

        const user = await prisma.user.findUnique({
            where: { authId: userId },
            select: { openRouterKey: true }
        });

        if (!user?.openRouterKey) {
            return NextResponse.json(
                { error: 'Please configure your OpenRouter API key' },
                { status: 400 }
            );
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

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId,
                status: 'QUEUED',
                configurationSnapshot: JSON.stringify(config)
            }
        });

        await queue.add(testRun.id, { ...config, userId, openRouterApiKey });

        return NextResponse.json({ runId: testRun.id });

    } catch (error) {
        console.error('Failed to submit test job:', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}
