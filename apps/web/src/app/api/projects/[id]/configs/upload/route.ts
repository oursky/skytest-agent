import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { buildProjectConfigObjectKey, validateAndSanitizeFile } from '@/lib/security/file-security';
import { validateConfigName, normalizeConfigName } from '@/lib/test-config/validation';
import { createLogger } from '@/lib/core/logger';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:configs:upload');

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

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const name = formData.get('name') as string | null;

        if (!file) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'No file provided' });
        }

        if (!name) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Config name is required' });
        }

        const nameError = validateConfigName(name);
        if (nameError) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: nameError });
        }

        const normalizedName = normalizeConfigName(name);

        const validation = validateAndSanitizeFile(file.name, file.type, file.size);
        if (!validation.valid) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: validation.error ?? 'Invalid file' });
        }

        const storedName = validation.storedName!;
        const buffer = Buffer.from(await file.arrayBuffer());
        const objectKey = buildProjectConfigObjectKey(id, storedName);
        await putObjectBuffer({
            key: objectKey,
            body: buffer,
            contentType: file.type,
        });

        const config = await prisma.projectConfig.create({
            data: {
                projectId: id,
                name: normalizedName,
                type: 'FILE',
                value: objectKey,
                masked: false,
                filename: validation.sanitizedFilename!,
                mimeType: file.type,
                size: file.size,
            }
        });

        return NextResponse.json(config, { status: 201 });
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
            return apiError({ status: 409, code: 'CONFLICT', error: 'A config with this name already exists' });
        }
        logger.error('Failed to upload config file', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to upload file' });
    }
}
