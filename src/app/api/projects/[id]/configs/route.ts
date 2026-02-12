import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { validateConfigName, validateConfigType, normalizeConfigName } from '@/lib/config-validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:projects:configs');

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

        const project = await prisma.project.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const configs = await prisma.projectConfig.findMany({
            where: { projectId: id },
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
        logger.error('Failed to fetch project configs', error);
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

        const project = await prisma.project.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { name: rawName, type, value } = body;

        const nameError = validateConfigName(rawName);
        if (nameError) {
            return NextResponse.json({ error: nameError }, { status: 400 });
        }

        const name = normalizeConfigName(rawName);

        if (!validateConfigType(type)) {
            return NextResponse.json({ error: 'Invalid config type' }, { status: 400 });
        }

        if (type !== 'FILE' && (value === undefined || value === null)) {
            return NextResponse.json({ error: 'Value is required' }, { status: 400 });
        }

        const config = await prisma.projectConfig.create({
            data: {
                projectId: id,
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
        logger.error('Failed to create project config', error);
        return NextResponse.json({ error: 'Failed to create config' }, { status: 500 });
    }
}
