import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { validateConfigName, validateConfigType, normalizeConfigName } from '@/lib/test-config/validation';
import { createLogger } from '@/lib/core/logger';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';
import type { ConfigType } from '@/types';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:config');

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id, configId } = guard.params;

        const existing = await prisma.projectConfig.findUnique({
            where: { id: configId },
            select: {
                id: true,
                projectId: true,
                type: true,
                value: true,
                masked: true,
                group: true,
                name: true,
            }
        });

        if (!existing || existing.projectId !== id) {
            return NextResponse.json({ error: 'Config not found' }, { status: 404 });
        }

        const body = await request.json() as {
            name?: string;
            type?: string;
            value?: string;
            masked?: boolean;
            group?: string | null;
        };
        const { name: rawName, type, value, masked, group } = body;

        if (rawName !== undefined) {
            const nameError = validateConfigName(rawName);
            if (nameError) {
                return NextResponse.json({ error: nameError }, { status: 400 });
            }
        }

        if (type !== undefined && !validateConfigType(type)) {
            return NextResponse.json({ error: 'Invalid config type' }, { status: 400 });
        }

        const name = rawName !== undefined ? normalizeConfigName(rawName) : undefined;
        const nextType = (type ?? existing.type) as ConfigType;
        const nextMasked = nextType === 'VARIABLE'
            ? (masked !== undefined ? masked : existing.masked)
            : false;
        const rawNextGroup = group !== undefined ? group : existing.group;
        const normalizedGroup = normalizeConfigGroup(rawNextGroup);
        const nextGroup = isGroupableConfigType(nextType) ? (normalizedGroup || null) : null;
        const normalizedValue = value !== undefined
            ? (typeof value === 'string' ? value : String(value))
            : undefined;

        const config = await prisma.projectConfig.update({
            where: { id: configId },
            data: {
                ...(name !== undefined && { name }),
                ...(type !== undefined && { type }),
                ...(normalizedValue !== undefined && { value: normalizedValue }),
                masked: nextMasked,
                group: nextGroup,
            }
        });

        return NextResponse.json(config);
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
            return NextResponse.json({ error: 'A config with this name already exists' }, { status: 409 });
        }
        logger.error('Failed to update project config', error);
        return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id, configId } = guard.params;

        const existing = await prisma.projectConfig.findUnique({
            where: { id: configId },
            select: {
                id: true,
                projectId: true,
                type: true,
                value: true,
            }
        });

        if (!existing || existing.projectId !== id) {
            return NextResponse.json({ error: 'Config not found' }, { status: 404 });
        }

        if (existing.type === 'FILE' && existing.value) {
            try {
                await deleteObjectIfExists(existing.value);
            } catch {
                logger.warn('Config file not found in object storage', { objectKey: existing.value });
            }
        }

        await prisma.projectConfig.delete({
            where: { id: configId }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete project config', error);
        return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 });
    }
}
