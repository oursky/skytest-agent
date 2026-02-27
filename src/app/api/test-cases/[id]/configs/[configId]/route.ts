import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { validateConfigName, validateConfigType, normalizeConfigName } from '@/lib/config-validation';
import { getTestCaseConfigUploadPath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/config-sort';
import type { ConfigType } from '@/types';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('api:test-cases:config');

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id, configId } = await params;

        const existing = await prisma.testCaseConfig.findUnique({
            where: { id: configId },
            include: {
                testCase: {
                    include: { project: { select: { userId: true } } }
                }
            }
        });

        if (!existing || existing.testCaseId !== id) {
            return NextResponse.json({ error: 'Config not found' }, { status: 404 });
        }

        if (existing.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

        const config = await prisma.testCaseConfig.update({
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
        logger.error('Failed to update test case config', error);
        return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id, configId } = await params;

        const existing = await prisma.testCaseConfig.findUnique({
            where: { id: configId },
            include: {
                testCase: {
                    include: { project: { select: { userId: true } } }
                }
            }
        });

        if (!existing || existing.testCaseId !== id) {
            return NextResponse.json({ error: 'Config not found' }, { status: 404 });
        }

        if (existing.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (existing.type === 'FILE' && existing.value) {
            try {
                const filePath = path.join(getTestCaseConfigUploadPath(id), existing.value);
                await fs.unlink(filePath);
            } catch {
                logger.warn('Config file not found on disk');
            }
        }

        await prisma.testCaseConfig.delete({
            where: { id: configId }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete test case config', error);
        return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 });
    }
}
