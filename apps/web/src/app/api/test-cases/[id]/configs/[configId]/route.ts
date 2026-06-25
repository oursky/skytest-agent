import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { validateConfigName, validateConfigType, normalizeConfigName } from '@/lib/test-config/validation';
import { createLogger } from '@/lib/core/logger';
import type { ConfigType } from '@/types';
import { deleteObjectIfExists } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';

const logger = createLogger('api:test-cases:config');

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id, params: { configId } } = guard;

        const existing = await prisma.testCaseConfig.findUnique({
            where: { id: configId },
        });

        if (!existing || existing.testCaseId !== id) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Config not found' });
        }

        const body = await request.json() as {
            name?: string;
            type?: string;
            value?: string;
            masked?: boolean;
        };
        const { name: rawName, type, value, masked } = body;

        if (rawName !== undefined) {
            const nameError = validateConfigName(rawName);
            if (nameError) {
                return apiError({ status: 400, code: 'VALIDATION_ERROR', error: nameError });
            }
        }

        if (type !== undefined && !validateConfigType(type)) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Invalid config type' });
        }

        const name = rawName !== undefined ? normalizeConfigName(rawName) : undefined;
        const nextType = (type ?? existing.type) as ConfigType;
        const nextMasked = nextType === 'VARIABLE'
            ? (masked !== undefined ? masked : existing.masked)
            : false;
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
            }
        });

        return NextResponse.json(config);
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
            return apiError({ status: 409, code: 'CONFLICT', error: 'A config with this name already exists' });
        }
        logger.error('Failed to update test case config', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to update config' });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id, params: { configId } } = guard;

        const existing = await prisma.testCaseConfig.findUnique({
            where: { id: configId },
        });

        if (!existing || existing.testCaseId !== id) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Config not found' });
        }

        if (existing.type === 'FILE' && existing.value) {
            try {
                await deleteObjectIfExists(existing.value);
            } catch {
                logger.warn('Config file not found in object storage', { objectKey: existing.value });
            }
        }

        await prisma.testCaseConfig.delete({
            where: { id: configId }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete test case config', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to delete config' });
    }
}
