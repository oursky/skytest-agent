import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { validateConfigName, validateConfigType } from '@/lib/config-validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:test-cases:configs');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const includeSecretValues = new URL(request.url).searchParams.get('includeSecretValues') === 'true';
        const { id } = await params;

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const configs = await prisma.testCaseConfig.findMany({
            where: { testCaseId: id },
            orderBy: { createdAt: 'asc' }
        });

        if (includeSecretValues) {
            return NextResponse.json(configs);
        }

        const masked = configs.map(c => ({
            ...c,
            value: c.type === 'SECRET' ? '' : c.value
        }));

        return NextResponse.json(masked);
    } catch (error) {
        logger.error('Failed to fetch test case configs', error);
        return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
    }
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

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { name, type, value } = body;

        const nameError = validateConfigName(name);
        if (nameError) {
            return NextResponse.json({ error: nameError }, { status: 400 });
        }

        if (!validateConfigType(type)) {
            return NextResponse.json({ error: 'Invalid config type' }, { status: 400 });
        }

        if (type !== 'FILE' && (value === undefined || value === null)) {
            return NextResponse.json({ error: 'Value is required' }, { status: 400 });
        }

        const config = await prisma.testCaseConfig.create({
            data: {
                testCaseId: id,
                name,
                type,
                value: value || '',
            }
        });

        return NextResponse.json(config, { status: 201 });
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
            return NextResponse.json({ error: 'A config with this name already exists' }, { status: 409 });
        }
        logger.error('Failed to create test case config', error);
        return NextResponse.json({ error: 'Failed to create config' }, { status: 500 });
    }
}
