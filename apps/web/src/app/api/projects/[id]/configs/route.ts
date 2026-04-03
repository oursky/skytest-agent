import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { validateConfigName, validateConfigType, normalizeConfigName } from '@/lib/test-config/validation';
import { createLogger } from '@/lib/core/logger';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:configs');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const configs = await prisma.projectConfig.findMany({
            where: {
                projectId: id,
                type: {
                    in: ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE']
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        const sorted = [...configs].sort(compareByGroupThenName);
        return NextResponse.json(sorted);
    } catch (error) {
        logger.error('Failed to fetch project configs', error);
        return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const body = await request.json() as {
            name?: string;
            type?: string;
            value?: string;
            masked?: boolean;
            group?: string | null;
        };
        const rawName = body.name ?? '';
        const type = body.type ?? '';
        const { value, masked, group } = body;

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

        const normalizedGroup = normalizeConfigGroup(group);
        const normalizedMasked = type === 'VARIABLE' ? masked === true : false;
        const normalizedValue = typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value));

        const config = await prisma.projectConfig.create({
            data: {
                projectId: id,
                name,
                type,
                value: normalizedValue,
                masked: normalizedMasked,
                group: isGroupableConfigType(type) ? (normalizedGroup || null) : null,
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
