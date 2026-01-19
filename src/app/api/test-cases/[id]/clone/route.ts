import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:test-cases:clone');

type AuthPayload = NonNullable<Awaited<ReturnType<typeof verifyAuth>>>;

async function resolveUserId(authPayload: AuthPayload): Promise<string | null> {
    const maybeUserId = (authPayload as { userId?: unknown }).userId;
    if (typeof maybeUserId === 'string' && maybeUserId.length > 0) {
        return maybeUserId;
    }

    const authId = authPayload.sub as string | undefined;
    if (!authId) return null;
    const user = await prisma.user.findUnique({ where: { authId }, select: { id: true } });
    return user?.id ?? null;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const existingTestCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!existingTestCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (existingTestCase.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Create cloned test case with:
        // - New CUID id (auto-generated)
        // - Empty displayId (user can set their own)
        // - Name: "{original name} (Copy)"
        // - Status: DRAFT
        // - Copy all other fields (url, prompt, steps, browserConfig, credentials)
        const clonedTestCase = await prisma.testCase.create({
            data: {
                name: `${existingTestCase.name} (Copy)`,
                url: existingTestCase.url,
                prompt: existingTestCase.prompt,
                steps: existingTestCase.steps,
                browserConfig: existingTestCase.browserConfig,
                username: existingTestCase.username,
                password: existingTestCase.password,
                projectId: existingTestCase.projectId,
                displayId: null, // Empty displayId for cloned test case
                status: 'DRAFT',
            },
        });

        return NextResponse.json(clonedTestCase);
    } catch (error) {
        logger.error('Failed to clone test case', error);
        return NextResponse.json({ error: 'Failed to clone test case' }, { status: 500 });
    }
}
