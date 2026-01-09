import { NextResponse } from 'next/server';
import { queue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
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

        const testRun = await prisma.testRun.create({
            data: {
                testCaseId,
                status: 'QUEUED',
                configurationSnapshot: JSON.stringify(config)
            }
        });

        await queue.add(testRun.id, config);

        return NextResponse.json({ runId: testRun.id });

    } catch (error) {
        console.error('Failed to submit test job:', error);
        return NextResponse.json(
            { error: 'Failed to submit test job' },
            { status: 500 }
        );
    }
}
